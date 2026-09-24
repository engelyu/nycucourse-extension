// 當期選課的「自動登記」分頁（從原本的選課頁搬過來）。每天在指定時間自動登記清單裡的預排課程，
// 由背景程式執行（background.js 的 auto:get／auto:set／auto:run，設定存在 storage 的 autoRegister）。
import { timeWarning, formatRunTime, describeAutoItem, describeLogEntry } from '../lib/autoreg.js'

const WISHES = [['', '不需志願序'], ['1', '第 1 志願'], ['2', '第 2 志願'], ['3', '第 3 志願'], ['4', '第 4 志願'], ['5', '第 5 志願']]

async function askBackground(message) {
  try {
    return await chrome.runtime.sendMessage(message)
  } catch (err) {
    return { ok: false, detail: String(err && err.message ? err.message : err) }
  }
}

function showHint(el, text, kind = '') {
  el.textContent = text
  el.classList.toggle('error', kind === 'error')
  el.classList.toggle('warn', kind === 'warn')
  el.hidden = !text
}

// courses()：目前的預排課程（選課網的預排紀錄，有 cos_id、cos_cname）
// onRan()：「立刻執行一次」之後呼叫（當期選課用它重讀選課網狀態）
export function createAutoRegister(root, { courses, onRan }) {
  const $ = (sel) => root.querySelector(sel)
  let cfg = { enabled: false, time: '13:00', items: [], log: [] }
  let nextRun = null

  const apply = (reply) => {
    cfg = reply.config
    nextRun = reply.nextRun
    render()
  }

  async function load() {
    const reply = await askBackground({ type: 'auto:get' })
    if (reply && reply.ok) apply(reply)
  }

  async function save(patch) {
    const reply = await askBackground({ type: 'auto:set', patch })
    if (!reply || !reply.ok) return showHint($('#auto-message'), '無法儲存自動登記設定', 'error')
    apply(reply)
  }

  function renderPickers() {
    const select = $('#auto-course')
    const chosen = new Set((cfg.items || []).map((i) => i.cosId))
    const previous = select.value
    select.replaceChildren(
      ...courses()
        .filter((c) => !chosen.has(String(c.cos_id)))
        .map((c) => Object.assign(document.createElement('option'), { value: String(c.cos_id), textContent: `${c.cos_id} ${c.cos_cname}` })),
    )
    if (previous) select.value = previous
    select.disabled = select.options.length === 0
    $('#auto-add').disabled = select.options.length === 0
  }

  function listItem(text, button) {
    const li = document.createElement('li')
    li.append(Object.assign(document.createElement('span'), { textContent: text }))
    if (button) li.append(button)
    return li
  }

  function render() {
    $('#auto-enabled').checked = Boolean(cfg.enabled)
    $('#auto-time').value = cfg.time || '13:00'
    $('#auto-next').textContent = cfg.enabled && nextRun ? `下次執行：${formatRunTime(nextRun)}` : '目前關閉'
    showHint($('#auto-warning'), timeWarning(cfg.time || ''), 'warn')

    const items = cfg.items || []
    $('#auto-list').replaceChildren(
      ...(items.length
        ? items.map((item) => {
            const course = courses().find((c) => String(c.cos_id) === item.cosId)
            const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: '移除' })
            remove.addEventListener('click', () => save({ items: (cfg.items || []).filter((i) => i.cosId !== item.cosId) }))
            return listItem(describeAutoItem(item, course ? course.cos_cname : ''), remove)
          })
        : [listItem('清單是空的，從下面選一門預排課程加入。')]),
    )

    const log = (cfg.log || []).slice(0, 5)
    $('#auto-log').replaceChildren(
      ...(log.length
        ? log.map((entry) => {
            const li = listItem(describeLogEntry(entry))
            if ((entry.results || []).some((r) => !r.ok)) li.classList.add('failed')
            return li
          })
        : [listItem('還沒有執行紀錄。')]),
    )
    renderPickers()
  }

  const wish = $('#auto-wish')
  wish.replaceChildren(...WISHES.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })))
  $('#auto-enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }))
  $('#auto-time').addEventListener('change', (e) => {
    if (e.target.value) save({ time: e.target.value })
  })
  $('#auto-add').addEventListener('click', () => {
    const cosId = $('#auto-course').value
    if (!cosId) return
    const course = courses().find((c) => String(c.cos_id) === cosId)
    save({ items: [...(cfg.items || []), { cosId, wish: wish.value, title: course ? course.cos_cname : '' }] })
  })
  $('#auto-run').addEventListener('click', async () => {
    const btn = $('#auto-run')
    btn.disabled = true
    btn.textContent = '執行中…'
    try {
      const reply = await askBackground({ type: 'auto:run' })
      if (reply && reply.ok) showHint($('#auto-message'), `自動登記：${reply.entry.summary || reply.entry.note}`)
      else showHint($('#auto-message'), '自動登記執行失敗', 'error')
      await load()
      await onRan()
    } finally {
      btn.disabled = false
      btn.textContent = '立刻執行一次'
    }
  })

  return { load, render }
}
