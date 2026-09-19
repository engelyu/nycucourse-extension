import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegInfo, describeAvailability, parseRegResult, wishOptions, registerParams } from '../src/lib/register.js'

const okRecord = {
  cos_id: '516701',
  cos_cname: '計算機概論（一）',
  cos_type_code: '1',
  wType: 'X',
  wType_cname: '一般課程',
  num_limit: '70',
  registered_num: '64',
  conflict_num: '0',
  blocked: '0',
  GroupUID: null,
  status: 'success',
  cmsg: '',
  emsg: '',
}

const blockedRecord = {
  ...okRecord,
  cos_id: '516703',
  cos_cname: '分析導論(一)',
  num_limit: '60',
  registered_num: '60',
  conflict_num: '3',
  conflict_cmsg: '衝堂',
  blocked: '1',
  status: 'error',
  cmsg: '未開放，如有疑問請洽「主開單位」助理。',
}

const peRecord = {
  ...okRecord,
  cos_id: '563038',
  cos_cname: '體育－羽球甲A',
  wType: '2',
  wType_cname: '體育',
  GroupUID: 'PE-GROUP',
  num_limit: '不限',
  registered_num: '30',
  first_wish_reserved_num: '12',
  second_wish_reserved_num: '3',
  third_wish_reserved_num: '1',
  fourth_wish_reserved_num: '0',
  fifth_wish_reserved_num: '0',
}

test('parseRegInfo 取出指定課號的資料', () => {
  assert.deepEqual(parseRegInfo({ 516701: okRecord }, '516701'), okRecord)
  assert.equal(parseRegInfo({ 516701: okRecord }, '999999'), null)
  assert.equal(parseRegInfo(null, '516701'), null)
  assert.equal(parseRegInfo('', '516701'), null)
})

test('可以加選時回報人數與沒有阻擋原因', () => {
  const a = describeAvailability(okRecord)
  assert.equal(a.canRegister, true)
  assert.equal(a.needsWish, false)
  assert.equal(a.seats, '64/70 人')
  assert.deepEqual(a.reasons, [])
  assert.equal(a.message, '')
})

test('不能加選時用伺服器的訊息，並列出衝堂與額滿', () => {
  const a = describeAvailability(blockedRecord)
  assert.equal(a.canRegister, false)
  assert.equal(a.message, '未開放，如有疑問請洽「主開單位」助理。')
  assert.ok(a.reasons.includes('與 3 門已選課程衝堂'))
  assert.ok(a.reasons.includes('人數已滿'))
})

test('已額滿但可加選時仍提醒額滿', () => {
  const a = describeAvailability({ ...okRecord, registered_num: '70' })
  assert.equal(a.canRegister, true)
  assert.ok(a.reasons.includes('人數已滿'))
})

test('分發課程需要志願序', () => {
  const a = describeAvailability(peRecord)
  assert.equal(a.needsWish, true)
  assert.equal(a.groupUid, 'PE-GROUP')
  assert.equal(a.seats, '已選 30 人 · 不限人數')
})

test('沒有資料時視為不能加選', () => {
  const a = describeAvailability(null)
  assert.equal(a.canRegister, false)
  assert.equal(a.message, '查不到這門課的加選資訊')
})

test('wishOptions 列出志願與目前佔用情形', () => {
  const group = { GroupName: '體育', wish_limit: '5', cos_limit: '1', wish: { 1: '563018', 2: '0', 3: '0', 4: '0', 5: '0', F: '0' } }
  const options = wishOptions(group, peRecord)
  assert.equal(options.length, 5)
  assert.deepEqual(options[0], { no: 1, takenBy: '563018', isThisCourse: false, reserved: '12' })
  assert.deepEqual(options[1], { no: 2, takenBy: '', isThisCourse: false, reserved: '3' })
  const mine = wishOptions({ ...group, wish: { 1: '563038', 2: '0', 3: '0', 4: '0', 5: '0' } }, peRecord)
  assert.equal(mine[0].isThisCourse, true)
})

test('沒有群組資料時沒有志願可選', () => {
  assert.deepEqual(wishOptions(null, peRecord), [])
})

test('registerParams 組出送出加選的欄位', () => {
  assert.deepEqual(registerParams(okRecord, ''), {
    cos_id: '516701',
    cos_type_code: '1',
    wType: 'X',
    wish: '',
    category_type: '',
  })
  assert.deepEqual(registerParams(peRecord, 2), {
    cos_id: '563038',
    cos_type_code: '1',
    wType: '2',
    wish: '2',
    category_type: '',
  })
  assert.equal(registerParams({ ...okRecord, category_type: 'A501' }, '').category_type, 'A501')
})

test('parseRegResult 解讀加選結果', () => {
  assert.deepEqual(parseRegResult([{ status: 'success', cmsg: '', emsg: '' }]), { ok: true, message: '加選成功' })
  assert.deepEqual(parseRegResult([{ status: 'error', cmsg: '人數已滿', emsg: 'Full' }]), { ok: false, message: '人數已滿' })
  assert.deepEqual(parseRegResult({ status: 'success' }), { ok: true, message: '加選成功' })
  assert.deepEqual(parseRegResult(''), { ok: false, message: '選課網沒有回應內容' })
  assert.deepEqual(parseRegResult('<html>'), { ok: false, message: '無法解析選課網回應' })
})

test('parseMenuData 解析預排資料自帶的查詢路徑', async () => {
  const { parseMenuData } = await import('../src/lib/register.js')
  // 選課網回傳時會把引號變成 &quot;
  const raw = '{&quot;type&quot;:3,&quot;dep_category&quot;:&quot;0G&quot;,&quot;college_no&quot;:&quot;*&quot;,&quot;dep_uid&quot;:&quot;A91F7169&quot;,&quot;group&quot;:&quot;Z10[0-4]&quot;,&quot;grade&quot;:&quot;&quot;,&quot;class&quot;:&quot;&quot;}'
  assert.deepEqual(parseMenuData(raw), {
    type: 3, dep_category: '0G', college_no: '*', dep_uid: 'A91F7169', group: 'Z10[0-4]', grade: '', class: '',
  })
  assert.deepEqual(parseMenuData('{"type":1,"dep_uid":"X"}'), { type: 1, dep_uid: 'X' })
  assert.equal(parseMenuData(''), null)
  assert.equal(parseMenuData('not json'), null)
  assert.equal(parseMenuData(null), null)
})

test('menuForCourse 以預排自帶的路徑優先，沒有才用課程資料', async () => {
  const { menuForCourse } = await import('../src/lib/register.js')
  const crawlMenu = { type: '3', dep_category: '0G', college_no: '', dep_uid: 'TIMETABLE-UID' }
  const course = {
    cos_id: '561068',
    menu_data: '{"type":3,"dep_category":"0G","college_no":"*","dep_uid":"COS-UID","group":"Z10[0-4]","grade":"","class":""}',
    category_type: 'DF91BC7C',
  }
  assert.deepEqual(menuForCourse(course, crawlMenu), {
    type: 3, dep_category: '0G', college_no: '*', dep_uid: 'COS-UID', group: 'Z10[0-4]', grade: '', class: '', category_type: 'DF91BC7C',
  })
  assert.deepEqual(menuForCourse({ cos_id: '516701' }, crawlMenu), { ...crawlMenu, category_type: '' })
  assert.equal(menuForCourse({ cos_id: '516701' }, null), null)
})

test('通識課的加選資料帶有類別與志願群組', () => {
  const record = {
    cos_id: '561068', cos_cname: '生死學', cos_type_code: 'E', wType: 'E', wType_cname: '核心課程',
    num_limit: '70', registered_num: '70', GroupUID: '51CE2C18', category_type: 'DF91BC7C',
    category_cname: '基本素養-生命及品格教育', status: 'success', cmsg: '', emsg: '', conflict_num: '0',
  }
  const a = describeAvailability(record)
  assert.equal(a.canRegister, true)
  assert.equal(a.needsWish, true)
  assert.ok(a.reasons.includes('人數已滿'))
  assert.deepEqual(registerParams(record, 1), {
    cos_id: '561068', cos_type_code: 'E', wType: 'E', wish: '1', category_type: 'DF91BC7C',
  })
})

test('registrationState 區分已選上與登記中', async () => {
  const { registrationState } = await import('../src/lib/register.js')
  // 有志願群組且 sFlag 是數字 → 登記中
  assert.deepEqual(registrationState({ cos_id: '561068', sFlag: '1', GroupUID: '51CE2C18' }), { state: 'wish', wishNo: 1 })
  // sFlag 是 F → 已選上，即使屬於志願群組
  assert.deepEqual(registrationState({ cos_id: '515506', sFlag: 'F', GroupUID: 'CB7B23E2' }), { state: 'registered', wishNo: null })
  assert.deepEqual(registrationState({ cos_id: '516700', sFlag: 'F', GroupUID: null }), { state: 'registered', wishNo: null })
  // 沒有群組就算 sFlag 是數字也當成已選上
  assert.deepEqual(registrationState({ cos_id: 'x', sFlag: '2', GroupUID: null }), { state: 'registered', wishNo: null })
  assert.deepEqual(registrationState(null), { state: 'registered', wishNo: null })
})

test('describeRegistration 產生畫面文字', async () => {
  const { describeRegistration } = await import('../src/lib/register.js')
  assert.equal(describeRegistration({ sFlag: '1', GroupUID: 'G' }), '已登記（第 1 志願）')
  assert.equal(describeRegistration({ sFlag: '3', GroupUID: 'G' }), '已登記（第 3 志願）')
  assert.equal(describeRegistration({ sFlag: 'F', GroupUID: 'G' }), '已選上')
  assert.equal(describeRegistration({ sFlag: 'F' }), '已選上')
})

// 2026-09-19 實測：擴充功能加入的預排 menu_data 是 {}，選課網用它查不到課
test('parseMenuData 把空的 {} 當成沒有路徑', async () => {
  const { parseMenuData, menuForCourse } = await import('../src/lib/register.js')
  assert.equal(parseMenuData('{}'), null)
  const crawlMenu = { type: '1', dep_category: '3*', college_no: 'I', dep_uid: 'DEP' }
  assert.deepEqual(menuForCourse({ menu_data: '{}', category_type: '' }, crawlMenu), { ...crawlMenu, category_type: '' })
})

// 取自 getdep 的真實結構：學士班共同課程 > 院共同課程 > 全部 > 電機系共同課程 > 各課程群組
const depTree = [
  { label: '學士班課程', value: '1', children: [] },
  {
    label: '學士班共同課程',
    value: '3',
    children: [
      {
        label: '院共同課程',
        value: '0C',
        children: [
          {
            label: '全部',
            value: '*',
            children: [
              {
                label: '電機系共同課程',
                value: 'EE',
                children: [
                  { label: '機率', value: '機率' },
                  { label: '線性代數', value: '線性代數' },
                  { label: '電路學', value: '電路學' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

test('groupMenus 依系所代碼找出選課網的課程群組路徑，課名相符的排前面', async () => {
  const { groupMenus } = await import('../src/lib/register.js')
  const menus = groupMenus(depTree, 'EE', '線性代數')
  assert.equal(menus.length, 3)
  assert.deepEqual(menus[0], { type: '3', dep_category: '0C', college_no: '*', dep_uid: 'EE', group: '線性代數', grade: '', class: '' })
  assert.deepEqual(groupMenus(depTree, 'NOPE', '線性代數'), [])
  assert.deepEqual(groupMenus(null, 'EE', 'x'), [])
})

test('resolveRegInfo 課程時間表路徑查不到時改試選課網的課程群組', async () => {
  const { resolveRegInfo } = await import('../src/lib/register.js')
  const course = { cos_id: '515044', cos_cname: '線性代數', menu_data: '{}', category_type: '' }
  const timetableMenu = { type: '1', dep_category: '3*', college_no: 'I', dep_uid: 'EE' }
  const asked = []
  const askRegInfo = async (menu) => {
    asked.push(menu.group ?? '(timetable)')
    if (menu.group === '線性代數') return { ok: true, json: { 515044: { status: 'error', cmsg: '未開放', cos_type_code: '1' } } }
    return { ok: true, json: [] }
  }
  const result = await resolveRegInfo({ course, timetableMenu, askRegInfo, getDepTree: async () => depTree })
  assert.equal(result.ok, true)
  assert.equal(result.record.cmsg, '未開放')
  assert.deepEqual(asked, ['(timetable)', '線性代數'])
})

test('resolveRegInfo 第一次就查到時不讀系所樹；連線失敗直接回傳', async () => {
  const { resolveRegInfo } = await import('../src/lib/register.js')
  const course = { cos_id: '1', menu_data: '{}', category_type: '' }
  const timetableMenu = { type: '1', dep_uid: 'EE' }
  let treeCalls = 0
  const getDepTree = async () => { treeCalls++; return depTree }
  const found = await resolveRegInfo({ course, timetableMenu, askRegInfo: async () => ({ ok: true, json: { 1: { status: 'success' } } }), getDepTree })
  assert.equal(found.record.status, 'success')
  assert.equal(treeCalls, 0)
  const failed = await resolveRegInfo({ course, timetableMenu, askRegInfo: async () => ({ ok: false, reason: 'not_logged_in' }), getDepTree })
  assert.deepEqual(failed, { ok: false, reason: 'not_logged_in' })
  const none = await resolveRegInfo({ course: { cos_id: '2', menu_data: '{}' }, timetableMenu: null, askRegInfo: async () => ({ ok: true, json: [] }), getDepTree })
  assert.equal(none.ok, false)
  assert.equal(none.reason, 'no_menu')
})

test('resolveRegInfo 預排自帶路徑時只查一次，不猜其他路徑', async () => {
  const { resolveRegInfo } = await import('../src/lib/register.js')
  const course = { cos_id: '561068', menu_data: '{"type":3,"dep_uid":"CORE","group":"Z10[0-4]"}', category_type: 'CAT' }
  const asked = []
  const result = await resolveRegInfo({ course, timetableMenu: { type: '1', dep_uid: 'EE' }, askRegInfo: async (m) => { asked.push(m); return { ok: true, json: [] } }, getDepTree: async () => depTree })
  assert.equal(asked.length, 1)
  assert.equal(asked[0].category_type, 'CAT')
  assert.equal(result.ok, true)
  assert.equal(result.record, null)
})
