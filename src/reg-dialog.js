// 加選／登記的確認視窗，選課頁與選課規劃頁共用。只有使用者按「送出加選／送出登記」才會送出。
// 按鈕寫出具體動作、不預設焦點在送出（NN/g 確認視窗準則）。
import { wishOptions, registerParams, parseRegResult } from './lib/register.js'
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
    let wish = ''
    if (availability.needsWish) {
      const picked = dialog.querySelector('input[name="wish"]:checked')
      if (!picked) return showError('請先選擇第幾志願。')
      wish = picked.value
    }
    const btn = q('#btn-submit')
    const label = btn.textContent
    btn.disabled = true
    btn.textContent = '送出中…'
    try {
      const reply = await askCos({ type: 'register', params: registerParams(record, wish) })
      if (!reply || !reply.ok) return showError(cosProblem(reply))
      const result = parseRegResult(reply.text)
      finish({ ok: result.ok, message: result.ok && availability.needsWish ? `已登記第 ${wish} 志願` : result.message, wish })
    } finally {
      btn.disabled = false
      btn.textContent = label
    }
  })

  function renderWishes(availability, record, groups) {
    const box = q('#wish-options')
    box.replaceChildren()
    q('#wish-block').hidden = !availability.needsWish
    if (!availability.needsWish) return
    for (const option of wishOptions((groups || {})[availability.groupUid], record)) {
      const label = document.createElement('label')
      if (option.takenBy && !option.isThisCourse) label.classList.add('taken')
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'wish', value: String(option.no) })
      const text = Object.assign(document.createElement('span'), { textContent: `第 ${option.no} 志願` })
      const bits = []
      if (option.isThisCourse) bits.push('目前是這門課')
      else if (option.takenBy) bits.push(`已填 ${option.takenBy}`)
      if (option.reserved) bits.push(`登記 ${option.reserved} 人`)
      const extra = Object.assign(document.createElement('span'), { className: 'reserved', textContent: bits.join('・') })
      label.append(input, text, extra)
      box.append(label)
    }
  }

  return {
    // heading：「課號 課名」；detail：「老師 · 時段」；check：{ record, availability }；groups：志願群組
    open({ heading, detail, check, groups }) {
      const { availability, record } = check
      q('#confirm-title').textContent = availability.needsWish ? '確認登記' : '確認加選'
      q('#btn-submit').textContent = availability.needsWish ? '送出登記' : '送出加選'
      const lines = [heading, detail, availability.seats, availability.reasons.length ? `注意：${availability.reasons.join('、')}` : '', availability.needsWish ? '送出後會真的登記這個志願。' : '送出後會真的加選這門課。'].filter(Boolean)
      q('#confirm-body').replaceChildren(...lines.flatMap((line, i) => (i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)])))
      q('#confirm-error').hidden = true
      renderWishes(availability, record, groups)
      if (pending) finish(null)
      return new Promise((resolve) => {
        pending = { check, resolve }
        dialog.showModal()
        // 焦點放在「先不要」，避免按 Enter 就直接送出
        q('#btn-cancel').focus()
      })
    },
  }
}
