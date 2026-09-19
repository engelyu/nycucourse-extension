// 課表上點一堂課的詳情小卡：老師、時段、狀態、採計方式、大綱，以及依狀態的動作。
// 已選上、已登記（等分發）只看詳情；永遠不提供退選或移除正式選課的課。
import { describeSlots } from '../lib/periods.js'
import { courseOutlineUrl } from '../lib/links.js'
import { renderQueryRows } from './results.js'

const NARROW = '(max-width: 899px)'
const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })

export function createCourseDetail(dialog, ctx) {
  let current = null // { item, anchor }

  const close = () => {
    current = null
    if (dialog.open) dialog.close()
  }
  dialog.addEventListener('close', () => {
    current = null
  })
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  document.addEventListener('pointerdown', (e) => {
    if (!dialog.open || dialog.contains(e.target)) return
    if (e.target.closest && e.target.closest('dialog[open]')) return // 確認視窗開著時不關
    close()
  })

  function place(anchor) {
    if (window.matchMedia(NARROW).matches || !anchor) {
      dialog.style.left = dialog.style.top = ''
      dialog.classList.add('centered')
      return
    }
    dialog.classList.remove('centered')
    const a = anchor.getBoundingClientRect()
    const w = dialog.offsetWidth
    const h = dialog.offsetHeight
    const left = Math.min(Math.max(8, a.left - w - 8 > 8 ? a.left - w - 8 : a.right + 8), window.innerWidth - w - 8)
    const top = Math.min(Math.max(8, a.top), window.innerHeight - h - 8)
    dialog.style.left = `${left}px`
    dialog.style.top = `${top}px`
  }

  function draw() {
    const { item } = current
    const manual = item.source === 'manual'
    const status = manual ? null : ctx.status(item.cosId)
    const course = manual ? null : ctx.findCourse(item.cosId)
    dialog.replaceChildren()

    const head = el('div', 'detail-head')
    const url = manual ? '' : courseOutlineUrl(item.semester || ctx.semester(), item.cosId)
    const title = el(url ? 'a' : 'span', 'detail-title', manual ? item.title : `${item.cosId} ${item.title}`)
    if (url) Object.assign(title, { href: url, target: '_blank', rel: 'noreferrer', title: '開啟課程大綱' })
    const x = el('button', 'detail-close', '✕')
    x.type = 'button'
    x.setAttribute('aria-label', '關閉')
    x.addEventListener('click', close)
    head.append(title, x)

    const rooms = [...new Set((item.slots || []).map((s) => s.room).filter(Boolean))]
    const lines = [
      [item.teacher, describeSlots(item.slots), rooms.join('、')].filter(Boolean).join('・'),
      manual ? '私人行程' : status ? status.label : '',
    ].filter(Boolean)
    dialog.append(head, ...lines.map((t) => el('p', 'detail-line', t)))

    const actions = el('div', 'detail-actions')
    if (manual) {
      const a = el('a', '', '到課表頁編輯')
      a.href = chrome.runtime.getURL('src/schedule.html')
      a.target = '_blank'
      actions.append(a)
    } else if (status && (status.state === 'preregist' || (status.state === 'wish' && status.wishNo))) {
      const s = ctx.queryState(item.cosId)
      if (!course) {
        actions.append(el('span', 'muted', '課程資料裡找不到這門課，請先更新課程資料再查詢'))
      } else if (s && s.status === 'querying') {
        actions.append(el('span', 'muted', '查詢中…'))
      } else {
        const q = el('button', '', s && s.status === 'queried' ? '重新查詢' : '查詢')
        q.type = 'button'
        q.addEventListener('click', () => ctx.onQuery(course))
        actions.append(q)
        if (s && s.status === 'error') actions.append(el('span', 'error', s.msg))
        if (s && s.status === 'registered') actions.append(el('span', 'ok', s.msg))
      }
      if (status.state === 'preregist') {
        const rm = el('button', 'danger', '從預排移除')
        rm.type = 'button'
        rm.addEventListener('click', () => {
          close()
          ctx.onRemove(item)
        })
        actions.append(rm)
      }
    }
    dialog.append(actions)
    if (course) {
      const rows = renderQueryRows(course, ctx.queryState(item.cosId), status, (c, row) => ctx.onRegister(c, row))
      if (rows) dialog.append(rows)
    }
  }

  return {
    open(item, anchor) {
      current = { item, anchor }
      draw()
      if (!dialog.open) dialog.show()
      place(anchor)
    },
    refresh() {
      if (!current) return
      draw()
      place(current.anchor.isConnected ? current.anchor : null)
    },
    close,
  }
}
