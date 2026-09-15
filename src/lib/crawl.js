// 抓取整學期課程。網路請求由呼叫端注入的 fetchJson 處理，方便測試。
import { pickSemester, cosListParams, formBody, objectKeys, parseCosList } from './timetable.js'

const RETRIES = 2

async function withRetry(task, label) {
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await task()
    } catch (err) {
      lastErr = err
    }
  }
  const reason = lastErr && lastErr.message ? lastErr.message : String(lastErr)
  throw new Error(`${label} 抓取失敗：${reason}`)
}

async function pool(items, concurrency, worker) {
  let next = 0
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

export async function crawlSemester({ fetchJson, onProgress = () => {}, concurrency = 3 }) {
  const post = (fn, params) => fetchJson(fn, { method: 'POST', body: formBody(params) })
  const get = (fn) => fetchJson(fn, { method: 'GET' })

  onProgress({ phase: 'tree', done: 0, total: 0 })
  const semester = pickSemester(await get('get_acysem'))
  const base = { flang: 'zh-tw', acysem: semester, acysemend: semester }

  const types = await get('get_type')
  const depUids = []
  const seenDeps = new Set()
  for (const type of Array.isArray(types) ? types : []) {
    const categories = objectKeys(await post('get_category', { ftype: type.uid, ...base }))
    for (const fcategory of categories) {
      const colleges = objectKeys(await post('get_college', { ftype: type.uid, ...base, fcategory }))
      for (const fcollege of colleges.length ? colleges : ['*']) {
        const deps = objectKeys(await post('get_dep', { ftype: type.uid, ...base, fcategory, fcollege }))
        for (const uid of deps) {
          if (seenDeps.has(uid)) continue
          seenDeps.add(uid)
          depUids.push(uid)
        }
        // 每查完一個學院就回報，讓背景程式持續更新狀態，不會被判定為中斷
        onProgress({ phase: 'tree', done: depUids.length, total: 0 })
      }
    }
  }

  const courses = new Map()
  let done = 0
  onProgress({ phase: 'courses', done, total: depUids.length })
  await pool(depUids, concurrency, async (uid) => {
    const json = await withRetry(() => post('get_cos_list', cosListParams(semester, uid)), uid)
    for (const course of parseCosList(json)) {
      if (course.id && !courses.has(course.id)) courses.set(course.id, course)
    }
    done++
    onProgress({ phase: 'courses', done, total: depUids.length })
  })

  return { semester, courses: [...courses.values()] }
}
