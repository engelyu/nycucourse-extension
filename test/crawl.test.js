import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crawlSemester } from '../src/lib/crawl.js'

function course(id, name) {
  return { cos_id: id, cos_cname: name, cos_ename: '', teacher: 'T', cos_time: '', cos_credit: '3.00', cos_type: '選修', dep_cname: 'D' }
}

// 假的課程時間表：兩個類型，一個有學院層、一個沒有；DEP-A 在兩處都出現（應去重）
function fakeServer({ failDep = null, failTimes = 0 } = {}) {
  const calls = []
  let failures = 0
  const fetchJson = async (fn, { method, body } = {}) => {
    const p = Object.fromEntries(new URLSearchParams(body || ''))
    calls.push({ fn, method, p })
    switch (fn) {
      case 'get_acysem': return [{ T: '114X' }, { T: '1142' }]
      case 'get_type': return [{ uid: 'T1', cname: '學士班課程' }, { uid: 'T2', cname: '學士班共同課程' }]
      case 'get_category':
        return p.ftype === 'T1' ? { '3*': '一般學士班' } : { '0G': '共同' }
      case 'get_college':
        return p.ftype === 'T1' ? { S: '理學院', X: '空學院' } : []
      case 'get_dep':
        if (p.ftype === 'T1' && p.fcollege === 'S') return { 'DEP-A': 'A', 'DEP-B': 'B' }
        if (p.ftype === 'T1' && p.fcollege === 'X') return []
        if (p.ftype === 'T2' && p.fcollege === '*') return { 'DEP-A': 'A', 'DEP-C': 'C' }
        return {}
      case 'get_cos_list': {
        if (p.m_dep_uid === failDep && failures < failTimes) {
          failures++
          throw new Error('boom')
        }
        const data = {
          'DEP-A': { 1: { '1142_000001': course('000001', '甲'), '1142_000002': course('000002', '乙') } },
          'DEP-B': { 1: { '1142_000002': course('000002', '乙') }, 2: { '1142_000003': course('000003', '丙') } },
          'DEP-C': [],
        }
        const v = data[p.m_dep_uid]
        return Array.isArray(v) ? v : { [p.m_dep_uid]: v }
      }
      default: throw new Error('unexpected ' + fn)
    }
  }
  return { fetchJson, calls }
}

test('走完整棵樹、系所去重、課程去重', async () => {
  const { fetchJson, calls } = fakeServer()
  const r = await crawlSemester({ fetchJson, concurrency: 2 })
  assert.equal(r.semester, '1142')
  assert.deepEqual(r.courses.map((x) => x.id).sort(), ['000001', '000002', '000003'])
  const depCalls = calls.filter((c) => c.fn === 'get_cos_list').map((c) => c.p.m_dep_uid).sort()
  assert.deepEqual(depCalls, ['DEP-A', 'DEP-B', 'DEP-C'])
})

test('樹狀查詢帶正確參數', async () => {
  const { fetchJson, calls } = fakeServer()
  await crawlSemester({ fetchJson, concurrency: 1 })
  const cat = calls.find((c) => c.fn === 'get_category')
  assert.equal(cat.method, 'POST')
  assert.deepEqual(cat.p, { ftype: 'T1', flang: 'zh-tw', acysem: '1142', acysemend: '1142' })
  const depNoCollege = calls.find((c) => c.fn === 'get_dep' && c.p.ftype === 'T2')
  assert.equal(depNoCollege.p.fcollege, '*')
  assert.equal(depNoCollege.p.fcategory, '0G')
  const cos = calls.find((c) => c.fn === 'get_cos_list')
  assert.equal(cos.p.m_selcampus, '**')
  assert.equal(cos.p.m_acy, '114')
  assert.equal(calls.find((c) => c.fn === 'get_acysem').method, 'GET')
  assert.equal(calls.find((c) => c.fn === 'get_type').method, 'GET')
})

test('回報進度，最後一次 done 等於 total', async () => {
  const { fetchJson } = fakeServer()
  const events = []
  await crawlSemester({ fetchJson, concurrency: 2, onProgress: (e) => events.push(e) })
  assert.equal(events[0].phase, 'tree')
  const courseEvents = events.filter((e) => e.phase === 'courses')
  assert.ok(courseEvents.length >= 1)
  const last = courseEvents.at(-1)
  assert.equal(last.total, 3)
  assert.equal(last.done, 3)
})

test('單一系所失敗會重試', async () => {
  const { fetchJson, calls } = fakeServer({ failDep: 'DEP-B', failTimes: 2 })
  const r = await crawlSemester({ fetchJson, concurrency: 1 })
  assert.equal(r.courses.length, 3)
  assert.equal(calls.filter((c) => c.fn === 'get_cos_list' && c.p.m_dep_uid === 'DEP-B').length, 3)
})

test('重試用完仍失敗則整體 reject', async () => {
  const { fetchJson } = fakeServer({ failDep: 'DEP-B', failTimes: 99 })
  await assert.rejects(crawlSemester({ fetchJson, concurrency: 1 }), /DEP-B/)
})

test('併發數不超過設定值', async () => {
  const { fetchJson: base } = fakeServer()
  let active = 0
  let peak = 0
  const fetchJson = async (fn, opts) => {
    if (fn !== 'get_cos_list') return base(fn, opts)
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 5))
    try { return await base(fn, opts) } finally { active-- }
  }
  await crawlSemester({ fetchJson, concurrency: 2 })
  assert.equal(peak, 2)
})
