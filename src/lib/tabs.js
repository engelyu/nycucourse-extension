// popup 要開哪個 tab：記住的 tab 還在清單裡就用它，否則用第一個
export function pickTab(tabs, saved) {
  const list = tabs || []
  if (typeof saved === 'string' && list.some((t) => t.id === saved)) return saved
  return list.length ? list[0].id : ''
}
