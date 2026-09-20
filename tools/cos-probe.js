// 選課網（cos.nycu.edu.tw）行為探測工具：可重跑的實驗集。
//
// 用法：登入 https://cos.nycu.edu.tw 之後，在該分頁的 DevTools Console 貼上整個檔案，然後
//   await cosProbe.run()                       // 只跑唯讀實驗
//   await cosProbe.run({ writes: true })       // 加上會寫入的實驗（會自己還原）
//   await cosProbe.run({ only: ['setregist'] })// 只跑某一組
//   cosProbe.dump()                            // 輸出 JSON（貼回專案存檔）
//
// 安全規則（寫死在工具裡，不提供關閉）：
//   1. 絕不呼叫任何會動到「已選上」（sFlag === 'F'）課程的操作；deleteregist 只用在自己剛登記的課。
//   2. 絕不對「不限人數又沒有志願群組」的課送 setregist：那種課送出就直接選上，之後只能退選。
//   3. 每個寫入實驗結束就還原，整輪結束再比對快照，對不上就大聲報錯。
//   4. 不碰 setAnswers（會送出教學意見調查）、setotp／checkotp（登入流程）。
(() => {
  const BASE = 'https://cos.nycu.edu.tw/'
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function post(path, params) {
    const started = performance.now()
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + localStorage.getItem('token') },
      body: new URLSearchParams(params || {}).toString(),
    })
    const text = await res.text()
    const ms = Math.round(performance.now() - started)
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, ms, json, text: json ? '' : text.slice(0, 120) }
  }

  // 回應摘要：陣列長度、第一筆的 status/cmsg/msg、物件的鍵，避免輸出過長
  function shape(reply) {
    const j = reply.json
    if (j === null) return { http: reply.status, notJson: reply.text || '(空回應)' }
    if (Array.isArray(j)) {
      const first = j[0]
      return { http: reply.status, array: j.length, first: first && typeof first === 'object'
        ? { status: first.status, cmsg: first.cmsg, msg: first.msg, errortype: first.errortype, keys: Object.keys(first).length }
        : first }
    }
    if (typeof j === 'object') return { http: reply.status, keys: Object.keys(j).slice(0, 12), n: Object.keys(j).length, status: j.status, cmsg: j.cmsg }
    return { http: reply.status, value: j }
  }

  const state = { results: [], snapshot: null }
  const record = (group, id, desc, params, reply, extra) => {
    // extra 不能覆蓋 group／id，否則結果分組會亂掉（2026-09-20 實跑時踩過）
    const row = { ...(extra || {}), group, id, desc, params, ms: reply && reply.ms, reply: reply && shape(reply) }
    state.results.push(row)
    return row
  }

  // ---------- 讀取現況 ----------
  const lists = async () => ({
    preregist: (await post('getpreregist')).json || [],
    registered: (await post('getregist')).json || [],
  })
  const regRecord = async (id) => ((await post('getregist')).json || []).find((c) => String(c.cos_id) === String(id)) || null
  const menuOf = (c) => { try { return JSON.parse(String(c.menu_data || '{}').replace(/&quot;/g, '"')) } catch { return {} } }
  const menuParams = (m, extra) => ({
    type: m.type ?? '', dep_category: m.dep_category ?? '', college_no: m.college_no ?? '',
    dep_uid: m.dep_uid ?? '', group: m.group ?? '*', grade: m.grade ?? '*', class: m.class ?? '*', ...(extra || {}),
  })
  const reginfo = async (cosId, menu, category) => {
    const reply = await post('getregistrationcourselist', { cos_id: cosId, ...menuParams(menu, { category_type: category ?? '' }) })
    const rec = reply.json && !Array.isArray(reply.json) ? reply.json[cosId] : null
    return { reply, rec }
  }

  // ---------- 安全閘 ----------
  async function safeCancel(cosId) {
    const rec = await regRecord(cosId)
    if (!rec) return { skipped: 'not-registered' }
    if (String(rec.sFlag) === 'F') throw new Error(`安全閘：${cosId} 是已選上（sFlag F），不取消`)
    return { reply: await post('deleteregist', { cos_id: cosId }) }
  }
  // 只允許對「有人數上限」或「有志願群組」的課登記（結果是已登記，可以取消）
  async function safeRegister(cosId, params, guard) {
    if (!guard || (guard.num_limit === '不限' && !guard.GroupUID)) {
      throw new Error(`安全閘：${cosId} 不限人數且無志願群組，登記會直接選上，不測`)
    }
    return post('setregist', { cos_id: cosId, ...params })
  }

  // ---------- 實驗組 ----------
  // 每一組：{ id, writes, run(ctx) }。ctx 提供 post/record/safe* 與挑好的測試課程。
  const groups = []
  const add = (id, writes, run) => groups.push({ id, writes, run })

  add('no-params', false, async () => {
    for (const path of ['sysstatuslvl', 'checkreg', 'checkdistribute', 'userinfo', 'getpreregist', 'getregist', 'getCosCategoryWish', 'getdep', 'getquesttime', 'getquestlist']) {
      record('no-params', path, `${path}（無參數）`, {}, await post(path))
    }
    // 多餘參數會不會影響結果
    record('no-params', 'checkreg+junk', 'checkreg 帶無關參數', { foo: 'bar' }, await post('checkreg', { foo: 'bar' }))
  })

  add('getsemregist', false, async () => {
    for (const [acy, sem] of [['115', '1'], ['114', '2'], ['114', '1'], ['999', '9'], ['', '']]) {
      record('getsemregist', `${acy}-${sem}`, `學年 ${acy} 學期 ${sem}`, { acy, sem }, await post('getsemregist', { acy, sem }))
    }
  })

  add('preregistcourse', false, async (ctx) => {
    const m = ctx.deptMenu
    const variants = {
      正常: menuParams(m, { codition: '' }),
      codition課號: menuParams(m, { codition: ctx.capped.cos_id }),
      codition課名: menuParams(m, { codition: '分析' }),
      codition亂填: menuParams(m, { codition: 'zzzz' }),
      全部空白: { type: '', dep_category: '', college_no: '', dep_uid: '', group: '', grade: '', class: '', codition: '' },
      dep_uid空: menuParams({ ...m, dep_uid: '' }, { codition: '' }),
      dep_uid亂填: menuParams({ ...m, dep_uid: '00000000-0000-0000-0000-000000000000' }, { codition: '' }),
      grade數字: menuParams({ ...m, grade: 1 }, { codition: '' }),
      group萬用: menuParams({ ...m, group: '*' }, { codition: '' }),
      缺codition: menuParams(m),
    }
    for (const [name, params] of Object.entries(variants)) {
      record('preregistcourse', name, `preregistcourse ${name}`, params, await post('preregistcourse', params))
    }
  })

  add('getregistrationcourselist', false, async (ctx) => {
    const id = ctx.capped.cos_id
    const m = ctx.capped.menu
    const variants = {
      正確選單: menuParams(m, { category_type: '' }),
      空選單: menuParams({}, { category_type: '' }),
      少了dep_uid: menuParams({ ...m, dep_uid: '' }, { category_type: '' }),
      grade萬用: menuParams({ ...m, grade: '*' }, { category_type: '' }),
      grade精確: menuParams({ ...m, grade: 1 }, { category_type: '' }),
      class空: menuParams({ ...m, class: '' }, { category_type: '' }),
      亂填類別: menuParams(m, { category_type: 'NOT-A-REAL-CATEGORY' }),
      不存在的課號: menuParams(m, { category_type: '' }),
    }
    for (const [name, params] of Object.entries(variants)) {
      const cosId = name === '不存在的課號' ? '999999' : id
      record('getregistrationcourselist', name, `查詢 ${name}`, { cos_id: cosId, ...params }, await post('getregistrationcourselist', { cos_id: cosId, ...params }))
    }
    // 核心課程：帶類別 vs 不帶類別，GroupUID 會不會變
    if (ctx.core) {
      const withCat = await reginfo(ctx.core.cos_id, ctx.core.menu, ctx.core.category_type)
      const without = await reginfo(ctx.core.cos_id, ctx.core.menu, '')
      record('getregistrationcourselist', '核心帶類別', '核心課程帶 category_type', { cos_id: ctx.core.cos_id }, withCat.reply,
        { GroupUID: withCat.rec && withCat.rec.GroupUID, type: withCat.rec && withCat.rec.cos_type_code })
      record('getregistrationcourselist', '核心不帶類別', '核心課程不帶 category_type', { cos_id: ctx.core.cos_id }, without.reply,
        { GroupUID: without.rec && without.rec.GroupUID, type: without.rec && without.rec.cos_type_code })
    }
  })

  add('setpreregist', true, async (ctx) => {
    const id = ctx.spare.cos_id
    const base = { cos_id: id, menu_data: JSON.stringify(ctx.spare.menu), wType: 'X', GroupName: 'null', GroupName_E: 'null', category_type: '', category_cname: 'null', category_ename: 'null' }
    const variants = {
      正確: base,
      空選單: { ...base, menu_data: '{}' },
      選單亂填: { ...base, menu_data: JSON.stringify({ type: 9, dep_category: 'ZZ', college_no: 'Q', dep_uid: '00000000-0000-0000-0000-000000000000', group: '*', grade: '*', class: '*' }) },
      選單不是JSON: { ...base, menu_data: 'not-json' },
      少欄位: { cos_id: id, menu_data: base.menu_data },
      wType空: { ...base, wType: '' },
      wType亂填: { ...base, wType: 'ZZ' },
      類別亂填: { ...base, category_type: 'NOT-A-REAL-CATEGORY' },
      不存在的課號: { ...base, cos_id: '999999' },
    }
    for (const [name, params] of Object.entries(variants)) {
      const reply = await post('setpreregist', params)
      const stored = ((await post('getpreregist')).json || []).find((c) => String(c.cos_id) === String(params.cos_id))
      record('setpreregist', name, `加入預排 ${name}`, params, reply, { stored: stored && { menu: stored.menu_data, wType: stored.wType, type: stored.cos_type_code, cat: stored.category_type } })
      if (stored) {
        // 順便確認選課網自己查不查得到
        const look = await reginfo(String(params.cos_id), menuOf(stored), stored.category_type || '')
        state.results[state.results.length - 1].cos查得到 = look.rec ? look.rec.status : 'EMPTY'
        await post('deletepreregist', { cos_id: params.cos_id })
      }
    }
    record('setpreregist', '重複加入', '同一課號加入兩次', { cos_id: id }, await (async () => {
      await post('setpreregist', base)
      const dup = await post('setpreregist', base)
      await post('deletepreregist', { cos_id: id })
      return dup
    })())
  })

  add('deletepreregist', true, async (ctx) => {
    const id = ctx.spare.cos_id
    record('deletepreregist', '不存在', '刪除沒有加過的課號', { cos_id: '999999' }, await post('deletepreregist', { cos_id: '999999' }))
    record('deletepreregist', '空課號', '課號留空', { cos_id: '' }, await post('deletepreregist', { cos_id: '' }))
    await post('setpreregist', { cos_id: id, menu_data: JSON.stringify(ctx.spare.menu), wType: 'X', GroupName: 'null', GroupName_E: 'null', category_type: '', category_cname: 'null', category_ename: 'null' })
    record('deletepreregist', '正常', '刪除剛加入的課', { cos_id: id }, await post('deletepreregist', { cos_id: id }))
  })

  add('setregist-wish', true, async (ctx) => {
    // 有人數上限、沒有志願群組：實測伺服器忽略 wish，一律存成 '1'
    const c = ctx.capped
    for (const wish of ['1', '', '0', '9', 'X']) {
      const reply = await safeRegister(c.cos_id, { cos_type_code: c.cos_type_code, wType: c.wType, wish, category_type: '' }, c)
      const rec = await regRecord(c.cos_id)
      record('setregist-wish', `無群組wish=${wish || '空'}`, `有上限無群組 wish=${wish || '(空)'}`, { cos_id: c.cos_id, wish }, reply, { sFlag: rec && JSON.stringify(rec.sFlag) })
      await safeCancel(c.cos_id)
    }
    // 有志願群組：範圍內、超範圍、0、空值。0 與空值會成功但存成無效狀態
    const g = ctx.group
    if (!g) return
    for (const wish of ['1', String(g.wish_limit), String(Number(g.wish_limit) + 1), '0', '']) {
      const reply = await safeRegister(g.cos_id, { cos_type_code: g.cos_type_code, wType: g.wType, wish, category_type: g.category_type || '' }, g)
      const rec = await regRecord(g.cos_id)
      record('setregist-wish', `群組wish=${wish || '空'}`, `志願群組 wish=${wish || '(空)'}`, { cos_id: g.cos_id, wish }, reply,
        { sFlag: rec && JSON.stringify(rec.sFlag), groupUid: rec && rec.GroupUID })
      await safeCancel(g.cos_id)
    }
  })

  add('setregist-attribution', true, async (ctx) => {
    // 採計方式是登記當下決定的，這組把每個欄位的異常值都試一次
    const c = ctx.core || ctx.capped
    const variants = {
      照查詢結果: { cos_type_code: c.cos_type_code, wType: c.wType, category_type: c.category_type || '' },
      類別留空: { cos_type_code: c.cos_type_code, wType: c.wType, category_type: '' },
      類別亂填: { cos_type_code: c.cos_type_code, wType: c.wType, category_type: 'NOT-A-REAL-CATEGORY' },
      當成選修: { cos_type_code: '2', wType: 'X', category_type: '' },
      wType亂填: { cos_type_code: c.cos_type_code, wType: '9', category_type: c.category_type || '' },
      wType空: { cos_type_code: c.cos_type_code, wType: '', category_type: c.category_type || '' },
      修課別亂填: { cos_type_code: 'Z', wType: c.wType, category_type: c.category_type || '' },
      修課別空: { cos_type_code: '', wType: c.wType, category_type: c.category_type || '' },
    }
    for (const [name, p] of Object.entries(variants)) {
      const reply = await safeRegister(c.cos_id, { ...p, wish: '1' }, c)
      const rec = await regRecord(c.cos_id)
      record('setregist-attribution', name, `登記時 ${name}`, { cos_id: c.cos_id, ...p }, reply,
        { 存成: rec && { type: rec.cos_type_code, wtype: rec.student_wtype, groupUid: rec.GroupUID, brief: rec.student_course_brief, briefName: rec.student_course_brief_cname } })
      await safeCancel(c.cos_id)
    }
  })

  add('setregist-errors', true, async (ctx) => {
    record('setregist-errors', '不存在的課號', '登記不存在的課號', { cos_id: '999999' },
      await post('setregist', { cos_id: '999999', cos_type_code: '2', wType: 'X', wish: '1', category_type: '' }))
    if (ctx.blocked) {
      record('setregist-errors', '未開放', '登記查詢結果 status error 的課', { cos_id: ctx.blocked.cos_id },
        await post('setregist', { cos_id: ctx.blocked.cos_id, cos_type_code: ctx.blocked.cos_type_code, wType: ctx.blocked.wType, wish: '1', category_type: '' }))
    }
    const c = ctx.capped
    const first = await safeRegister(c.cos_id, { cos_type_code: c.cos_type_code, wType: c.wType, wish: '1', category_type: '' }, c)
    const again = await post('setregist', { cos_id: c.cos_id, cos_type_code: c.cos_type_code, wType: c.wType, wish: '2', category_type: '' })
    record('setregist-errors', '重複登記', '已登記的課再送一次', { cos_id: c.cos_id }, again, { 第一次: shape(first) })
    await safeCancel(c.cos_id)
  })

  // 同群組的兩門課：不同志願一定可以；重複志願依 cos_limit 而異
  add('group-rules', true, async (ctx) => {
    const pair = ctx.groupPair
    if (!pair) return
    const [A, B] = pair
    await safeRegister(A.cos_id, { cos_type_code: A.cos_type_code, wType: A.wType, wish: '1', category_type: A.category_type || '' }, A)
    record('group-rules', `不同志願_cos_limit${A.cos_limit}`, '第二門課用志願 2', { cos_id: B.cos_id },
      await safeRegister(B.cos_id, { cos_type_code: B.cos_type_code, wType: B.wType, wish: '2', category_type: B.category_type || '' }, B))
    await safeCancel(B.cos_id)
    record('group-rules', `重複志願_cos_limit${A.cos_limit}`, '第二門課用同一個志願 1', { cos_id: B.cos_id },
      await safeRegister(B.cos_id, { cos_type_code: B.cos_type_code, wType: B.wType, wish: '1', category_type: B.category_type || '' }, B))
    await safeCancel(B.cos_id)
    await safeCancel(A.cos_id)
  })

  add('deleteregist', true, async (ctx) => {
    record('deleteregist', '沒登記的課', '取消沒有登記的課', { cos_id: ctx.capped.cos_id }, await post('deleteregist', { cos_id: ctx.capped.cos_id }))
    record('deleteregist', '空課號', '課號留空（確認不會變成整批刪除）', { cos_id: '' }, await post('deleteregist', { cos_id: '' }))
    record('deleteregist', '不存在課號', '不存在的課號', { cos_id: '999999' }, await post('deleteregist', { cos_id: '999999' }))
  })

  add('wish-table', true, async (ctx) => {
    const g = ctx.group
    if (!g) return
    const read = async () => {
      const w = (await post('getCosCategoryWish')).json || {}
      const row = w[g.GroupUID]
      return row && { wish: row.wish, wish_limit: row.wish_limit, cos_limit: row.cos_limit }
    }
    const before = await read()
    await safeRegister(g.cos_id, { cos_type_code: g.cos_type_code, wType: g.wType, wish: '4', category_type: g.category_type || '' }, g)
    const immediately = await read()
    await sleep(3000)
    const after3s = await read()
    await safeCancel(g.cos_id)
    await sleep(3000)
    const afterCancel = await read()
    record('wish-table', '更新時機', '登記第 4 志願前後讀志願表', { cos_id: g.cos_id }, { status: 200, ms: 0, json: {} },
      { before, immediately, after3s, afterCancel })
  })

  add('questionnaire', false, async () => {
    const timeReply = await post('getquesttime')
    record('questionnaire', 'getquesttime', '教學意見調查開放時間', {}, timeReply)
    const listReply = await post('getquestlist')
    record('questionnaire', 'getquestlist', '待填問卷清單', {}, listReply)
    const first = Array.isArray(listReply.json) ? listReply.json[0] : null
    const tpl = first && (first.questtemplate || first.QuestTemplate)
    if (tpl) record('questionnaire', 'getquestiondata', '題目內容（唯讀）', { questtemplate: tpl }, await post('getquestiondata', { questtemplate: tpl }))
    // setAnswers 會送出真實問卷，不測
  })

  // ---------- 挑選測試課程 ----------
  // 規則：capped＝有人數上限、沒有志願群組、查詢 status success；group＝有志願群組；
  // blocked＝查詢 status error；spare＝不在預排、不在正式選課的課號（拿來測預排寫入）。
  async function pickCourses() {
    const { preregist, registered } = await lists()
    const regIds = new Set(registered.map((c) => String(c.cos_id)))
    const ctx = {}
    for (const c of preregist) {
      const id = String(c.cos_id)
      if (regIds.has(id)) continue
      const { rec } = await reginfo(id, menuOf(c), c.category_type || '')
      if (!rec) continue
      const common = { cos_id: id, menu: menuOf(c), cos_type_code: rec.cos_type_code, wType: rec.wType, category_type: c.category_type || '', num_limit: rec.num_limit, GroupUID: rec.GroupUID, name: rec.cos_cname }
      if (rec.status === 'error' && !ctx.blocked) ctx.blocked = common
      if (rec.status !== 'success') continue
      if (rec.GroupUID) {
        const w = ((await post('getCosCategoryWish')).json || {})[rec.GroupUID]
        if (!ctx.group && w && Number(w.wish.F) <= Number(w.cos_limit)) ctx.group = { ...common, wish_limit: w.wish_limit, cos_limit: w.cos_limit }
      } else if (rec.num_limit !== '不限' && !ctx.capped) ctx.capped = common
      if (ctx.capped && ctx.group && ctx.blocked && ctx.groupPair) break
    }
    // 同群組的兩門課（給 group-rules 用）
    const byGroup = new Map()
    for (const c of preregist) {
      const id = String(c.cos_id)
      if (regIds.has(id)) continue
      const { rec } = await reginfo(id, menuOf(c), c.category_type || '')
      if (!rec || rec.status !== 'success' || !rec.GroupUID) continue
      const w = ((await post('getCosCategoryWish')).json || {})[rec.GroupUID]
      if (!w || Number(w.wish.F) > Number(w.cos_limit)) continue
      const row = { cos_id: id, cos_type_code: rec.cos_type_code, wType: rec.wType, category_type: c.category_type || '', num_limit: rec.num_limit, GroupUID: rec.GroupUID, cos_limit: w.cos_limit, wish_limit: w.wish_limit, name: rec.cos_cname }
      const bucket = byGroup.get(rec.GroupUID) || []
      bucket.push(row)
      byGroup.set(rec.GroupUID, bucket)
      if (bucket.length === 2) { ctx.groupPair = bucket; break }
    }
    // 開課系所（使用者自己的系）選單，順便找一門不在預排也不在正式選課的課當 spare
    const me = (await post('userinfo')).json || {}
    ctx.deptMenu = { type: me.type, dep_category: me.dep_category, college_no: me.college_no, dep_uid: me.dep_uid, group: '*', grade: '*', class: '*' }
    const deptList = (await post('preregistcourse', menuParams(ctx.deptMenu, { codition: '' }))).json || []
    const preIds = new Set(preregist.map((c) => String(c.cos_id)))
    const spare = deptList.find((c) => !preIds.has(String(c.cos_id)) && !regIds.has(String(c.cos_id)))
    if (spare) ctx.spare = { cos_id: String(spare.cos_id), menu: ctx.deptMenu, name: spare.cos_cname }
    ctx.core = preregist.filter((c) => c.category_type).map((c) => ({ cos_id: String(c.cos_id), menu: menuOf(c), category_type: c.category_type }))[0] || null
    if (ctx.core) {
      const { rec } = await reginfo(ctx.core.cos_id, ctx.core.menu, ctx.core.category_type)
      ctx.core = rec && rec.status === 'success' && !regIds.has(ctx.core.cos_id)
        ? { ...ctx.core, cos_type_code: rec.cos_type_code, wType: rec.wType, num_limit: rec.num_limit, GroupUID: rec.GroupUID, name: rec.cos_cname }
        : null
    }
    return ctx
  }

  async function run({ writes = false, only = null } = {}) {
    const startedAt = new Date().toISOString()
    state.results = []
    const before = await lists()
    state.snapshot = before
    if (before.registered.some((c) => String(c.sFlag) !== 'F')) {
      console.warn('注意：目前有「已登記」的課，實驗結束的比對會把它們算進去。')
    }
    const ctx = await pickCourses()
    console.log('測試課程：', ctx)
    for (const g of groups) {
      if (only && !only.includes(g.id)) continue
      if (g.writes && !writes) continue
      try {
        await g.run(ctx)
        console.log(`✓ ${g.id}`)
      } catch (err) {
        state.results.push({ group: g.id, id: 'ERROR', desc: String(err && err.message || err) })
        console.error(`✗ ${g.id}`, err)
      }
    }
    // 還原檢查
    const after = await lists()
    const same = (a, b) => JSON.stringify(a.map((c) => String(c.cos_id)).sort()) === JSON.stringify(b.map((c) => String(c.cos_id)).sort())
    const restored = { 預排相同: same(before.preregist, after.preregist), 正式選課相同: same(before.registered, after.registered), 全部已選上: after.registered.every((c) => String(c.sFlag) === 'F') }
    if (!restored.預排相同 || !restored.正式選課相同 || !restored.全部已選上) {
      console.error('⚠️ 狀態沒有完全還原，請檢查：', restored, after)
    }
    state.meta = { startedAt, finishedAt: new Date().toISOString(), writes, ctx, restored, 預排筆數: after.preregist.length, 正式選課筆數: after.registered.length }
    return { meta: state.meta, count: state.results.length }
  }

  const dump = () => JSON.stringify({ meta: state.meta, results: state.results }, null, 1)
  const summary = () => state.results.map((r) => ({ g: r.group, id: r.id, ms: r.ms, reply: r.reply, ...(r.sFlag !== undefined ? { sFlag: r.sFlag } : {}), ...(r.存成 ? { 存成: r.存成 } : {}), ...(r.cos查得到 ? { cos查得到: r.cos查得到 } : {}) }))

  window.cosProbe = { run, dump, summary, get results() { return state.results }, get meta() { return state.meta }, post, groups: groups.map((g) => g.id) }
  console.log('cosProbe 已載入。實驗組：', groups.map((g) => g.id).join(', '))
})()
