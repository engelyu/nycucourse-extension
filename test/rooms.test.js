// 教室查詢的計算。教室代碼與大樓代碼取自 2026-09-24 的實測資料（選課網全掃描＋課程時間表官方大樓表）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRoom, floorLabel, buildRoomIndex, roomSessions, roomStatus, noRoomCount,
  floorsOf, matchRooms, buildingsOf, campusesOf, periodAt, nowPoint, formatMinute,
} from '../src/lib/rooms.js'

// 官方大樓表（節錄）
const BUILDINGS = {
  GF: {
    A: { cname: '綜合一館' }, AB: { cname: '綜合一館地下室' }, ED: { cname: '工程四館' }, EC: { cname: '工程三館' },
    M: { cname: '管理館' }, Lib: { cname: '浩然圖書資訊中心' }, HB: { cname: '人社二館' }, CS: { cname: '資訊技術服務中心' },
  },
  YM: { YE: { cname: '實驗大樓' }, YT: { cname: '教學大樓' } },
}

test('parseRoom：大樓取最長的官方代碼前綴，樓層取號碼第一位', () => {
  assert.deepEqual(parseRoom('ED219', 'GF', BUILDINGS), { code: 'ED219', campus: 'GF', building: 'ED', buildingName: '工程四館', floor: '2', known: true })
  assert.equal(parseRoom('AB101', 'GF', BUILDINGS).building, 'AB', 'AB 比 A 長，綜合一館地下室不是綜合一館')
  assert.deepEqual([parseRoom('A701', 'GF', BUILDINGS).building, parseRoom('A701', 'GF', BUILDINGS).floor], ['A', '7'])
  assert.equal(parseRoom('HB212-3R', 'GF', BUILDINGS).floor, '2')
})

test('parseRoom：側翼字母、0 字頭、地下室、其他', () => {
  const yed = parseRoom('YED109', 'YM', BUILDINGS)
  assert.deepEqual([yed.building, yed.buildingName, yed.floor], ['YE', '實驗大樓', '1'])
  assert.equal(parseRoom('YT002', 'YM', BUILDINGS).floor, '0')
  assert.equal(parseRoom('M-b09', 'GF', BUILDINGS).floor, 'B')
  assert.deepEqual([parseRoom('Lib-B1', 'GF', BUILDINGS).building, parseRoom('Lib-B1', 'GF', BUILDINGS).floor], ['Lib', 'B'])
  assert.deepEqual([parseRoom('CS-PC2', 'GF', BUILDINGS).building, parseRoom('CS-PC2', 'GF', BUILDINGS).floor], ['CS', '其他'])
})

test('parseRoom：對不上官方表時，大樓用開頭的英文字母、名稱就是代碼', () => {
  assert.deepEqual(parseRoom('PE', 'GF', BUILDINGS), { code: 'PE', campus: 'GF', building: 'PE', buildingName: 'PE', floor: '其他', known: false })
  const tb = parseRoom('TB307', 'BM', BUILDINGS)
  assert.deepEqual([tb.building, tb.buildingName, tb.floor, tb.known], ['TB', 'TB', '3', false])
  assert.equal(parseRoom('ED219', 'GF', null).known, false, '大樓表抓不到時也要能用')
})

test('floorLabel 與 floorsOf 的順序', () => {
  assert.deepEqual(['2', '0', 'B', '其他'].map(floorLabel), ['2 樓', '0 字頭', '地下室', '其他'])
  const rooms = ['ED301', 'M-b09', 'ED219', 'CS-PC2', 'YT002', 'A701', 'ED220'].map((c) => parseRoom(c, c.startsWith('Y') ? 'YM' : 'GF', BUILDINGS))
  assert.deepEqual(floorsOf(rooms), ['B', '0', '2', '3', '7', '其他'])
})

const course = (id, name, time) => ({ id, name, teacher: '王老師', time })
// EC022 的三門課照實測（週四：2、34、7 節）
const COURSES = [
  course('515500', '計算機概論與程式設計', 'M56R2-EC022[GF],Mabc-EC315[GF]'),
  course('535654', '電腦動畫與特效', 'R34-EC022[GF]'),
  course('515505', '演算法概論', 'T34R7-EC022[GF]'),
  course('600001', '午間課', 'R4N-ED219[GF]'),
  course('600002', '沒有教室的課', 'R34-'),
  course('600003', '合開', 'R34-ED219[GF],R34-ED220[GF]'),
  course('600004', '陽明的課', 'R34-YT206[YM]'),
]
const index = buildRoomIndex(COURSES, BUILDINGS)
const room = (key) => index.rooms.get(key)

test('buildRoomIndex：每間教室記下它的時段；多教室時段拆開；沒有教室的另外記', () => {
  assert.deepEqual([...index.rooms.keys()].sort(), ['GF:EC022', 'GF:EC315', 'GF:ED219', 'GF:ED220', 'YM:YT206'])
  assert.equal(room('GF:EC022').slots.length, 8)
  assert.equal(room('GF:EC022').buildingName, '工程三館')
  assert.deepEqual(room('GF:ED220').slots.map((s) => `${s.day}-${s.period}`), ['4-3', '4-4'])
  assert.deepEqual(index.noRoom.map((s) => `${s.day}-${s.period}`), ['4-3', '4-4'])
})

test('roomSessions：同一門課同一天相鄰的節次合成一段（含 4 與 N 之間的午休）', () => {
  const thursday = roomSessions(room('GF:EC022')).filter((s) => s.day === 4)
  assert.deepEqual(thursday.map((s) => [s.course.id, s.start, s.end]), [
    ['515500', 540, 590], // 2：09:00–09:50
    ['535654', 610, 720], // 34：10:10–12:00
    ['515505', 930, 980], // 7：15:30–16:20
  ])
  const lunch = roomSessions(room('GF:ED219')).find((s) => s.course.id === '600001')
  assert.deepEqual([lunch.start, lunch.end], [670, 790]) // 4N：11:10–13:10
})

test('roomStatus：上課中到幾點、沒有排課到幾點', () => {
  const ec = room('GF:EC022')
  const at = (minute) => roomStatus(ec, 4, minute)
  assert.deepEqual([at(640).state, at(640).courses.map((c) => c.id), at(640).until], ['busy', ['535654'], 720])
  assert.deepEqual([at(725).state, at(725).until], ['free', 930])
  assert.deepEqual([at(600).state, at(600).until], ['free', 610], '兩堂課之間的下課')
  assert.deepEqual([at(1000).state, at(1000).until], ['free', null], '今天之後沒有排課')
  assert.deepEqual([roomStatus(ec, 6, 640).state, roomStatus(ec, 6, 640).until], ['free', null], '週六沒有課')
})

test('roomStatus：同一間教室同時有兩門課，全部列出，到最晚的那一門結束', () => {
  const s = roomStatus(room('GF:ED219'), 4, 700)
  assert.equal(s.state, 'busy')
  assert.deepEqual(s.courses.map((c) => c.id).sort(), ['600001', '600003'])
  assert.equal(s.until, 790)
})

test('noRoomCount：這個時間在上課但沒有填教室的課程數', () => {
  assert.equal(noRoomCount(index, 4, 640), 1)
  assert.equal(noRoomCount(index, 4, 800), 0)
})

test('matchRooms：不分大小寫比對開頭，照代碼排序', () => {
  assert.deepEqual(matchRooms([...index.rooms.values()], 'ed2').map((r) => r.code), ['ED219', 'ED220'])
  assert.deepEqual(matchRooms([...index.rooms.values()], ' EC0 ').map((r) => r.code), ['EC022'])
  assert.deepEqual(matchRooms([...index.rooms.values()], ''), [])
})

test('buildingsOf 與 campusesOf', () => {
  assert.deepEqual(buildingsOf(index, 'GF'), [
    { code: 'EC', name: '工程三館', known: true, count: 2 },
    { code: 'ED', name: '工程四館', known: true, count: 2 },
  ])
  assert.deepEqual(campusesOf(index), ['GF', 'YM'])
})

test('periodAt、nowPoint、formatMinute', () => {
  assert.equal(periodAt(640), '3')
  assert.equal(periodAt(600), '', '下課時間不在任何一節')
  assert.equal(periodAt(1335), 'd')
  assert.equal(periodAt(1340), '')
  assert.deepEqual(nowPoint(new Date(2026, 8, 24, 10, 40)), { day: 4, minute: 640 }) // 2026-09-24 是週四
  assert.deepEqual(nowPoint(new Date(2026, 8, 27, 9, 5)), { day: 7, minute: 545 }) // 週日
  assert.deepEqual([formatMinute(640), formatMinute(0), formatMinute(930)], ['10:40', '00:00', '15:30'])
})

// 2026-09-24 用真實資料驗證時發現：有些時段有教室但沒有校區標記（例如 `YEC109`、`YK533` 沒寫 [YM]）。
// 校區空白的教室不會出現在任何校區清單；從教室代碼推回校區：只有一個校區有這個大樓代碼時才推。
test('buildRoomIndex：時段沒有校區時，用大樓代碼推回唯一的校區', () => {
  const idx = buildRoomIndex([course('800001', '沒寫校區', 'R34-YEC109'), course('800002', '推不出來', 'R34-ZZ101')], BUILDINGS)
  const yec = [...idx.rooms.values()].find((r) => r.code === 'YEC109')
  assert.deepEqual([yec.key, yec.campus, yec.building, yec.known], ['YM:YEC109', 'YM', 'YE', true])
  const zz = [...idx.rooms.values()].find((r) => r.code === 'ZZ101')
  assert.deepEqual([zz.key, zz.campus, zz.known], [':ZZ101', '', false])
})

// 2026-09-24 使用者回報：有些課同時在兩個校區開教室（實測 17 門），例如生物化學 R56F34-A302[GF],R56F34-YX216[YM]。
// parseCosTime 會把同一時段的教室合成「A302、YX216」並只留第一段的校區，所以要逐段解析，每間教室用自己那段的校區。
test('buildRoomIndex：同一時段在兩個校區都有教室，各自歸到自己的校區', () => {
  const idx = buildRoomIndex([
    course('112900', '生物化學', 'R56F34-A302[GF],R56F34-YX216[YM]'),
    course('520030', '資料結構與演算法', 'T789-KB202[KS],T789-SC110[GF]'),
  ], { ...BUILDINGS, KS: { KB: { cname: '高雄B棟' } }, GF: { ...BUILDINGS.GF, SC: { cname: '科學三館' } } })
  assert.deepEqual([...idx.rooms.keys()].sort(), ['GF:A302', 'GF:SC110', 'KS:KB202', 'YM:YX216'])
  assert.equal(idx.rooms.get('YM:YX216').slots.length, 4)
  assert.equal(idx.rooms.get('GF:SC110').buildingName, '科學三館')
  // 兩邊在同一時間都算上課中
  assert.equal(roomStatus(idx.rooms.get('YM:YX216'), 4, 13 * 60 + 30).state, 'busy')
  assert.equal(roomStatus(idx.rooms.get('GF:A302'), 4, 13 * 60 + 30).state, 'busy')
})
