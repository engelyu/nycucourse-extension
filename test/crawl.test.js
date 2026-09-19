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
          'DEP-A': { 1: { '1142_000001': course('000001', '甲'), '1142_000002': course('000002', '乙') }, brief: { '1142_000002': { Z102: {} } } },
          'DEP-B': { 1: { '1142_000002': course('000002', '乙') }, 2: { '1142_000003': course('000003', '丙') }, brief: { '1142_000002': { Z204: {} } } },
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

const noSleep = async () => {}

test('單一系所失敗會重試', async () => {
  const { fetchJson, calls } = fakeServer({ failDep: 'DEP-B', failTimes: 2 })
  const r = await crawlSemester({ fetchJson, concurrency: 1, sleep: noSleep })
  assert.equal(r.courses.length, 3)
  assert.equal(calls.filter((c) => c.fn === 'get_cos_list' && c.p.m_dep_uid === 'DEP-B').length, 3)
})

test('重試之間逐次拉長等待時間', async () => {
  const { fetchJson } = fakeServer({ failDep: 'DEP-B', failTimes: 2 })
  const delays = []
  await crawlSemester({ fetchJson, concurrency: 1, retryDelayMs: 500, sleep: async (ms) => { delays.push(ms) } })
  assert.deepEqual(delays, [500, 1000])
})

test('第一次就成功時不等待', async () => {
  const { fetchJson } = fakeServer()
  const delays = []
  await crawlSemester({ fetchJson, concurrency: 2, sleep: async (ms) => { delays.push(ms) } })
  assert.deepEqual(delays, [])
})

test('少數系所失敗時仍完成，並回報失敗的系所', async () => {
  const { fetchJson } = fakeServer({ failDep: 'DEP-B', failTimes: 99 })
  const r = await crawlSemester({ fetchJson, concurrency: 1, sleep: noSleep })
  assert.deepEqual(r.failedDeps, ['DEP-B'])
  // DEP-A 的兩門課仍在
  assert.deepEqual(r.courses.map((c) => c.id).sort(), ['000001', '000002'])
})

test('失敗數超過容許值時整體 reject', async () => {
  const { fetchJson } = fakeServer({ failDep: 'DEP-B', failTimes: 99 })
  await assert.rejects(crawlSemester({ fetchJson, concurrency: 1, sleep: noSleep, maxFailedDeps: 0 }), /DEP-B/)
})

test('全部系所都失敗時整體 reject，不會回傳空課程', async () => {
  const { fetchJson: base } = fakeServer()
  const fetchJson = async (fn, opts) => {
    if (fn === 'get_cos_list') throw new Error('boom')
    return base(fn, opts)
  }
  await assert.rejects(crawlSemester({ fetchJson, concurrency: 1, sleep: noSleep, maxFailedDeps: 5 }), /抓取失敗/)
})

// DEP-A 立刻徹底失敗；DEP-B 由第二個 worker 處理但很慢，失敗發生時它還在跑
function slowBServer() {
  const server = fakeServer({ failDep: 'DEP-A', failTimes: 99 })
  const fetchJson = async (fn, opts) => {
    if (fn === 'get_cos_list' && new URLSearchParams(opts.body).get('m_dep_uid') === 'DEP-B') {
      await new Promise((r) => setTimeout(r, 30))
    }
    return server.fetchJson(fn, opts)
  }
  return { fetchJson, calls: server.calls }
}

test('超過容許值後，其他 worker 不再抓新的系所', async () => {
  const { fetchJson, calls } = slowBServer()
  await assert.rejects(crawlSemester({ fetchJson, concurrency: 2, sleep: noSleep, maxFailedDeps: 0 }), /DEP-A/)
  await new Promise((r) => setTimeout(r, 60))
  const byDep = (uid) => calls.filter((c) => c.fn === 'get_cos_list' && c.p.m_dep_uid === uid).length
  assert.equal(byDep('DEP-B'), 1)
  assert.equal(byDep('DEP-C'), 0)
})

test('超過容許值後，還在跑的 worker 完成時不再回報課程進度', async () => {
  const { fetchJson } = slowBServer()
  const events = []
  await assert.rejects(crawlSemester({ fetchJson, concurrency: 2, sleep: noSleep, maxFailedDeps: 0, onProgress: (e) => events.push(e) }))
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(events.filter((e) => e.phase === 'courses' && e.done > 0).length, 0)
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

test('找不到任何系所時丟錯，不回傳空課程', async () => {
  const fetchJson = async (fn) => {
    if (fn === 'get_acysem') return [{ T: '1151' }]
    if (fn === 'get_type') return ''
    return []
  }
  await assert.rejects(crawlSemester({ fetchJson, sleep: noSleep }), /找不到任何系所/)
})

test('所有系所都沒有課程時丟錯，不回傳空課程', async () => {
  const { fetchJson: base } = fakeServer()
  const fetchJson = async (fn, opts) => (fn === 'get_cos_list' ? [] : base(fn, opts))
  await assert.rejects(crawlSemester({ fetchJson, sleep: noSleep }), /沒有抓到任何課程/)
})

test('讀取系所清單時每個請求後都回報進度', async () => {
  const { fetchJson, calls } = fakeServer()
  const events = []
  await crawlSemester({ fetchJson, concurrency: 1, sleep: noSleep, onProgress: (e) => events.push(e) })
  const treeFns = ['get_acysem', 'get_type', 'get_category', 'get_college', 'get_dep']
  const treeRequests = calls.filter((c) => treeFns.includes(c.fn)).length
  const treeEvents = events.filter((e) => e.phase === 'tree').length
  assert.ok(treeEvents >= treeRequests, `tree events ${treeEvents} < requests ${treeRequests}`)
})

test('沒有失敗時 failedDeps 是空陣列', async () => {
  const { fetchJson } = fakeServer()
  const r = await crawlSemester({ fetchJson, concurrency: 2, sleep: noSleep })
  assert.deepEqual(r.failedDeps, [])
})

test('多系合開的課記下所有出現過的系所', async () => {
  const { fetchJson } = fakeServer()
  const r = await crawlSemester({ fetchJson, concurrency: 1 })
  const shared = r.courses.find((x) => x.id === '000002')
  assert.deepEqual(shared.menus.map((m) => m.dep_uid).sort(), ['DEP-A', 'DEP-B'])
  assert.equal(shared.menu.dep_uid, shared.menus[0].dep_uid)
  const single = r.courses.find((x) => x.id === '000003')
  assert.deepEqual(single.menus.map((m) => m.dep_uid), ['DEP-B'])
})

test('多系合開的課合併各系的類別代碼', async () => {
  const { fetchJson } = fakeServer()
  const r = await crawlSemester({ fetchJson, concurrency: 1 })
  assert.deepEqual(r.courses.find((x) => x.id === '000002').brief.sort(), ['Z102', 'Z204'])
})
