import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cosTypeName,
  menusUnder,
  alternativeMenus,
  findRow,
  attributionOptions,
  preregParams,
  findAttributionOptions,
  defaultOption,
  describeAttribution,
  homeMenus,
  namedGroupMenus,
  needsChoice,
  courseDepUids,
} from '../src/lib/attribution.js'

// 依 2026-09-19 選課網 getdep 的真實結構縮小
const tree = [
  {
    label: '學士班課程',
    value: 1,
    children: [
      {
        label: '一般學士班',
        value: '3*',
        children: [
          {
            label: '生物醫學暨工程學院',
            value: '5',
            children: [
              {
                label: '(生物醫學影像暨放射科學系)',
                value: 'MED',
                children: [
                  {
                    label: '全部',
                    value: '*',
                    children: [
                      { label: '一年級', value: 1, children: [{ label: '全部', value: '*' }] },
                      { label: '全部年級', value: '*', children: [{ label: '全部', value: '*' }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    label: '學士班共同課程',
    value: 3,
    children: [
      {
        label: '校共同課程',
        value: '0G',
        children: [
          {
            label: '全部',
            value: '*',
            children: [
              { label: '體育', value: 'PE' },
              { label: '語言與溝通', value: 'LANG', children: [{ label: '語言與溝通', value: '' }] },
              {
                label: '核心課程',
                value: 'CORE',
                children: [
                  { label: '核心課程-基本素養', value: 'Z10[0-4]' },
                  { label: '核心課程-領域課程', value: 'Z10[5-8]' },
                ],
              },
            ],
          },
        ],
      },
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
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

const deptRow = { cos_id: '112304', cos_type_code: '2', wType: 'X', wType_cname: '一般課程', GroupName: null, GroupName_E: null, category_type: null, category_cname: null, category_ename: null }
const coreRow = {
  cos_id: '112304',
  cos_type_code: 'E',
  wType: 'E',
  wType_cname: '核心課程',
  GroupName: '核心課程-基本素養',
  GroupName_E: 'Core-Basic',
  category_type: 'CAT',
  category_cname: '基本素養-量性推理',
  category_ename: 'Quantitative Reasoning',
}

test('cosTypeName 對照選課網的類別代碼', () => {
  assert.equal(cosTypeName('2'), '選修')
  assert.equal(cosTypeName('E'), '核心')
  assert.equal(cosTypeName('?'), '')
})

test('menusUnder 系所的「全部」路徑排第一，保留原本的值型別', () => {
  const menus = menusUnder(tree, 'MED', '計算機概論')
  assert.deepEqual(menus[0], { type: 1, dep_category: '3*', college_no: '5', dep_uid: 'MED', group: '*', grade: '*', class: '*' })
  assert.equal(menus.length, 2)
  assert.equal(menus[1].grade, 1)
})

test('menusUnder 院共同課程依課名排序群組；沒有子層的選單補空字串', () => {
  const ee = menusUnder(tree, 'EE', '線性代數')
  assert.deepEqual(ee[0], { type: 3, dep_category: '0C', college_no: '*', dep_uid: 'EE', group: '線性代數', grade: '', class: '' })
  const pe = menusUnder(tree, 'PE', '羽球')
  assert.deepEqual(pe, [{ type: 3, dep_category: '0G', college_no: '*', dep_uid: 'PE', group: '', grade: '', class: '' }])
  assert.deepEqual(menusUnder(tree, '', 'x'), [])
  assert.deepEqual(menusUnder(null, 'EE', 'x'), [])
})

test('alternativeMenus 找出語言與溝通、核心課程的選單', () => {
  const menus = alternativeMenus(tree)
  assert.deepEqual(
    menus.map((m) => `${m.dep_uid}:${m.group}`),
    ['LANG:', 'CORE:Z10[0-4]', 'CORE:Z10[5-8]'],
  )
})

test('findRow 接受陣列或物件', () => {
  assert.equal(findRow([deptRow], '112304'), deptRow)
  assert.equal(findRow({ a: deptRow }, 112304), deptRow)
  assert.equal(findRow('', '1'), null)
})

test('attributionOptions 依類別去重並標示核心', () => {
  const menu = { dep_uid: 'MED' }
  const options = attributionOptions([
    { menu, row: deptRow },
    { menu: { dep_uid: 'CORE' }, row: coreRow },
    { menu: { dep_uid: 'CORE', group: 'Z10[5-8]' }, row: coreRow },
  ])
  assert.equal(options.length, 2)
  assert.equal(options[0].label, '選修')
  assert.equal(options[0].isCore, false)
  assert.equal(options[1].label, '核心・基本素養-量性推理')
  assert.equal(options[1].isCore, true)
})

test('preregParams 和選課網送出的格式一致', () => {
  const [dept, core] = attributionOptions([
    { menu: { type: 1, dep_uid: 'MED', grade: 1 }, row: deptRow },
    { menu: { type: 3, dep_uid: 'CORE', group: 'Z10[0-4]' }, row: coreRow },
  ])
  assert.deepEqual(preregParams('112304', dept), {
    cos_id: '112304',
    menu_data: '{"type":1,"dep_uid":"MED","grade":1}',
    wType: 'X',
    GroupName: 'null',
    GroupName_E: 'null',
    category_type: '',
    category_cname: 'null',
    category_ename: 'null',
  })
  const p = preregParams('112304', core)
  assert.equal(p.wType, 'E')
  assert.equal(p.category_type, 'CAT')
  assert.equal(p.GroupName, '核心課程-基本素養')
})

test('findAttributionOptions 系所找到就停，核心兩組都查', async () => {
  const asked = []
  const getList = async (menu) => {
    asked.push(`${menu.dep_uid}:${menu.group}:${menu.grade}`)
    if (menu.dep_uid === 'MED') return [deptRow]
    if (menu.group === 'Z10[0-4]') return [coreRow]
    return []
  }
  const options = await findAttributionOptions({ cosId: '112304', courseName: '計算機概論', depUids: ['MED'], getTree: async () => tree, getList })
  assert.deepEqual(
    options.map((o) => o.label),
    ['選修', '核心・基本素養-量性推理'],
  )
  assert.deepEqual(asked, ['MED:*:*', 'LANG::', 'CORE:Z10[0-4]:', 'CORE:Z10[5-8]:'])
})

test('findAttributionOptions 院共同課程改試課程群組；沒有系所樹時回空陣列', async () => {
  const eeRow = { cos_id: '515044', cos_type_code: '1', wType: '5' }
  const getList = async (menu) => (menu.group === '線性代數' ? [eeRow] : [])
  const options = await findAttributionOptions({ cosId: '515044', courseName: '線性代數', depUids: ['EE'], getTree: async () => tree, getList })
  assert.equal(options.length, 1)
  assert.equal(options[0].menu.group, '線性代數')
  assert.deepEqual(await findAttributionOptions({ cosId: '1', depUids: ['EE'], getTree: async () => null, getList }), [])
})

test('defaultOption 批次加入時用開課系所的採計（第一個選項）', () => {
  const options = attributionOptions([
    { menu: {}, row: deptRow },
    { menu: {}, row: coreRow },
  ])
  assert.equal(defaultOption(options).label, '選修')
  assert.equal(defaultOption([options[1]]).label, '核心・基本素養-量性推理')
  assert.equal(defaultOption([]), null)
})

test('optionLabel 非一般課程時附上課程種類', () => {
  const { optionLabel } = { optionLabel: (r) => attributionOptions([{ menu: {}, row: r }])[0].label }
  assert.equal(optionLabel({ cos_type_code: '1', wType: '4', wType_cname: '學院共同' }), '必修（學院共同）')
  assert.equal(optionLabel({ cos_type_code: 'F', wType: 'F', wType_cname: '語言與溝通課程', category_cname: '語言與溝通' }), '語言溝通・語言與溝通')
  assert.equal(optionLabel({ cos_type_code: '2', wType: 'X', wType_cname: '一般課程' }), '選修')
})

test('describeAttribution 顯示預排目前的採計方式', () => {
  assert.equal(describeAttribution({ menu_data: '{}', cos_type_code: '1' }), '未指定')
  assert.equal(describeAttribution({ menu_data: '{&quot;type&quot;:3}', cos_type_code: 'E', category_cname: '基本素養-生命及品格教育' }), '核心・基本素養-生命及品格教育')
  assert.equal(describeAttribution({ menu_data: '{"type":1}', cos_type_code: '2', category_cname: 'null' }), '選修')
})

test('homeMenus 依序：每個系所的整體選單、同名的共同課程群組、其他群組', () => {
  const menus = homeMenus(tree, ['NOPE', 'MED'], '線性代數')
  assert.deepEqual(
    menus.map((m) => `${m.dep_uid}:${m.group}:${m.grade}`),
    ['MED:*:*', 'EE:線性代數:', 'MED:*:1'],
  )
})

test('namedGroupMenus 用課名找共同課程群組；太短的名稱不比對', () => {
  assert.deepEqual(
    namedGroupMenus(tree, '線性代數').map((m) => m.group),
    ['線性代數'],
  )
  assert.deepEqual(namedGroupMenus(tree, ''), [])
})

test('findAttributionOptions 系所找不到時標示只找到其他選單', async () => {
  const getList = async (menu) => (menu.dep_uid === 'CORE' && menu.group === 'Z10[0-4]' ? [coreRow] : [])
  const options = await findAttributionOptions({ cosId: '112304', courseName: '計算機概論', depUids: ['MED'], getTree: async () => tree, getList })
  assert.equal(options.length, 1)
  assert.equal(options[0].source, 'alt')
  assert.equal(needsChoice(options), true)
})

test('needsChoice 只有開課系所一種時不必選', () => {
  assert.equal(needsChoice([{ source: 'home' }]), false)
  assert.equal(needsChoice([{ source: 'home' }, { source: 'alt' }]), true)
  assert.equal(needsChoice([]), false)
})

test('courseDepUids 合併新舊課程資料的系所', () => {
  assert.deepEqual(courseDepUids({ menus: [{ dep_uid: 'A' }, { dep_uid: 'B' }], menu: { dep_uid: 'A' } }), ['A', 'B'])
  assert.deepEqual(courseDepUids({ menu: { dep_uid: 'A' } }), ['A'])
  assert.deepEqual(courseDepUids(undefined), [])
})

test('homeMenus 不把核心課程、語言與溝通當成開課系所', () => {
  assert.deepEqual(homeMenus(tree, ['CORE', 'LANG'], '計算機概論'), [])
})
