import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickTab } from '../src/lib/tabs.js'

const tabs = [{ id: 'add' }, { id: 'schedule' }]

test('pickTab 用記住的 tab', () => {
  assert.equal(pickTab(tabs, 'schedule'), 'schedule')
})

test('pickTab 記住的 tab 不存在或讀不到時用第一個', () => {
  assert.equal(pickTab(tabs, 'planner'), 'add')
  assert.equal(pickTab(tabs, undefined), 'add')
  assert.equal(pickTab(tabs, 42), 'add')
  assert.equal(pickTab([], 'add'), '')
})
