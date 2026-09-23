// 當期選課左右分割的寬度計算（純函式）。左欄是搜尋結果，右欄是課表預覽／篩選設定。
// 右欄要放得下 7 天的課表，所以最小寬度比左欄大。
export const SPLIT = { minLeft: 340, minRight: 480, handle: 12, defaultRatio: 0.45 }

// ratio：左欄佔可用寬度（扣掉分隔線）的比例。回傳左欄像素寬；放不下兩邊最小寬度時回傳 null。
export function splitLeft(ratio, total) {
  const room = total - SPLIT.handle
  if (room < SPLIT.minLeft + SPLIT.minRight) return null
  const r = Number.isFinite(ratio) ? ratio : SPLIT.defaultRatio
  return Math.min(Math.max(Math.round(room * r), SPLIT.minLeft), room - SPLIT.minRight)
}
