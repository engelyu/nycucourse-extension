// 課程時間表（timetable.nycu.edu.tw）請求參數與回應解析。純函式，不做網路請求。

export function pickSemester(acysemList) {
  for (const row of acysemList || []) {
    const t = row && typeof row.T === 'string' ? row.T : ''
    if (/^\d{3,4}[12]$/.test(t)) return t
  }
  throw new Error('找不到學期')
}

export function formBody(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2A/gi, '*')}`)
    .join('&')
}

export function cosListParams(semester, depUid) {
  const acy = semester.slice(0, -1)
  const sem = semester.slice(-1)
  return {
    m_acy: acy,
    m_sem: sem,
    m_acyend: acy,
    m_semend: sem,
    m_dep_uid: depUid,
    m_group: '**',
    m_grade: '**',
    m_class: '**',
    m_option: '**',
    m_crsname: '**',
    m_teaname: '**',
    m_cos_id: '**',
    m_cos_code: '**',
    m_crstime: '**',
    m_crsoutline: '**',
    m_costype: '**',
    m_selcampus: '**',
  }
}

export function objectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value)
}

const str = (v) => (v == null ? '' : String(v))

// menu：這批課程是從哪個系所查到的，之後要向選課網查已選人數時需要。
export function parseCosList(json, menu) {
  const out = []
  for (const depKey of objectKeys(json)) {
    const dep = json[depKey]
    for (const k of objectKeys(dep)) {
      if (!/^\d+$/.test(k)) continue
      const group = dep[k]
      for (const key of objectKeys(group)) {
        const c = group[key] || {}
        const course = {
          id: str(c.cos_id),
          name: str(c.cos_cname),
          ename: str(c.cos_ename),
          teacher: str(c.teacher),
          time: str(c.cos_time),
          credit: str(c.cos_credit),
          type: str(c.cos_type),
          dep: str(c.dep_cname),
          limit: str(c.num_limit),
          enrolled: str(c.reg_num),
        }
        if (menu) course.menu = menu
        out.push(course)
      }
    }
  }
  return out
}
