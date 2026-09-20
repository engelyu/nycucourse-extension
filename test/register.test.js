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

test('wishOptions 列出志願與各志願登記人數', () => {
  // wish 的值是「這個志願已被幾門課用掉」；只有前五個志願有人數欄位
  const group = { GroupName: '體育', wish_limit: '5', cos_limit: '1', wish: { 1: '1', 2: '0', 3: '0', 4: '0', 5: '0', F: '0' } }
  const options = wishOptions(group, peRecord)
  assert.equal(options.length, 5)
  assert.deepEqual(options[0], { no: 1, used: true, isCurrent: false, registered: '12' })
  assert.deepEqual(options[1], { no: 2, used: false, isCurrent: false, registered: '3' })
  const mine = wishOptions(group, peRecord, { current: 1 })
  assert.equal(mine[0].isCurrent, true)
  assert.equal(mine[0].used, false)
})

test('沒有群組資料時沒有志願可選', () => {
  assert.deepEqual(wishOptions(null, peRecord), [])
})

// 選課網（chunk-b47d6638 cosRegist）送出的 wish 就是登記後的 sFlag：
// 有志願群組送志願序；沒有群組、有人數上限送 "1"（登記，等分發）；不限人數送 "F"（加選，直接選上）
test('registerParams 依選課網的規則決定 wish', () => {
  assert.deepEqual(registerParams(okRecord, ''), {
    cos_id: '516701',
    cos_type_code: '1',
    wType: 'X',
    wish: '1',
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

// 2026-09-20 實測：實變函數論（一）536700 不限人數，選課網送 F 直接選上，擴充功能送空字串變成已登記
test('不限人數又沒有志願群組的課送 F 直接加選', () => {
  const real = { ...okRecord, cos_id: '536700', num_limit: '不限', GroupUID: null }
  assert.equal(registerParams(real, '').wish, 'F')
  assert.equal(registerParams(real, '3').wish, 'F')
  assert.equal(registerParams({ ...okRecord, num_limit: '40' }, '2').wish, '1')
})

test('describeAvailability 分出加選、登記、志願登記三種動作', () => {
  assert.equal(describeAvailability(okRecord).action, 'signup')
  assert.equal(describeAvailability({ ...okRecord, num_limit: '不限' }).action, 'add')
  assert.equal(describeAvailability(peRecord).action, 'wish')
  assert.equal(describeAvailability(null).action, '')
})

test('parseRegResult 解讀加選結果', () => {
  assert.deepEqual(parseRegResult([{ status: 'success', cmsg: '', emsg: '' }]), { ok: true, message: '送出成功' })
  assert.deepEqual(parseRegResult([{ status: 'error', cmsg: '人數已滿', emsg: 'Full' }]), { ok: false, message: '人數已滿' })
  assert.deepEqual(parseRegResult({ status: 'success' }), { ok: true, message: '送出成功' })
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

// 選課網（chunk-6321b656）的顯示規則：PFW 是 W → 停修；sFlag 是 F → 已選；
// 其他 → 已登記，有志願群組時加「第 sFlag 志願」。Lock 是 1 時不能退選。
test('registrationState 照選課網的規則分出已選上與已登記', async () => {
  const { registrationState } = await import('../src/lib/register.js')
  assert.deepEqual(registrationState({ sFlag: '1', GroupUID: '51CE2C18' }), { state: 'wish', wishNo: 1, locked: false })
  assert.deepEqual(registrationState({ sFlag: 'F', GroupUID: 'CB7B23E2' }), { state: 'registered', wishNo: null, locked: false })
  assert.deepEqual(registrationState({ sFlag: 'F', GroupUID: null, Lock: '1' }), { state: 'registered', wishNo: null, locked: true })
  // 沒有群組、sFlag 不是 F：已登記，沒有志願序
  assert.deepEqual(registrationState({ sFlag: '1', GroupUID: null }), { state: 'wish', wishNo: null, locked: false })
  assert.deepEqual(registrationState({ sFlag: '', GroupUID: null }), { state: 'wish', wishNo: null, locked: false })
  assert.deepEqual(registrationState({ sFlag: 'F', PFW: 'W' }), { state: 'withdrawn', wishNo: null, locked: false })
  assert.deepEqual(registrationState(null), { state: 'wish', wishNo: null, locked: false })
})

test('describeRegistration 產生畫面文字', async () => {
  const { describeRegistration } = await import('../src/lib/register.js')
  assert.equal(describeRegistration({ sFlag: '1', GroupUID: 'G' }), '已登記（第 1 志願）')
  assert.equal(describeRegistration({ sFlag: '3', GroupUID: 'G' }), '已登記（第 3 志願）')
  assert.equal(describeRegistration({ sFlag: '1' }), '已登記（等分發）')
  assert.equal(describeRegistration({ sFlag: 'F', GroupUID: 'G' }), '已選上')
  assert.equal(describeRegistration({ sFlag: 'F', Lock: '1' }), '已選上（鎖定）')
  assert.equal(describeRegistration({ sFlag: 'F', PFW: 'W' }), '停修')
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

// 2026-09-20 實測（docs/cos-api-behavior-2026-09-20.md §3、§10、§20）：
// getCosCategoryWish 的 wish[n] 是「這個志願已經被幾門課用掉」的數量，不是課號；
// wish.F 是這個群組已經選上幾門，超過 cos_limit 就不能再登記（選課網顯示「已達上限」）。
test('wishOptions 依照選課網的規則列出志願序', async () => {
  const { wishOptions } = await import('../src/lib/register.js')
  const group = { wish_limit: '6', cos_limit: '1', wish: { 1: '1', 2: '0', 3: '0', 4: '0', 5: '0', 6: '0', F: '0' } }
  const record = { cos_id: '561068', first_wish_reserved_num: '12', second_wish_reserved_num: '3' }
  const options = wishOptions(group, record)
  assert.equal(options.length, 6)
  // 第 1 志願已經被這個群組裡的某門課用掉 → 不能再選
  assert.deepEqual(options[0], { no: 1, used: true, isCurrent: false, registered: '12' })
  assert.deepEqual(options[1], { no: 2, used: false, isCurrent: false, registered: '3' })
  // 第 6 志願沒有對應的人數欄位（伺服器只給五個）
  assert.deepEqual(options[5], { no: 6, used: false, isCurrent: false, registered: '' })
})

test('wishOptions 標出這門課目前登記的志願，而且它不算被佔用', async () => {
  const { wishOptions } = await import('../src/lib/register.js')
  const group = { wish_limit: '5', cos_limit: '1', wish: { 1: '0', 2: '1', 3: '0', 4: '0', 5: '0', F: '0' } }
  const options = wishOptions(group, {}, { current: 2 })
  assert.equal(options[1].isCurrent, true)
  assert.equal(options[1].used, false, '自己現在填的志願要能重選')
})

test('wishLimitReached：群組已選滿就不能再登記', async () => {
  const { wishLimitReached } = await import('../src/lib/register.js')
  assert.equal(wishLimitReached({ cos_limit: '1', wish: { F: '0' } }), false)
  assert.equal(wishLimitReached({ cos_limit: '1', wish: { F: '1' } }), false, '等於上限時選課網仍然顯示志願選單')
  assert.equal(wishLimitReached({ cos_limit: '1', wish: { F: '2' } }), true)
  assert.equal(wishLimitReached({ cos_limit: '100', wish: { F: '3' } }), false)
  assert.equal(wishLimitReached(null), false)
})

// blocked 幾乎永遠是 '1'（實測 8 門課全部如此，包含可以選的），不能拿來判斷
test('describeAvailability 不再用 blocked 判斷是否開放', async () => {
  const { describeAvailability } = await import('../src/lib/register.js')
  const a = describeAvailability({ cos_id: '1', status: 'success', blocked: '1', num_limit: '70', registered_num: '10', conflict_num: '0' })
  assert.equal(a.canRegister, true)
  assert.deepEqual(a.reasons, [])
  const b = describeAvailability({ cos_id: '1', status: 'error', cmsg: '未開放，如有疑問請洽「主開單位」助理。', blocked: '1', num_limit: '70', registered_num: '70', conflict_num: '0' })
  assert.equal(b.message, '未開放，如有疑問請洽「主開單位」助理。')
  assert.ok(!b.reasons.includes('目前不開放加選'), 'blocked 不是判斷依據')
})

// 實測：wType 填錯或留空 → 志願群組會消失；cos_type_code 留空 → 被當成必修。
// 這些欄位一定要照查詢結果送，送不出去就不要送。
test('registerParams 缺少採計欄位時拒絕送出', async () => {
  const { registerParams } = await import('../src/lib/register.js')
  assert.throws(() => registerParams({ cos_id: '1', cos_type_code: '', wType: 'X', num_limit: '70' }), /修課別/)
  assert.throws(() => registerParams({ cos_id: '1', cos_type_code: '2', wType: '', num_limit: '70' }), /修課別|類別/)
})

test('registerParams 對志願群組課程要求合法志願序', async () => {
  const { registerParams } = await import('../src/lib/register.js')
  const record = { cos_id: '561068', cos_type_code: 'E', wType: 'E', GroupUID: 'G', num_limit: '70', category_type: 'CAT' }
  assert.throws(() => registerParams(record, ''), /志願/)
  assert.throws(() => registerParams(record, '0'), /志願/)
  assert.throws(() => registerParams(record, 'F'), /志願/)
  assert.equal(registerParams(record, 3).wish, '3')
})
