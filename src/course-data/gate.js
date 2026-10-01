// 沒有課程資料時擋住整個頁面：只顯示說明與「下載課程資料」按鈕，讓使用者自己按一次。
// 下載完成（storage 出現 courseData）就自動拿掉，並呼叫 onReady；之後資料被清掉會再擋住。
import { hasCourseData } from '../lib/crawlState.js'
import { createCrawlBar } from './crawl-bar.js'

export async function mountDataGate({ onReady = () => {} } = {}) {
  const gate = document.createElement('div')
  gate.className = 'data-gate'
  gate.setAttribute('role', 'dialog')
  gate.setAttribute('aria-modal', 'true')
  gate.setAttribute('aria-labelledby', 'data-gate-title')
  gate.hidden = true
  gate.innerHTML = `
    <div class="data-gate-card">
      <h2 id="data-gate-title">先下載課程資料</h2>
      <p>找課、找空堂、教室查詢都要用到學校公開的課程時間表（全校的課、上課時間與教室）。第一次使用請先下載一次，約需 1 到 3 分鐘；之後每個頁面上都可以再更新。</p>
      <div class="data-gate-crawl"></div>
    </div>`
  document.body.append(gate)
  const bar = createCrawlBar(gate.querySelector('.data-gate-crawl'), { label: '下載課程資料' })

  let ready = false
  const apply = (courseData) => {
    const has = hasCourseData(courseData)
    gate.hidden = has
    document.body.classList.toggle('needs-course-data', !has)
    if (has && !ready) {
      ready = true
      onReady(courseData)
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.courseData) apply(changes.courseData.newValue)
  })
  await bar.load()
  const { courseData } = await chrome.storage.local.get('courseData')
  apply(courseData)
  return { ready: () => ready }
}
