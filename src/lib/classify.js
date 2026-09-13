export function classifyResult(id, responseText) {
  const text = String(responseText ?? '').trim()
  if (text === '') return { id, status: 'added', msg: '' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { id, status: 'error', msg: '無法解析選課網回應' }
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  const msg = first && typeof first.msg === 'string' ? first.msg : ''
  if (first && first.status === 'success') return { id, status: 'added', msg }
  if (msg === '重複預選') return { id, status: 'exists', msg }
  return { id, status: 'error', msg: msg || '未知錯誤' }
}

export function confirmWithList(results, preregistIds) {
  const present = new Set(preregistIds)
  return results.map((r) => {
    if (r.status === 'added' && !present.has(r.id)) {
      return { ...r, status: 'error', msg: '加入後未出現在預排清單' }
    }
    return { ...r }
  })
}
