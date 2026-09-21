import { test } from 'node:test'
import assert from 'node:assert/strict'
import '../src/lib/classify.js'

const { classifyResult, confirmWithList, removalBlock, cancelBlock, preregParamsProblem } = globalThis.NycuClassify

test('空回應代表成功加入', () => {
  assert.deepEqual(classifyResult('516702', ''), { id: '516702', status: 'added', msg: '' })
})

test('重複預選歸類為 exists', () => {
  const body = JSON.stringify([{ status: 'error', msg: '重複預選' }])
  assert.deepEqual(classifyResult('563018', body), { id: '563018', status: 'exists', msg: '重複預選' })
})

test('其他錯誤歸類為 error 並附訊息', () => {
  const body = JSON.stringify([{ status: 'error', msg: '選課預選失敗' }])
  assert.deepEqual(classifyResult('999999', body), { id: '999999', status: 'error', msg: '選課預選失敗' })
})

test('無法解析的回應歸類為 error', () => {
  const r = classifyResult('516702', '<html>Service Unavailable</html>')
  assert.equal(r.status, 'error')
  assert.equal(r.msg, '無法解析選課網回應')
})

test('confirmWithList 把未出現在清單的 added 改成 error', () => {
  const results = [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'added', msg: '' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ]
  const out = confirmWithList(results, ['516702', '563018'])
  assert.deepEqual(out, [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'error', msg: '加入後未出現在預排清單' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ])
  assert.equal(results[1].status, 'added')
})

test('HTTP 非 2xx 一律視為失敗並附狀態碼，即使回應是空字串', () => {
  assert.deepEqual(classifyResult('516702', '', 503), { id: '516702', status: 'error', msg: '選課網錯誤（HTTP 503）' })
  assert.deepEqual(classifyResult('516702', '<html>blocked</html>', 403), { id: '516702', status: 'error', msg: '選課網錯誤（HTTP 403）' })
})

test('沒給狀態碼或 2xx 時照原本規則分類', () => {
  assert.equal(classifyResult('516702', '').status, 'added')
  assert.equal(classifyResult('516702', '', 200).status, 'added')
  assert.equal(classifyResult('563018', JSON.stringify([{ status: 'error', msg: '重複預選' }]), 200).status, 'exists')
})

test('classify.js 是一般腳本，不用 export 也能掛到 globalThis', () => {
  assert.equal(typeof globalThis.NycuClassify.tokenUsable, 'function')
})

const { runBatch } = globalThis.NycuClassify

test('runBatch 全部成功並以預排清單確認', async () => {
  const added = new Set()
  const addOne = async (id) => { added.add(id); return classifyResult(id, '') }
  const r = await runBatch(['516701', '516702'], addOne, async () => [...added])
  assert.deepEqual(r, {
    ok: true,
    results: [
      { id: '516701', status: 'added', msg: '' },
      { id: '516702', status: 'added', msg: '' },
    ],
  })
})

test('runBatch 中途網路錯誤：保留前面結果，後面標示未送出', async () => {
  const added = new Set()
  const addOne = async (id) => {
    if (id === '516702') throw new Error('Failed to fetch')
    added.add(id)
    return classifyResult(id, '')
  }
  const r = await runBatch(['516701', '516702', '516703'], addOne, async () => [...added])
  assert.equal(r.ok, true)
  assert.deepEqual(r.results, [
    { id: '516701', status: 'added', msg: '' },
    { id: '516702', status: 'error', msg: '網路錯誤：Failed to fetch' },
    { id: '516703', status: 'error', msg: '未送出：前一門發生網路錯誤' },
  ])
})

test('runBatch 無法讀取預排清單：已送出的課標示無法確認並附警告', async () => {
  const r = await runBatch(['516701'], async (id) => classifyResult(id, ''), async () => { throw new Error('Failed to fetch') })
  assert.equal(r.ok, true)
  assert.deepEqual(r.results, [{ id: '516701', status: 'added', msg: '已送出，但無法確認是否加入' }])
  assert.equal(r.warning, '無法確認加入結果：Failed to fetch')
})

test('runBatch 預排清單回 null 代表登入失效', async () => {
  const r = await runBatch(['516701'], async (id) => classifyResult(id, ''), async () => null)
  assert.deepEqual(r, { ok: false, reason: 'not_logged_in' })
})

const { parseSysStatus } = globalThis.NycuClassify

test('parseSysStatus 取出中文訊息與狀態碼', () => {
  const body = JSON.stringify({ status: '2', cmsg: '目前非選課時段', emsg: 'Course selection is closed' })
  assert.deepEqual(parseSysStatus(body), { code: '2', message: '目前非選課時段' })
})

test('parseSysStatus 接受陣列包起來的回應', () => {
  const body = JSON.stringify([{ status: 3, cmsg: '系統維護中', emsg: 'Under maintenance' }])
  assert.deepEqual(parseSysStatus(body), { code: '3', message: '系統維護中' })
})

test('parseSysStatus 沒有中文訊息時退回英文', () => {
  const body = JSON.stringify({ status: '1', cmsg: '   ', emsg: 'System is open' })
  assert.deepEqual(parseSysStatus(body), { code: '1', message: 'System is open' })
})

test('parseSysStatus 沒有訊息時回傳 null', () => {
  assert.equal(parseSysStatus(JSON.stringify({ status: '1', cmsg: '', emsg: '' })), null)
  assert.equal(parseSysStatus(''), null)
  assert.equal(parseSysStatus('   '), null)
  assert.equal(parseSysStatus('<html>not json</html>'), null)
  assert.equal(parseSysStatus(JSON.stringify([])), null)
  assert.equal(parseSysStatus(null), null)
})

test('parseSysStatus 沒有狀態碼時 code 為空字串', () => {
  assert.deepEqual(parseSysStatus(JSON.stringify({ cmsg: '公告' })), { code: '', message: '公告' })
})

test('removalBlock：讀不到正式選課或課已在正式選課時不移除', () => {
  assert.equal(removalBlock(null, '516701'), '讀不到正式選課清單，先不移除')
  assert.equal(removalBlock([{ cos_id: '516701' }], '516701'), '這門課已在正式選課，不能從這裡移除')
  assert.equal(removalBlock([{ cos_id: 516701 }], '516701'), '這門課已在正式選課，不能從這裡移除')
  assert.equal(removalBlock([], '516701'), '')
})

// 取消登記（deleteregist）只能用在「已登記」的課。已選上（sFlag F）的課取消就是退選，
// 停修（PFW W）的課也不碰。讀不到清單時一律不動。
test('cancelBlock 只放行已登記的課', () => {
  assert.equal(cancelBlock(null, '516713'), '讀不到正式選課清單，先不取消')
  assert.equal(cancelBlock([], '516713'), '這門課不在正式選課清單裡')
  assert.equal(cancelBlock([{ cos_id: '516713', sFlag: 'F' }], '516713'), '這門課已經選上，取消等於退選，不能從這裡做')
  assert.equal(cancelBlock([{ cos_id: '516713', sFlag: 'F', Lock: '1' }], '516713'), '這門課已經選上，取消等於退選，不能從這裡做')
  assert.equal(cancelBlock([{ cos_id: '516713', sFlag: '2', PFW: 'W' }], '516713'), '這門課是停修狀態，不能從這裡取消')
  assert.equal(cancelBlock([{ cos_id: '516713', sFlag: '2' }], '516713'), '')
  assert.equal(cancelBlock([{ cos_id: 516713, sFlag: '1' }], '516713'), '')
})

// 報告 §1.2：setpreregist 會照收任何 menu_data（包括 {}），但選課網自己之後就查不到這門課，
// 使用者看到「已加入」卻完全不能選。所以沒有有效選單路徑一律不寫入。
test('preregParamsProblem 擋下沒有有效選單路徑的加入', () => {
  const ok = { cos_id: '516702', menu_data: JSON.stringify({ type: 1, dep_category: '3*', college_no: 'S', dep_uid: 'A0C3EB6F', group: '*', grade: '*', class: '*' }), wType: 'X', GroupName: 'null', GroupName_E: 'null', category_type: '', category_cname: 'null', category_ename: 'null' }
  assert.equal(preregParamsProblem(ok), '')
  assert.match(preregParamsProblem(undefined), /選單路徑/)
  assert.match(preregParamsProblem(null), /選單路徑/)
  assert.match(preregParamsProblem({ ...ok, menu_data: '{}' }), /選單路徑/)
  assert.match(preregParamsProblem({ ...ok, menu_data: '' }), /選單路徑/)
  assert.match(preregParamsProblem({ ...ok, menu_data: 'not-json' }), /選單路徑/)
  assert.match(preregParamsProblem({ ...ok, menu_data: JSON.stringify({ type: 1 }) }), /選單路徑/, '沒有 dep_uid 的選單也查不到')
  assert.match(preregParamsProblem({ ...ok, wType: '' }), /類別/)
  // 從預排讀回來的 menu_data 會是 &quot; 編碼，還原時也要能判斷
  assert.equal(preregParamsProblem({ ...ok, menu_data: ok.menu_data.replace(/"/g, '&quot;') }), '')
})
