import { test } from 'node:test'
import assert from 'node:assert/strict'
import '../src/lib/classify.js'

const { tokenUsable } = globalThis.NycuClassify

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (payload) => `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url(payload)}.sig`
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0)

test('沒有 token 不可用', () => {
  assert.equal(tokenUsable('', NOW), false)
  assert.equal(tokenUsable(null, NOW), false)
})

test('未過期可用', () => {
  assert.equal(tokenUsable(jwt({ exp: NOW / 1000 + 3600 }), NOW), true)
})

test('已過期不可用', () => {
  assert.equal(tokenUsable(jwt({ exp: NOW / 1000 - 1 }), NOW), false)
})

test('一分鐘內就要過期視為不可用', () => {
  assert.equal(tokenUsable(jwt({ exp: NOW / 1000 + 30 }), NOW), false)
})

test('payload 含 base64url 字元與中文仍可解析', () => {
  assert.equal(tokenUsable(jwt({ exp: NOW / 1000 + 3600, user: '游？>>>~~~' }), NOW), true)
  assert.equal(tokenUsable(jwt({ exp: NOW / 1000 - 10, user: '游？>>>~~~' }), NOW), false)
})

test('無法解析或沒有 exp 時交給伺服器判斷', () => {
  assert.equal(tokenUsable('not-a-jwt', NOW), true)
  assert.equal(tokenUsable('a.@@@.c', NOW), true)
  assert.equal(tokenUsable(jwt({ user: 'x' }), NOW), true)
})

// 2026-09-23 實測：選課結束後選課網改版（app.6f00adc0.js），登入權杖改存 sessionStorage（每個分頁各自一份），
// localStorage 只剩改版前留下、已過期的舊權杖。只讀 localStorage 會讓已登入的分頁看起來沒登入。
const { pickToken } = globalThis.NycuClassify

test('pickToken 優先用 sessionStorage 的權杖', () => {
  const fresh = jwt({ exp: NOW / 1000 + 3600 })
  const stale = jwt({ exp: NOW / 1000 - 3600 })
  assert.equal(pickToken(fresh, stale, NOW), fresh)
})

test('pickToken：sessionStorage 沒有或過期時，退回可用的 localStorage 權杖（改版前的選課網）', () => {
  const fresh = jwt({ exp: NOW / 1000 + 3600 })
  const stale = jwt({ exp: NOW / 1000 - 3600 })
  assert.equal(pickToken(null, fresh, NOW), fresh)
  assert.equal(pickToken(stale, fresh, NOW), fresh)
})

test('pickToken：兩邊都不能用時回傳空字串', () => {
  const stale = jwt({ exp: NOW / 1000 - 3600 })
  assert.equal(pickToken(null, null, NOW), '')
  assert.equal(pickToken(stale, stale, NOW), '')
})

// 2026-09-23 實測：選課結束後 getregist 回空白，選課網自己的「確認選課狀況」改用
// userinfo.regist_acysem[0] 的學年學期去讀 getsemregist。我們照做。
const { registSemester } = globalThis.NycuClassify

test('registSemester 取 regist_acysem 第一筆，和選課網「確認選課狀況」一樣', () => {
  const info = { lastacysem: '1151', regist_acysem: [{ acy: 115, acysem: '1151', sem: '1' }, { acy: 114, acysem: '1143', sem: 'X' }] }
  assert.deepEqual(registSemester(info), { acy: '115', sem: '1' })
})

test('registSemester 沒有 regist_acysem 時退回 lastacysem', () => {
  assert.deepEqual(registSemester({ lastacysem: '1143' }), { acy: '114', sem: '3' })
  assert.deepEqual(registSemester({ lastacysem: '114X' }), { acy: '114', sem: 'X' })
})

test('registSemester 讀不出學期時回傳 null，不要亂猜', () => {
  assert.equal(registSemester(null), null)
  assert.equal(registSemester({}), null)
  assert.equal(registSemester({ regist_acysem: [], lastacysem: 'abc' }), null)
})
