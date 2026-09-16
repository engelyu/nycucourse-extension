// 正式選課（加選）的判斷邏輯。
// 能不能加選由選課網的 getregistrationcourselist 決定，這裡不自己判斷規則，
// 只負責整理畫面要顯示的資訊，並把伺服器的訊息原文帶出來。
import { formatSeats } from './seats.js'

const str = (v) => (v == null ? '' : String(v))
const num = (v) => {
  const n = Number(str(v).trim())
  return Number.isFinite(n) ? n : null
}

// 預排資料自帶的查詢路徑（選課網自己記下來的）。回傳時引號會變成 &quot;。
export function parseMenuData(raw) {
  const text = str(raw).replace(/&quot;/g, '"').trim()
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// 查一門課要用哪組路徑：選課網自己給的優先，因為通識等課程的路徑
// 和課程時間表的系所樹不一樣，用課程時間表的路徑會查不到。
export function menuForCourse(course, fallbackMenu) {
  const own = parseMenuData(course && course.menu_data)
  const base = own || fallbackMenu
  if (!base) return null
  return { ...base, category_type: str(course && course.category_type) }
}

// getregistrationcourselist 回傳以課號為 key 的物件
export function parseRegInfo(json, cosId) {
  if (!json || typeof json !== 'object') return null
  const record = json[str(cosId)]
  return record && typeof record === 'object' ? record : null
}

export function describeAvailability(record) {
  if (!record) {
    return { canRegister: false, needsWish: false, groupUid: '', seats: '', reasons: [], message: '查不到這門課的加選資訊' }
  }
  const canRegister = str(record.status) === 'success'
  const message = canRegister ? '' : str(record.cmsg) || str(record.emsg) || '選課網不允許加選這門課'
  const reasons = []
  const conflicts = num(record.conflict_num)
  if (conflicts) reasons.push(`與 ${conflicts} 門已選課程衝堂`)
  const limit = num(record.num_limit)
  const enrolled = num(record.registered_num)
  if (limit !== null && enrolled !== null && limit > 0 && enrolled >= limit) reasons.push('人數已滿')
  if (str(record.blocked) === '1' && !canRegister) reasons.push('目前不開放加選')
  return {
    canRegister,
    needsWish: Boolean(record.GroupUID),
    groupUid: str(record.GroupUID),
    seats: formatSeats({ limit: record.num_limit, enrolled: record.registered_num }),
    reasons,
    message,
  }
}

const WISH_RESERVED = ['first_wish_reserved_num', 'second_wish_reserved_num', 'third_wish_reserved_num', 'fourth_wish_reserved_num', 'fifth_wish_reserved_num']

// 分發群組的志願序清單：第幾志願、目前填了哪門課、該志願已登記人數
export function wishOptions(group, record) {
  if (!group || !group.wish) return []
  const limit = num(group.wish_limit) || 0
  const options = []
  for (let no = 1; no <= limit; no++) {
    const takenBy = str(group.wish[no]) === '0' ? '' : str(group.wish[no])
    options.push({
      no,
      takenBy,
      isThisCourse: Boolean(takenBy) && takenBy === str(record && record.cos_id),
      reserved: str((record || {})[WISH_RESERVED[no - 1]] || ''),
    })
  }
  return options
}

// 「已登記」和「已選上」不同：分發課程登記志願後 sFlag 會是志願序數字，
// 等分發結果出來才會變成 F。
export function registrationState(course) {
  const sFlag = str(course && course.sFlag)
  const group = str(course && course.GroupUID)
  if (group && /^\d+$/.test(sFlag)) return { state: 'wish', wishNo: Number(sFlag) }
  return { state: 'registered', wishNo: null }
}

export function describeRegistration(course) {
  const { state, wishNo } = registrationState(course)
  return state === 'wish' ? `已登記（第 ${wishNo} 志願）` : '已選上'
}

export function registerParams(record, wish) {
  return {
    cos_id: str(record && record.cos_id),
    cos_type_code: str(record && record.cos_type_code),
    wType: str(record && record.wType),
    wish: wish === 0 || wish ? str(wish) : '',
    category_type: str(record && record.category_type),
  }
}

export function parseRegResult(response) {
  let data = response
  if (typeof response === 'string') {
    const text = response.trim()
    if (!text) return { ok: false, message: '選課網沒有回應內容' }
    try {
      data = JSON.parse(text)
    } catch {
      return { ok: false, message: '無法解析選課網回應' }
    }
  }
  const first = Array.isArray(data) ? data[0] : data
  if (!first || typeof first !== 'object') return { ok: false, message: '選課網沒有回應內容' }
  if (str(first.status) === 'success') return { ok: true, message: '加選成功' }
  return { ok: false, message: str(first.cmsg) || str(first.emsg) || '加選失敗' }
}
