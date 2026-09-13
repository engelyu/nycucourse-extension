import { parseIds, findInvalidTokens } from './lib/parse.js'

const COS_ORIGIN = 'https://cos.nycu.edu.tw/'
const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'

const $ = (sel) => document.querySelector(sel)
const viewOpen = $('#view-open')
const viewImport = $('#view-import')
const textarea = $('#ids')
const btnImport = $('#btn-import')
const hint = $('#hint')
const results = $('#results')

function showHint(text, isError = false) {
  hint.textContent = text
  hint.classList.toggle('error', isError)
  hint.hidden = !text
}

function code(text) {
  const el = document.createElement('code')
  el.textContent = text
  return el
}

function fillGroup(key, items, render) {
  const group = $(`#group-${key}`)
  const ul = group.querySelector('ul')
  ul.replaceChildren()
  for (const item of items) {
    const li = document.createElement('li')
    li.append(...render(item))
    ul.append(li)
  }
  group.hidden = items.length === 0
}

function renderResults(list, invalid) {
  const by = (status) => list.filter((r) => r.status === status)
  fillGroup('added', by('added'), (r) => [code(r.id)])
  fillGroup('exists', by('exists'), (r) => [code(r.id)])
  fillGroup('error', by('error'), (r) => [code(r.id), ` ${r.msg}`])
  fillGroup('invalid', invalid, (t) => [code(t)])
  results.hidden = false
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function send(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message)
}

async function onImport(tab) {
  const text = textarea.value
  const ids = parseIds(text)
  const invalid = findInvalidTokens(text)
  results.hidden = true
  if (ids.length === 0) {
    showHint('沒有可用的課號。課號是六位數字，例如 516702。', true)
    return
  }
  btnImport.disabled = true
  showHint(`正在加入 ${ids.length} 門課…`)
  let reply
  try {
    reply = await send(tab.id, { type: 'import', ids })
  } catch {
    showHint('無法連到選課網頁面，請重新整理該分頁後再試。', true)
    btnImport.disabled = false
    return
  }
  btnImport.disabled = false
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'not_logged_in') showHint('請先登入選課網。', true)
    else showHint(`選課網回應失敗：${(reply && reply.detail) || '未知錯誤'}`, true)
    return
  }
  showHint('完成，選課網頁面已重新整理。')
  renderResults(reply.results, invalid)
  try { await send(tab.id, { type: 'reload' }) } catch {}
}

async function init() {
  const tab = await activeTab()
  const onCos = Boolean(tab && tab.url && tab.url.startsWith(COS_ORIGIN))
  viewOpen.hidden = onCos
  viewImport.hidden = !onCos
  $('#btn-open').addEventListener('click', () => chrome.tabs.create({ url: EMULATOR_URL }))
  if (!onCos) return
  try {
    await send(tab.id, { type: 'ping' })
  } catch {
    showHint('擴充功能尚未在此頁面載入，請重新整理選課網分頁。', true)
    btnImport.disabled = true
    return
  }
  btnImport.addEventListener('click', () => onImport(tab))
}

init()
