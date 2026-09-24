// 課程時間表的官方大樓表（POST ?r=main/get_classroom_code，不用登入）。2026-09-24 實測格式，節錄兩個校區。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBuildings, loadBuildings, BUILDINGS_URL, BUILDINGS_MAX_AGE } from '../src/lib/buildings.js'

const RAW = {
  'Yang-Ming': {
    cname: '台北陽明校區', ename: 'Yang-Ming Campus', campus_code: '[YM]', build_num: 2, map: 'https://www.nycu.edu.tw/about/campus-maps/',
    code: { YT: { cname: '教學大樓', ename: 'Teaching Building' }, YR: { cname: '守仁樓', ename: 'Shouren Building ' } },
  },
  'Guang-Fu': {
    cname: '新竹光復校區', ename: 'Guang-Fu Campus', campus_code: '[GF]', build_num: 2, map: 'https://www.nycu.edu.tw/about/campus-maps/',
    code: { ED: { cname: '工程四館', ename: 'Engineering Building IV' }, EC: { cname: '工程三館', ename: 'Engineering Building 3' } },
  },
}
const DATA = normalizeBuildings(RAW)

test('normalizeBuildings：校區代碼去掉括號，名稱去掉頭尾空白', () => {
  assert.deepEqual(DATA.campuses.map((c) => c.code), ['YM', 'GF'])
  assert.equal(DATA.campuses[1].cname, '新竹光復校區')
  assert.deepEqual(DATA.buildings.GF.ED, { cname: '工程四館', ename: 'Engineering Building IV' })
  assert.equal(DATA.buildings.YM.YR.ename, 'Shouren Building')
})

test('normalizeBuildings：格式不對時回傳 null', () => {
  assert.equal(normalizeBuildings(null), null)
  assert.equal(normalizeBuildings({}), null)
  assert.equal(normalizeBuildings('error'), null)
})

function fakeStorage(initial = {}) {
  const data = { ...initial }
  return { data, get: async (key) => (key in data ? { [key]: data[key] } : {}), set: async (obj) => Object.assign(data, obj) }
}
const NOW = Date.UTC(2026, 8, 24, 2, 40)
const DAY = 24 * 60 * 60 * 1000
function okFetch(calls) {
  return async (url, opts) => {
    calls.push({ url, method: opts && opts.method })
    return { ok: true, status: 200, json: async () => RAW }
  }
}
const failFetch = async () => {
  throw new Error('offline')
}

test('loadBuildings：沒有快取就去抓（POST），並寫回快取', async () => {
  const calls = []
  const storage = fakeStorage()
  const data = await loadBuildings({ fetchImpl: okFetch(calls), storage, now: NOW })
  assert.deepEqual(data, DATA)
  assert.deepEqual(calls, [{ url: BUILDINGS_URL, method: 'POST' }])
  assert.deepEqual(storage.data.roomBuildings, { fetchedAt: NOW, data: DATA })
})

test('loadBuildings：快取未滿 30 天就不抓', async () => {
  const calls = []
  const storage = fakeStorage({ roomBuildings: { fetchedAt: NOW - DAY, data: DATA } })
  assert.deepEqual(await loadBuildings({ fetchImpl: okFetch(calls), storage, now: NOW }), DATA)
  assert.equal(calls.length, 0)
})

test('loadBuildings：快取過期就重抓；抓不到時沿用舊快取', async () => {
  const old = { campuses: [{ code: 'GF', cname: '舊', ename: '', map: '' }], buildings: { GF: {} } }
  const stale = { roomBuildings: { fetchedAt: NOW - BUILDINGS_MAX_AGE - 1, data: old } }
  const calls = []
  const refreshed = fakeStorage(stale)
  assert.deepEqual(await loadBuildings({ fetchImpl: okFetch(calls), storage: refreshed, now: NOW }), DATA)
  assert.equal(calls.length, 1)
  assert.equal(refreshed.data.roomBuildings.fetchedAt, NOW)
  assert.deepEqual(await loadBuildings({ fetchImpl: failFetch, storage: fakeStorage(stale), now: NOW }), old)
})

test('loadBuildings：抓不到又沒有快取就回傳 null；HTTP 錯誤當作抓不到', async () => {
  assert.equal(await loadBuildings({ fetchImpl: failFetch, storage: fakeStorage(), now: NOW }), null)
  const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) })
  assert.equal(await loadBuildings({ fetchImpl: http500, storage: fakeStorage(), now: NOW }), null)
})
