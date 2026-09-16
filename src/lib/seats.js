// 人數顯示。課程時間表提供人數上限，已選人數固定是 -999（不提供）；
// 選課網才有實際已選人數，所以兩種情況都要能顯示。
const UNLIMITED = 9999

function toNumber(value) {
  const text = String(value ?? '').trim()
  if (!/^-?\d+$/.test(text)) return null
  return Number(text)
}

export function formatSeats(course) {
  const rawLimit = String((course && course.limit) ?? '').trim()
  const limitNum = toNumber(rawLimit)
  // 9999、0 和「不限」都代表沒有人數上限
  const unlimited = rawLimit === '不限' || limitNum === UNLIMITED || limitNum === 0
  const limit = unlimited || limitNum === null || limitNum < 0 ? null : limitNum

  const enrolledNum = toNumber(course && course.enrolled)
  const enrolled = enrolledNum === null || enrolledNum < 0 ? null : enrolledNum

  if (enrolled !== null && limit !== null) {
    return `${enrolled}/${limit} 人${enrolled >= limit ? '（已額滿）' : ''}`
  }
  if (enrolled !== null && unlimited) return `已選 ${enrolled} 人 · 不限人數`
  if (enrolled !== null) return `已選 ${enrolled} 人`
  if (limit !== null) return `上限 ${limit} 人`
  if (unlimited) return '不限人數'
  return ''
}
