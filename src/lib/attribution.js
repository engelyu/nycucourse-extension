// 課程採計方式：同一個課號在選課網的不同選單下可能是不同類別，例如在開課系所是「選修」，
// 在「核心課程」選單下是「核心」（要排志願）。選課網把「從哪個選單加入預排」記在預排資料裡，
// 正式登記時照這個選單決定類別，所以加入預排時就要選好。
// 這裡的函式只整理資料，實際請求由呼叫端注入。

const str = (v) => (v == null ? '' : String(v))

// 取自選課網前端的 cosType 對照表
const COS_TYPES = {
  0: '自選',
  1: '必修',
  2: '選修',
  3: '輔系',
  4: '雙學位',
  5: '通識',
  6: '外語',
  7: '教育',
  8: '體育',
  9: '高修',
  B: '軍訓',
  C: '藝文賞析',
  E: '核心',
  F: '語言溝通',
  M: '創',
  X: '不計學分',
}

export function cosTypeName(code) {
  return COS_TYPES[str(code)] || ''
}

const MENU_KEYS = ['type', 'dep_category', 'college_no', 'dep_uid', 'group', 'grade', 'class']

// 選課網的選單就是系所樹（getdep）上一條路徑的各層 value，不足七層的補空字串。
// 值保留原本的型別（例如 type 是數字），和選課網自己存的 menu_data 一致。
function menuFromPath(path) {
  const menu = {}
  MENU_KEYS.forEach((key, i) => {
    menu[key] = path[i] ? path[i].value : ''
  })
  return menu
}

function leafPaths(node, path, out) {
  const here = [...path, node]
  const kids = Array.isArray(node.children) ? node.children.filter((c) => c && typeof c === 'object') : []
  if (!kids.length || here.length >= MENU_KEYS.length) out.push(here)
  else for (const child of kids) leafPaths(child, here, out)
}

// 找出系所樹上 dep_uid 相符的系所（第四層），列出它底下每一條完整路徑
function pathsUnder(tree, match) {
  const out = []
  const walk = (nodes, path) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue
      if (path.length === 3 && match(node)) leafPaths(node, path, out)
      else if (path.length < 3) walk(node.children, [...path, node])
    }
  }
  walk(tree, [])
  return out
}

// 另外要查的選單。2026-09-19 掃過選課網全部 299 個選單：3644 門課裡有 110 門有兩種採計，
// 沒有三種以上；另一種幾乎都是「核心課程」，只有一門是「語言與溝通」。
// 學分學程、跨域學程、微學程下的類別都和開課系所相同，不用查。
const ALTERNATIVE_MENUS = ['核心課程', '語言與溝通']

const isAlternative = (node) => ALTERNATIVE_MENUS.includes(str(node && node.label))

const nameMatches = (label, name) => label.length >= 2 && Boolean(name) && (name.includes(label) || label.includes(name))

// 某系所底下可用的選單，附上優先順序：2 = 整個系所（「全部」或沒有下層），
// 1 = 名稱和課名相符的課程群組（院共同、校共同課程要指定群組才查得到），0 = 其他
function scoredMenusUnder(tree, depUid, courseName) {
  if (!depUid) return []
  // 課程時間表也會把課列在「核心課程」等選單底下，那些不是開課系所，要排除
  const paths = pathsUnder(tree, (node) => str(node.value) === str(depUid) && !isAlternative(node))
  const name = str(courseName)
  const score = (path) => {
    const rest = path.slice(4)
    if (rest.every((n) => str(n.value) === '*')) return 2
    return nameMatches(str(rest[0] && rest[0].label), name) ? 1 : 0
  }
  return paths
    .map((path, i) => ({ menu: menuFromPath(path), i, score: score(path) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
}

export function menusUnder(tree, depUid, courseName = '') {
  return scoredMenusUnder(tree, depUid, courseName).map((x) => x.menu)
}

// 全校的共同課程群組裡，名稱和課名相符的（例如「計算機概論與程式設計」「生物學(一)」）
export function namedGroupMenus(tree, courseName) {
  const name = str(courseName)
  return pathsUnder(tree, (node) => !isAlternative(node))
    .filter((path) => path.length > 4 && nameMatches(str(path[4].label), name))
    .map(menuFromPath)
}

// 開課系所那一種採計要去哪些選單找，依序：課程出現的每個系所、同名的共同課程群組，
// 最後才是系所底下其他的群組
export function homeMenus(tree, depUids, courseName) {
  const scored = (depUids || []).filter(Boolean).flatMap((uid) => scoredMenusUnder(tree, uid, courseName))
  const ordered = [...scored.filter((x) => x.score > 0).map((x) => x.menu), ...namedGroupMenus(tree, courseName), ...scored.filter((x) => x.score === 0).map((x) => x.menu)]
  const seen = new Set()
  return ordered.filter((menu) => {
    const key = JSON.stringify(menu)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function alternativeMenus(tree) {
  return pathsUnder(tree, isAlternative).map(menuFromPath)
}

export function findRow(list, cosId) {
  const rows = Array.isArray(list) ? list : Object.values(list && typeof list === 'object' ? list : {})
  return rows.find((row) => row && str(row.cos_id) === str(cosId)) || null
}

const present = (v) => v != null && str(v) !== '' && str(v) !== 'null'

export function optionLabel(row) {
  const type = cosTypeName(row && row.cos_type_code) || str(row && row.wType_cname) || '一般課程'
  if (present(row && row.category_cname)) return `${type}・${row.category_cname}`
  const kind = str(row && row.wType_cname)
  return kind && kind !== '一般課程' && kind !== type ? `${type}（${kind}）` : type
}

export function attributionKey(row) {
  return [str(row && row.cos_type_code), str(row && row.wType), present(row && row.category_type) ? str(row.category_type) : ''].join('|')
}

// 同一門課在不同選單找到的結果，依「類別」去重，只留下真的不一樣的採計方式。
// source：home = 開課系所那一種，alt = 核心課程等其他選單
export function attributionOptions(found) {
  const seen = new Set()
  const out = []
  for (const { menu, row, source = 'home' } of found || []) {
    if (!row) continue
    const key = attributionKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, menu, row, source, label: optionLabel(row), isCore: str(row.cos_type_code) === 'E' || str(row.wType) === 'E' })
  }
  return out
}

// 選課網加入預排送出的參數。null 照選課網的寫法送成字串 "null"。
export function preregParams(cosId, option) {
  const row = (option && option.row) || {}
  const text = (v) => (v == null ? 'null' : String(v))
  return {
    cos_id: str(cosId),
    menu_data: JSON.stringify((option && option.menu) || {}),
    wType: str(row.wType) || 'X',
    GroupName: text(row.GroupName),
    GroupName_E: text(row.GroupName_E),
    category_type: present(row.category_type) ? str(row.category_type) : '',
    category_cname: text(row.category_cname),
    category_ename: text(row.category_ename),
  }
}

const MAX_HOME_TRIES = 15

// 查出一門課可以用哪些方式採計。先找開課系所那一種（找到一次就停），
// 再到核心課程、語言與溝通選單找。有找到開課系所那一種時，它排第一個。
// getList(menu) 回傳選課網該選單的課程清單。
export async function findAttributionOptions({ cosId, courseName, depUids, getTree, getList }) {
  const tree = await getTree()
  if (!tree) return []
  const found = []
  for (const menu of homeMenus(tree, depUids, courseName).slice(0, MAX_HOME_TRIES)) {
    const row = findRow(await getList(menu), cosId)
    if (row) {
      found.push({ menu, row, source: 'home' })
      break
    }
  }
  for (const menu of alternativeMenus(tree)) {
    const row = findRow(await getList(menu), cosId)
    if (row) found.push({ menu, row, source: 'alt' })
  }
  return attributionOptions(found)
}

// 需要讓使用者選：有兩種以上，或找不到開課系所那一種（只剩核心等其他選單的）
export function needsChoice(options) {
  return (options || []).length > 1 || ((options || []).length === 1 && options[0].source !== 'home')
}

// 課程資料裡這門課出現過的系所（新版記在 menus，舊資料只有 menu）
export function courseDepUids(course) {
  const menus = [...((course && course.menus) || []), ...(course && course.menu ? [course.menu] : [])]
  return [...new Set(menus.map((m) => str(m && m.dep_uid)).filter(Boolean))]
}

// 批次加入沒辦法逐門詢問：用開課系所的採計（第一個選項）；系所查不到時才用其他選單的
export function defaultOption(options) {
  return (options && options[0]) || null
}

// 預排資料目前的採計方式，給選課頁顯示
export function describeAttribution(item) {
  const raw = str(item && item.menu_data).replace(/&quot;/g, '"').trim()
  let menu = null
  try {
    menu = raw ? JSON.parse(raw) : null
  } catch {
    menu = null
  }
  if (!menu || typeof menu !== 'object' || !Object.keys(menu).length) return '未指定'
  return optionLabel(item)
}
