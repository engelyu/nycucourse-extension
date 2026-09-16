// 課程時間表的課程大綱網址，例如
// https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=115&Sem=1&CrsNo=516700&lang=zh-tw
const SEMESTER = /^(\d{3})([12X])$/
const COURSE_ID = /^\d{6}$/
const SEMESTER_PREFIX = /^\d{4}_/

export function courseOutlineUrl(semester, courseId) {
  const sem = SEMESTER.exec(String(semester ?? '').trim())
  if (!sem) return null
  const id = String(courseId ?? '').trim().replace(SEMESTER_PREFIX, '')
  if (!COURSE_ID.test(id)) return null
  return `https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=${sem[1]}&Sem=${sem[2]}&CrsNo=${id}&lang=zh-tw`
}
