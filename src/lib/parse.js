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
