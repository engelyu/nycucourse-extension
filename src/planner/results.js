// 找空堂的結果清單：分「完全落在內」「部分重疊」兩組；滑過卡片在格子上預覽時段
import { courseSlots, courseCategories, describeKeys, campusName } from '../lib/freeslots.js'
import { courseOutlineUrl } from '../lib/links.js'

const span = (className, textContent) => Object.assign(document.createElement('span'), { className, textContent })

function card(hit, ctx) {
  const { course } = hit
  const li = document.createElement('li')
  li.className = 'card'
  li.dataset.id = course.id
  li.addEventListener('mouseenter', () => ctx.onHover(hit))
  li.addEventListener('mouseleave', () => ctx.onHover(null))

  const info = document.createElement('div')
  info.className = 'info'
  const url = courseOutlineUrl(ctx.semester, course.id)
  const title = document.createElement(url ? 'a' : 'span')
  title.className = 'title'
  if (url) Object.assign(title, { href: url, target: '_blank', rel: 'noreferrer', title: '開啟課程大綱' })
  title.textContent = `${course.id} ${course.name}`
  const status = ctx.statuses.get(course.id)
  const badge = status ? span('badge', status.label) : null
  if (badge) badge.dataset.state = status.state
  const { campuses, rooms } = courseSlots(course)
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = [
    course.teacher,
    describeKeys(hit.keys),
    rooms.join('、'),
    campuses.map(campusName).join('、'),
    course.credit ? `${Number(course.credit)} 學分` : '',
    courseCategories(course).join('・'),
    course.dep,
  ]
    .filter(Boolean)
    .join('・')
  info.append(title)
  if (badge) info.append(badge)
  info.append(meta)
  if (hit.outside.length) {
    const out = document.createElement('div')
    out.className = 'outside'
    out.textContent = `超出：${describeKeys(hit.outside)}`
    info.append(out)
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  const s = ctx.addState.get(course.id)
  const inPrereg = Boolean(status) || (s && (s.status === 'added' || s.status === 'exists'))
  const button = (text, title, onClick) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.title = title
    b.disabled = Boolean(s && s.busy)
    b.addEventListener('click', onClick)
    return b
  }
  if (status && status.state === 'registered') {
    // 已選上：不提供任何操作（不做退選）
  } else if (s && (s.status === 'pending' || s.status === 'querying')) {
    actions.append(span('muted', s.status === 'pending' ? '加入中…' : '查詢中…'))
  } else if (s && s.status === 'registered') {
    actions.append(span('ok', s.msg))
  } else if (!s || s.status !== 'choose') {
    if (s && s.status === 'added') actions.append(span('ok', `已加入${s.note ? `・${s.note}` : ''}`))
    if (s && s.status === 'error') actions.append(span('error', s.msg))
    if (!inPrereg) actions.append(button('加入預排', '加入預排（有多種採計方式時會先讓你選）', () => ctx.onAdd(course)))
    actions.append(button(s && s.status === 'queried' ? '重新查詢' : '查詢', '查詢能不能加選、人數與衝堂', () => ctx.onQuery(course)))
  }
  li.append(info, actions)

  if (s && s.status === 'queried' && !(status && status.state === 'registered')) {
    const box = document.createElement('div')
    box.className = 'query-rows'
    for (const row of s.rows) {
      const r = document.createElement('div')
      r.className = 'query-row'
      const a = row.availability
      const ok = a.canRegister
      const text = ok ? [a.needsWish ? '可登記（志願序）' : '可加選', a.seats, ...a.reasons].filter(Boolean).join('・') : [(a.message || '不能選').replace(/[。.]\s*$/, ''), a.seats].filter(Boolean).join('・')
      r.append(span('how', row.label), span(ok ? 'avail ok' : 'avail error', text))
      if (ok) {
        const label = status && status.state === 'wish' && a.needsWish ? '改志願' : a.needsWish ? '登記' : '加選'
        r.append(button(label, row.inPrereg ? '開啟確認視窗' : '先加入預排，再開啟確認視窗', () => ctx.onRegister(course, row)))
      }
      box.append(r)
    }
    li.append(box)
  }

  if (s && s.status === 'choose') {
    const box = document.createElement('div')
    box.className = 'choices'
    box.append(s.options.length === 1 && s.options[0].source !== 'home' ? '在開課系所找不到，只找到：' : '這門課可以算：')
    for (const option of s.options) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = option.label
      b.title = `以「${option.label}」加入預排`
      b.addEventListener('click', () => ctx.onChoose(course, option))
      box.append(b)
    }
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'link'
    cancel.textContent = '取消'
    cancel.addEventListener('click', () => ctx.onCancel(course))
    box.append(cancel)
    li.append(box)
  }
  return li
}

export function renderResults(container, found, ctx) {
  container.replaceChildren()
  const groups = [
    ['完全落在內', found.inside],
    ['部分重疊', found.overlap],
  ].filter(([, hits]) => hits.length)
  for (const [label, hits] of groups) {
    const h = document.createElement('h2')
    h.textContent = `${label}（${hits.length}）`
    const ul = document.createElement('ul')
    ul.className = 'cards'
    ul.append(...hits.map((hit) => card(hit, ctx)))
    container.append(h, ul)
  }
}
