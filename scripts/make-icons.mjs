// 從 icons/icon.svg 產生 16、48、128 的 PNG（透明背景，圓角外面不能有白底）。
// 每個尺寸都直接從 SVG 算，不是縮小 128 的圖，小尺寸比較銳利。
// 用 e2e/ 裡的 Playwright（第一次要在 e2e/ 裡 npm install 並安裝 chromium）。用法：node scripts/make-icons.mjs
import { chromium } from '../e2e/node_modules/playwright-core/index.mjs'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url).pathname
const svg = readFileSync(`${root}icons/icon.svg`, 'utf8')
const browser = await chromium.launch({ channel: 'chromium' })
for (const size of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: `${root}icons/icon${size}.png`, omitBackground: true })
  await page.close()
}
await browser.close()
console.log('icons generated')
