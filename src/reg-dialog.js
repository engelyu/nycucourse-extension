// 加選／登記的確認視窗，選課頁與當期選課頁共用。只有使用者按「送出加選／送出登記」才會送出。
// 按鈕寫出具體動作、不預設焦點在送出（NN/g 確認視窗準則）。
import { wishOptions, wishLimitReached, registerParams, parseRegResult, ACTION_LABELS } from './lib/register.js'

// 和選課網相同：有人數上限的課是登記、等分發；不限人數的課直接加選
const SUBMIT_TEXT = {
  wish: '送出後會登記這個志願，分發後才知道有沒有選上。',
  signup: '這門課有人數上限，送出後是「已登記」，分發後才知道有沒有選上。',
  add: '這門課不限人數，送出後會直接選上。',
}
// 改志願要先取消再登記（實測：直接重送一定回「重複選課」）
const RECHOOSE_TEXT = '選課網不能直接改志願，送出後會先取消這門課目前的登記，再用新的志願重新登記。中間有一小段時間這門課是沒有登記的。'
const DONE_TEXT = {
  wish: (wish) => `已登記第 ${wish} 志願，等分發`,
  signup: () => '已登記，等分發',
  add: () => '已加選（已選上）',
}
import { askCos, cosProblem } from './cos-tab.js'

const HTML = `
  <h2 id="confirm-title"></h2>
  <p id="confirm-body"></p>
  <div id="wish-block" hidden>
    <p class="wish-label">這門課要用志願序登記，請選第幾志願：</p>
    <div id="wish-options" class="wish-options"></div>
  </div>
  <p id="confirm-error" class="dialog-error" hidden></p>
  <div class="dialog-actions">
    <button id="btn-cancel" type="button">先不要</button>
    <button id="btn-submit" type="button">送出</button>
  </div>`

// open() 回傳 Promise：送出後是 { ok, message, wish }，取消是 null
export function createRegisterDialog() {
  const dialog = document.createElement('dialog')
  dialog.id = 'confirm'
  dialog.className = 'reg-dialog'
  dialog.innerHTML = HTML
  document.body.append(dialog)
  const q = (sel) => dialog.querySelector(sel)
  let pending = null // { check, resolve }

  const showError = (text) => {
    q('#confirm-error').textContent = text
    q('#confirm-error').hidden = false
  }
  const finish = (value) => {
    const p = pending
    pending = null
    if (dialog.open) dialog.close()
    if (p) p.resolve(value)
  }

  // 選了志願就收起「請先選擇第幾志願」
  q('#wish-options').addEventListener('change', () => {
    q('#confirm-error').hidden = true
  })
  q('#btn-cancel').addEventListener('click', () => finish(null))
  dialog.addEventListener('cancel', () => finish(null))
  q('#btn-submit').addEventListener('click', async () => {
    if (!pending) return
    const { availability, record } = pending.check
    const rechoose = pending.rechoose
    let wish = ''
    if (availability.needsWish) {
      const picked = dialog.querySelector('input[name="wish"]:checked')
      if (!picked) return showError('請先選擇第幾志願。')
      wish = picked.value
    }
    let params
    try {
      params = registerParams(record, wish)
    } catch (err) {
      return showError(err.message)
    }
    const btn = q('#btn-submit')
    const label = btn.textContent
    btn.disabled = true
    btn.textContent = '送出中…'
    try {
      if (rechoose) {
        btn.textContent = '取消原本的登記…'
        const cancelled = await askCos({ type: 'cancelregist', cosId: params.cos_id })
        if (!cancelled || !cancelled.ok) return showError(cosProblem(cancelled))
        if (!cancelled.cancelled) return showError(cancelled.msg)
        btn.textContent = '重新登記…'
      }
      const reply = await askCos({ type: 'register', params })
      if (!reply || !reply.ok) return showError(cosProblem(reply))
      const result = parseRegResult(reply.text)
      finish({ ok: result.ok, message: result.ok ? DONE_TEXT[availability.action](wish) : result.message, wish, rechoose })
    } finally {
      btn.disabled = false
      btn.textContent = label
    }
  })

  // 志願清單：wish[n] 是「這個志願已被同群組其他課用掉」，用掉的不能再選（和選課網一樣變灰）；
  // 右邊顯示這門課該志願目前幾個人登記，讓使用者判斷競爭程度。
  function renderWishes(availability, record, groups, current) {
    const box = q('#wish-options')
    box.replaceChildren()
    const group = (groups || {})[availability.groupUid]
    q('#wish-block').hidden = !availability.needsWish
    if (!availability.needsWish) return true
    if (wishLimitReached(group)) {
      q('#wish-block').hidden = false
      box.append(Object.assign(document.createElement('p'), { className: 'wish-full', textContent: '這一類課程你已經選滿了，選課網不會再讓你登記。' }))
      return false
    }
    for (const option of wishOptions(group, record, { current })) {
      const label = document.createElement('label')
      if (option.used) label.classList.add('taken')
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'wish', value: String(option.no), disabled: option.used, checked: option.isCurrent })
      const text = Object.assign(document.createElement('span'), { textContent: `第 ${option.no} 志願` })
      const bits = []
      if (option.isCurrent) bits.push('目前登記的志願')
      if (option.used) bits.push('這個志願已經用在同類的其他課')
      if (option.registered) bits.push(`這門課第 ${option.no} 志願 ${option.registered} 人`)
      const extra = Object.assign(document.createElement('span'), { className: 'reserved', textContent: bits.join('・') })
      label.append(input, text, extra)
      box.append(label)
    }
    return true
  }

  return {
    // heading：「課號 課名」；detail：「老師 · 時段」；check：{ record, availability }；
    // groups：志願群組；currentWish：這門課目前登記的志願序（要改志願時給）
    open({ heading, detail, check, groups, currentWish = null }) {
      const { availability, record } = check
      const rechoose = currentWish != null
      const verb = rechoose ? '改志願' : ACTION_LABELS[availability.action] || '加選'
      q('#confirm-title').textContent = `確認${verb}`
      q('#btn-submit').textContent = `送出${verb}`
      const lines = [heading, detail, availability.seats, availability.reasons.length ? `注意：${availability.reasons.join('、')}` : '', rechoose ? RECHOOSE_TEXT : SUBMIT_TEXT[availability.action] || ''].filter(Boolean)
      q('#confirm-body').replaceChildren(...lines.flatMap((line, i) => (i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)])))
      q('#confirm-error').hidden = true
      const canSubmit = renderWishes(availability, record, groups, currentWish)
      q('#btn-submit').disabled = !canSubmit
      if (pending) finish(null)
      return new Promise((resolve) => {
        pending = { check, resolve, rechoose }
        dialog.showModal()
        // 焦點放在「先不要」，避免按 Enter 就直接送出
        q('#btn-cancel').focus()
      })
    },
  }
}
