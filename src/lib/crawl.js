// 抓取整學期課程。網路請求由呼叫端注入的 fetchJson 處理，方便測試。
import { pickSemester, cosListParams, formBody, objectKeys, parseCosList } from './timetable.js'

const RETRIES = 2
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 失敗後等 retryDelayMs × 第幾次重試 再試，避免學校伺服器忙碌時連續打。
async function withRetry(task, label, { retryDelayMs, sleep, isStopped }) {
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) {
      if (isStopped()) break
      await sleep(retryDelayMs * attempt)
    }
    try {
      return await task()
    } catch (err) {
      lastErr = err
    }
  }
  const reason = lastErr && lastErr.message ? lastErr.message : String(lastErr)
  throw new Error(`${label} 抓取失敗：${reason}`)
}

// 任一 worker 失敗後，其他 worker 做完手上的請求就停，不再抓新的項目。
async function pool(items, concurrency, worker) {
  let next = 0
  let failed = false
  const isStopped = () => failed
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        await worker(items[index], isStopped)
      } catch (err) {
        failed = true
        throw err
      }
    }
  })
  await Promise.all(runners)
}

export async function crawlSemester({
  fetchJson,
  onProgress = () => {},
  concurrency = 3,
  retryDelayMs = 500,
  sleep = defaultSleep,
}) {
  const post = (fn, params) => fetchJson(fn, { method: 'POST', body: formBody(params) })
  const get = (fn) => fetchJson(fn, { method: 'GET' })

  const depUids = []
  const seenDeps = new Set()
  // 讀系所清單時每個請求後都回報，背景程式才會持續更新狀態，不會被判定為中斷
  const treeTick = () => onProgress({ phase: 'tree', done: depUids.length, total: 0 })

  treeTick()
  const semester = pickSemester(await get('get_acysem'))
  treeTick()
  const base = { flang: 'zh-tw', acysem: semester, acysemend: semester }

  const types = await get('get_type')
  treeTick()
  for (const type of Array.isArray(types) ? types : []) {
    const categories = objectKeys(await post('get_category', { ftype: type.uid, ...base }))
    treeTick()
    for (const fcategory of categories) {
      const colleges = objectKeys(await post('get_college', { ftype: type.uid, ...base, fcategory }))
      treeTick()
      for (const fcollege of colleges.length ? colleges : ['*']) {
        const deps = objectKeys(await post('get_dep', { ftype: type.uid, ...base, fcategory, fcollege }))
        for (const uid of deps) {
          if (seenDeps.has(uid)) continue
          seenDeps.add(uid)
          depUids.push(uid)
        }
        treeTick()
      }
    }
  }
  // 伺服器回空內容或 API 改版時會一路拿到空清單；當成失敗，才不會用空資料覆蓋舊資料
  if (depUids.length === 0) {
    throw new Error('找不到任何系所，課程時間表可能暫時無法使用或已改版')
  }

  const courses = new Map()
  let done = 0
  onProgress({ phase: 'courses', done, total: depUids.length })
  await pool(depUids, concurrency, async (uid, isStopped) => {
    const json = await withRetry(() => post('get_cos_list', cosListParams(semester, uid)), uid, { retryDelayMs, sleep, isStopped })
    if (isStopped()) return
    for (const course of parseCosList(json)) {
      if (course.id && !courses.has(course.id)) courses.set(course.id, course)
    }
    done++
    onProgress({ phase: 'courses', done, total: depUids.length })
  })
  if (courses.size === 0) {
    throw new Error('沒有抓到任何課程，課程時間表可能暫時無法使用或已改版')
  }

  return { semester, courses: [...courses.values()] }
}
