import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenUsable } from '../src/lib/classify.js'

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
