// 右欄正式課表：每一節列出所有課，同一節很多堂就往下撐高（排版見 lib/stack.js）。
// 滑過左邊結果時標亮該課的時段；滑過課表上的課時，同一堂課的所有節次一起標亮。
import { PERIODS, DAY_NAMES } from '../lib/periods.js'
import { stackWeek, hiddenSlots } from '../lib/stack.js'
import { describeKeys } from '../lib/freeslots.js'

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })

// repeatNames：接續的節次也寫課名（教室查詢用）；預設只有第一節寫、後面是細色條
export function createTimetable(container, { note, onOpen, repeatNames = false }) {
  let week = stackWeek([])

  container.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.tt-course')
    const key = card ? card.dataset.item : ''
    for (const c of container.querySelectorAll('.tt-course')) c.classList.toggle('same', Boolean(key) && c.dataset.item === key)
  })
  container.addEventListener('mouseleave', () => {
    for (const c of container.querySelectorAll('.tt-course.same')) c.classList.remove('same')
  })

  function courseButton(entry) {
    const named = entry.first || repeatNames
    const b = el('button', `tt-course${named ? '' : ' cont'}`)
    b.type = 'button'
    b.dataset.item = entry.key
    b.dataset.kind = entry.kind
    b.style.setProperty('--kind', entry.color)
    if (named) {
      b.title = [entry.item.title, entry.room].filter(Boolean).join('・')
      b.append(el('span', 'mark', entry.mark), el('span', 'name', entry.item.title), el('span', 'room', entry.room))
    } else {
      // 續行細條只有顏色，title 只放課名
      b.title = entry.item.title
      b.setAttribute('aria-label', `${entry.item.title}（續）`)
    }
    b.addEventListener('click', () => onOpen(entry.item, b))
    return b
  }

  return {
    render(items) {
      week = stackWeek(items)
      container.replaceChildren()
      container.style.gridTemplateColumns = `44px repeat(${week.days.length}, minmax(0, 1fr))`
      container.append(el('div', 'tt-corner'))
      for (const d of week.days) container.append(el('div', 'tt-day', DAY_NAMES[d]))
      for (const code of week.periods) {
        const p = PERIODS.find((x) => x.code === code)
        const head = el('div', 'tt-period')
        head.append(el('b', '', p.label), el('small', '', p.start))
        container.append(head)
        for (const d of week.days) {
          const key = `${d}-${code}`
          const cell = el('div', 'tt-cell')
          cell.dataset.key = key
          const list = week.cells.get(key) || []
          const lanes = list.length ? list[list.length - 1].lane + 1 : 0
          for (let lane = 0; lane < lanes; lane++) {
            const entry = list.find((e) => e.lane === lane)
            cell.append(entry ? courseButton(entry) : el('div', 'tt-gap'))
          }
          const conflict = week.conflicts.get(key)
          if (conflict) {
            cell.classList.add('conflict')
            cell.title = `衝堂：${conflict.join('、')}`
          }
          container.append(cell)
        }
      }
      if (!items.length) {
        note.textContent = '還沒有課。在左邊找到課後按「加入預排」，或按上方「從選課網更新狀態」。'
        note.dataset.empty = '1'
        note.hidden = false
      } else {
        delete note.dataset.empty
        note.hidden = true
      }
    },
    preview(keys = []) {
      const set = new Set(keys)
      for (const cell of container.querySelectorAll('.tt-cell')) cell.classList.toggle('preview', set.has(cell.dataset.key))
      if (!note.dataset.empty) {
        const hidden = hiddenSlots(keys, week)
        if (hidden.length) {
          note.textContent = `另有：${describeKeys(hidden)}`
          note.hidden = false
        } else note.hidden = true
      }
    },
  }
}
