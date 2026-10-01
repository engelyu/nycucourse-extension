// 更新課程資料：按鈕、資料狀態、進度與錯誤。每個頁面共用同一套（背景程式 crawl:start，進度寫在 storage 的 crawlState）。
// root 是空的容器，畫面由這裡產生；label 是按鈕文字（擋住頁面的卡片上叫「下載課程資料」）。
import { describeCrawl, describeData, hasCourseData } from '../lib/crawlState.js'

const MARKUP = `
  <div class="data-bar"><button class="btn-crawl" type="button"></button><span class="data-status muted"></span></div>
  <section class="crawl-progress" role="status" aria-live="polite" hidden>
    <div class="crawl-row"><span class="crawl-title"></span><span class="crawl-elapsed"></span></div>
    <div class="crawl-track"><div class="crawl-bar"></div></div>
    <div class="crawl-row"><span class="crawl-detail"></span><span class="crawl-percent"></span></div>
    <p class="crawl-hint"></p>
  </section>
  <p class="crawl-error hint" hidden></p>
  <p class="semester-warning hint" role="alert" hidden></p>`

function showHint(el, text, kind = '') {
  el.textContent = text
  el.classList.toggle('error', kind === 'error')
  el.classList.toggle('warn', kind === 'warn')
  el.hidden = !text
}

export function createCrawlBar(root, { label = '更新課程資料' } = {}) {
  root.classList.add('crawl')
  root.innerHTML = MARKUP
  const $ = (sel) => root.querySelector(sel)
  let courseData = null
  let crawlState = null
  let startError = ''
  let cosSemester = null

  const renderProgress = () => {
    const d = describeCrawl(crawlState, Date.now())
    $('.crawl-progress').hidden = !d
    if (!d) return false
    $('.crawl-title').textContent = d.title
    $('.crawl-elapsed').textContent = d.elapsed
    $('.crawl-detail').textContent = d.detail
    $('.crawl-percent').textContent = d.percent == null ? '' : `${d.percent}%`
    $('.crawl-track').classList.toggle('indeterminate', d.percent == null)
    $('.crawl-bar').style.width = d.percent == null ? '' : `${d.percent}%`
    const hint = $('.crawl-hint')
    hint.textContent = d.hint
    hint.classList.toggle('slow', d.slow)
    return true
  }

  const render = () => {
    const isRunning = Boolean(crawlState && crawlState.status === 'running')
    const running = renderProgress()
    const hasData = hasCourseData(courseData)
    const btn = $('.btn-crawl')
    btn.disabled = running
    const verb = hasData ? '更新' : '下載'
    btn.textContent = running ? `${verb}中…` : label
    $('.data-status').textContent = hasData ? describeData(courseData) : running ? '' : '尚未下載課程資料'

    const err = $('.crawl-error')
    if (crawlState && crawlState.status === 'error') {
      showHint(err, `${verb}失敗：${crawlState.error || '未知錯誤'}${hasData ? '（已保留原本的課程資料）' : '。請再按一次。'}`, 'error')
    } else if (isRunning && !running) {
      showHint(err, `上次${verb}中斷，請再按一次。`, 'error')
    } else if (crawlState && crawlState.status === 'done' && crawlState.failed > 0 && !running) {
      showHint(err, `有 ${crawlState.failed} 個系所沒抓到，課程可能不完整，稍後可以再更新一次。`, 'warn')
    } else if (startError && !running) {
      showHint(err, startError, 'error')
    } else {
      showHint(err, '')
    }

    // 課程資料學期與選課網學期不同時提醒：課號在不同學期可能對應不同課程
    const dataSemester = courseData && courseData.semester
    showHint(
      $('.semester-warning'),
      cosSemester && dataSemester && cosSemester !== dataSemester
        ? `注意：課程資料是 ${dataSemester} 學期，選課網目前是 ${cosSemester} 學期。課號在不同學期可能對應不同課程，請先更新課程資料。`
        : '',
      'warn',
    )
  }

  const start = async () => {
    // 先在畫面上顯示進度，不必等背景程式醒來寫入第一筆狀態
    const previous = crawlState
    const now = Date.now()
    startError = ''
    crawlState = { status: 'running', phase: 'tree', done: 0, total: 0, startedAt: now, lastProgressAt: now }
    render()
    try {
      await chrome.runtime.sendMessage({ type: 'crawl:start' })
    } catch (err) {
      crawlState = previous
      startError = `無法開始${hasCourseData(courseData) ? '更新' : '下載'}：${err && err.message ? err.message : err}`
      render()
    }
  }

  $('.btn-crawl').addEventListener('click', start)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.courseData || changes.crawlState)) return
    if (changes.courseData) courseData = changes.courseData.newValue || courseData
    if (changes.crawlState) crawlState = changes.crawlState.newValue
    render()
  })
  // 經過時間每秒更新；背景程式停住時 describeCrawl 會判斷為中斷
  setInterval(render, 1000)

  return {
    async load() {
      const stored = await chrome.storage.local.get(['courseData', 'crawlState'])
      courseData = stored.courseData || null
      crawlState = stored.crawlState || null
      render()
    },
    setCosSemester(semester) {
      cosSemester = semester || null
      render()
    },
  }
}
