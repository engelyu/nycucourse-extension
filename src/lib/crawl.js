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

// 少數系所失敗時照樣繼續，超過容許值才停下；回傳失敗的項目與最後一個錯誤。
async function pool(items, concurrency, worker, maxFailures) {
  let next = 0
  let stopped = false
  let lastError = null
  const failures = []
  const isStopped = () => stopped
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (!stopped && next < items.length) {
      const index = next++
      try {
        await worker(items[index], isStopped)
      } catch (err) {
        failures.push(items[index])
        lastError = err
        if (failures.length > maxFailures) {
          stopped = true
          throw err
        }
      }
    }
  })
  await Promise.all(runners)
  return { failures, lastError }
}

export async function crawlSemester({
  fetchJson,
  onProgress = () => {},
  concurrency = 3,
  retryDelayMs = 500,
  maxFailedDeps = 5,
  sleep = defaultSleep,
}) {
  const post = (fn, params) => fetchJson(fn, { method: 'POST', body: formBody(params) })
  const get = (fn) => fetchJson(fn, { method: 'GET' })

  const depUids = []
  const seenDeps = new Set()
  // 記下每個系所的查詢條件，之後要向選課網查人數時用得到
  const depMenus = new Map()
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
          depMenus.set(uid, { type: String(type.type ?? ''), dep_category: fcategory, college_no: fcollege, dep_uid: uid })
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
  const { failures: failedDeps, lastError } = await pool(depUids, concurrency, async (uid, isStopped) => {
    const json = await withRetry(() => post('get_cos_list', cosListParams(semester, uid)), uid, { retryDelayMs, sleep, isStopped })
    if (isStopped()) return
    for (const course of parseCosList(json, depMenus.get(uid))) {
      if (!course.id) continue
      // 多系合開的課會出現在好幾個系所，全部記下來：選課網只在其中一個系所列出這門課
      const seen = courses.get(course.id)
      if (!seen) {
        courses.set(course.id, { ...course, menus: course.menu ? [course.menu] : [] })
      } else if (course.menu && !seen.menus.some((m) => m.dep_uid === course.menu.dep_uid)) {
        seen.menus.push(course.menu)
      }
    }
    done++
    onProgress({ phase: 'courses', done, total: depUids.length })
  }, maxFailedDeps)
  // 全部系所都失敗時當成整體失敗，才不會用空資料覆蓋舊資料
  if (failedDeps.length === depUids.length) {
    throw lastError || new Error('所有系所都抓取失敗')
  }
  if (courses.size === 0) {
    throw new Error('沒有抓到任何課程，課程時間表可能暫時無法使用或已改版')
  }

  return { semester, courses: [...courses.values()], failedDeps }
}
