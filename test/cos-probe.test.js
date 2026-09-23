// tools/cos-probe.js 是實測選課網用的工具，會真的寫入使用者的選課資料。
// 這裡用假的 fetch 把它整支跑一遍，確認：實驗都跑得起來、安全規則擋得住、結束會比對狀態。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../tools/cos-probe.js', import.meta.url), 'utf8')

// 假選課網：一門有上限的課、一門不限人數無群組的課（安全閘要擋）、一門已選上的課（絕不能取消）
function makeCos() {
  const calls = []
  const courses = {
    '111': { cos_id: '111', cos_cname: '有上限無群組', num_limit: '40', GroupUID: null, cos_type_code: '2', wType: 'X', status: 'success', cmsg: '' },
    '222': { cos_id: '222', cos_cname: '不限人數無群組', num_limit: '不限', GroupUID: null, cos_type_code: '2', wType: 'X', status: 'success', cmsg: '' },
    '333': { cos_id: '333', cos_cname: '志願群組', num_limit: '50', GroupUID: 'G1', cos_type_code: '1', wType: '5', status: 'success', cmsg: '' },
  }
  const preregist = [
    { cos_id: '111', cos_cname: '有上限無群組', menu_data: '{&quot;type&quot;:1,&quot;dep_uid&quot;:&quot;D1&quot;}', category_type: '', wType: 'X', cos_type_code: '2' },
    { cos_id: '333', cos_cname: '志願群組', menu_data: '{&quot;type&quot;:3,&quot;dep_uid&quot;:&quot;D2&quot;}', category_type: '', wType: '5', cos_type_code: '1' },
  ]
  const registered = [{ cos_id: '999', cos_cname: '已選上的課', sFlag: 'F', cos_credit: '3.00' }]
  const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })

  const fetchMock = async (url, opts) => {
    const path = String(url).replace('https://cos.nycu.edu.tw/', '')
    const params = Object.fromEntries(new URLSearchParams(opts.body))
    calls.push({ path, params })
    switch (path) {
      case 'getpreregist': return json(preregist)
      case 'getregist': return json(registered)
      case 'getsemregist': return json([])
      case 'userinfo': return json({ type: 1, dep_category: '3*', college_no: 'S', dep_uid: 'D1', grade: '1', class: '*' })
      case 'getCosCategoryWish': return json({ G1: { GroupName: '測試群組', wish_limit: '6', cos_limit: '1', wish: { 1: '0', 2: '0', 3: '0', 4: '0', 5: '0', 6: '0', F: '0' } } })
      case 'checkreg': case 'checkdistribute': return json({ status: 'success', cmsg: '', emsg: '' })
      case 'sysstatuslvl': return json([{ status: '1', cmsg: '系統暢通無阻' }])
      case 'getdep': case 'getquesttime': case 'getquestlist': return json({ status: 'error', msg: '' })
      case 'preregistcourse': return json(params.codition === undefined ? { status: 'error', msg: '' } : Object.values(courses))
      case 'getregistrationcourselist': {
        const c = courses[params.cos_id]
        return json(c && params.dep_uid ? { [params.cos_id]: c } : [])
      }
      case 'setpreregist': {
        if (!params.wType && params.wType !== '') return json({ status: 'error', msg: '' })
        if (preregist.some((c) => String(c.cos_id) === String(params.cos_id))) return json([{ status: 'error', msg: '重複預選' }])
        preregist.push({ cos_id: params.cos_id, menu_data: params.menu_data, category_type: params.category_type, wType: params.wType || 'X', cos_type_code: '2' })
        return json([{ status: 'success', msg: '' }])
      }
      case 'deletepreregist': {
        const i = preregist.findIndex((c) => String(c.cos_id) === String(params.cos_id))
        if (i < 0) return json([{ status: 'error', msg: '無此選課預選資料' }])
        preregist.splice(i, 1)
        return json([{ status: 'success', msg: '' }])
      }
      case 'setregist': {
        const c = courses[params.cos_id]
        if (!c) return json([{ status: 'error', cmsg: '無權限加選', errortype: 'nopriority' }])
        if (registered.some((r) => String(r.cos_id) === String(params.cos_id))) return json([{ status: 'error', cmsg: '重複選課' }])
        const sFlag = c.GroupUID ? (Number(params.wish) > 6 ? null : params.wish) : '1'
        if (sFlag === null) return json([{ status: 'error', cmsg: '志願登記超過規定數量(wrong option)', errortype: 'wish' }])
        registered.push({ cos_id: params.cos_id, sFlag, GroupUID: c.GroupUID, cos_type_code: params.cos_type_code, student_wtype: params.wType, cos_credit: '3.00' })
        return json([{ status: 'success', cmsg: '' }])
      }
      case 'deleteregist': {
        const i = registered.findIndex((r) => String(r.cos_id) === String(params.cos_id))
        if (i < 0) return json([{ status: 'error', cmsg: '無此選課資料' }])
        registered.splice(i, 1)
        return json([{ status: 'success', cmsg: '' }])
      }
      default: return json({ status: 'error', msg: 'unknown ' + path })
    }
  }
  return { fetchMock, calls, registered, preregist, courses }
}

function load(cos) {
  const win = {}
  const ctx = {
    window: win, fetch: cos.fetchMock, performance: { now: () => 0 },
    sessionStorage: { getItem: () => null }, localStorage: { getItem: () => 'fake-token' }, console: { log() {}, warn() {}, error() {} },
    URLSearchParams, JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Map, Error, Promise, setTimeout,
  }
  vm.createContext(ctx)
  vm.runInContext(SRC, ctx)
  return win.cosProbe
}

test('cosProbe 唯讀實驗跑得完，而且不寫入任何東西', async () => {
  const cos = makeCos()
  const probe = load(cos)
  const { meta, count } = await probe.run({ writes: false })
  assert.ok(count > 15, `唯讀實驗應該有一定數量，實際 ${count}`)
  const writePaths = cos.calls.filter((c) => ['setregist', 'deleteregist', 'setpreregist', 'deletepreregist'].includes(c.path))
  assert.deepEqual(writePaths, [], '唯讀模式不可以呼叫任何寫入端點')
  assert.equal(meta.restored.預排相同, true)
  assert.equal(meta.restored.正式選課相同, true)
})

test('寫入實驗跑完後狀態會還原，而且回報還原結果', async () => {
  const cos = makeCos()
  const probe = load(cos)
  const { meta } = await probe.run({ writes: true })
  assert.equal(meta.restored.預排相同, true, '預排應該還原')
  assert.equal(meta.restored.正式選課相同, true, '正式選課應該還原')
  assert.equal(meta.restored.全部已選上, true)
  assert.deepEqual(cos.registered.map((r) => r.cos_id), ['999'], '只剩原本那門已選上的課')
})

test('安全閘：不限人數又沒有志願群組的課不准登記', async () => {
  const cos = makeCos()
  const probe = load(cos)
  await assert.rejects(
    () => probe.safeRegister('222', { cos_type_code: '2', wType: 'X', wish: '1', category_type: '' }, cos.courses['222']),
    /安全閘/,
    '這種課送出會直接選上，之後只能退選，必須擋下來',
  )
  assert.equal(cos.calls.some((c) => c.path === 'setregist'), false)
})

test('安全閘：已選上的課不准取消（等同退選）', async () => {
  const cos = makeCos()
  const probe = load(cos)
  await assert.rejects(() => probe.safeCancel('999'), /安全閘/)
  assert.equal(cos.calls.some((c) => c.path === 'deleteregist'), false)
  assert.deepEqual(cos.registered.map((r) => r.cos_id), ['999'])
})

test('安全閘：沒有 guard 資料時一律不登記', async () => {
  const cos = makeCos()
  const probe = load(cos)
  await assert.rejects(() => probe.safeRegister('111', { wish: '1' }, null), /安全閘/)
})

test('工具不會呼叫 setAnswers 或 OTP 端點', async () => {
  const cos = makeCos()
  const probe = load(cos)
  await probe.run({ writes: true })
  const forbidden = cos.calls.filter((c) => ['setAnswers', 'setotp', 'checkotp'].includes(c.path))
  assert.deepEqual(forbidden, [], '這些端點會送出真實問卷或影響登入，不可以碰')
})
