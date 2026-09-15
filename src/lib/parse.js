const SEPARATOR = /[\s,;，；]+/
const SEMESTER_PREFIX = /^\d{4}_/
const COURSE_ID = /^\d{6}$/

function tokens(text) {
  return String(text ?? '').split(SEPARATOR).filter(Boolean)
}

function normalize(token) {
  return token.replace(SEMESTER_PREFIX, '')
}

export function parseIds(text) {
  const seen = new Set()
  const out = []
  for (const token of tokens(text)) {
    const id = normalize(token)
    if (!COURSE_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function findInvalidTokens(text) {
  const seen = new Set()
  const out = []
  for (const token of tokens(text)) {
    if (COURSE_ID.test(normalize(token)) || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

const PREFIXED_ID = /^(\d{4})_\d{6}$/

// 從貼上的文字找出課號前綴的學期，例如 1151_516702 → 1151。
// 前綴不一致時 mixed 為 true；沒有前綴時 semester 為 null。
export function semesterOfIds(text) {
  const found = new Set()
  for (const token of tokens(text)) {
    const m = PREFIXED_ID.exec(token)
    if (m) found.add(m[1])
  }
  if (found.size > 1) return { semester: null, mixed: true }
  return { semester: found.size ? [...found][0] : null, mixed: false }
}
