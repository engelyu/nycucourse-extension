// 依序跑 e2e/ 裡所有腳本，最後列出每支的結果；失敗的會印出輸出的最後一段。
// 用法：node run-all.mjs [擴充功能資料夾，預設 ..]（或在 e2e/ 裡 npm test）
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const ext = process.argv[2] || '..'
const here = new URL('.', import.meta.url).pathname
const scripts = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs').sort()
const results = scripts.map((f) => {
  const started = Date.now()
  const r = spawnSync(process.execPath, [f, ext], { cwd: here, encoding: 'utf8' })
  const pass = r.status === 0
  if (!pass) process.stdout.write(`\n--- ${f} 失敗 ---\n${`${r.stdout}${r.stderr}`.slice(-3000)}\n`)
  return { f, pass, seconds: Math.round((Date.now() - started) / 1000) }
})
for (const { f, pass, seconds } of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${f}（${seconds} 秒）`)
process.exit(results.every((r) => r.pass) ? 0 : 1)
