const VALID_STATUSES = new Set(['unmarked', 'present', 'late', 'absent', 'excused'])

function localDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function validateData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.students) || !Array.isArray(data.sessions)) {
    return false
  }
  const classes = data.classes ?? []
  const courseSessions = data.courseSessions ?? []
  if (!Array.isArray(classes) || !Array.isArray(courseSessions)
    || classes.length > 2000 || courseSessions.length > 10000) return false

  const studentIds = new Set()
  const studentCodes = new Set()
  for (const student of data.students) {
    if (!student
      || typeof student.id !== 'string'
      || !student.id.trim()
      || typeof student.code !== 'string'
      || !student.code.trim()
      || typeof student.name !== 'string'
      || !student.name.trim()
      || typeof student.active !== 'boolean'
      || (student.email !== undefined && typeof student.email !== 'string')) {
      return false
    }
    const normalizedCode = student.code.trim().toLowerCase()
    if (studentIds.has(student.id) || studentCodes.has(normalizedCode)) return false
    studentIds.add(student.id)
    studentCodes.add(normalizedCode)
  }

  const sessionIds = new Set()
  for (const session of data.sessions) {
    if (!session
      || typeof session.id !== 'string'
      || typeof session.courseCode !== 'string'
      || typeof session.courseName !== 'string'
      || typeof session.room !== 'string'
      || typeof session.date !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(session.date)
      || localDate(new Date(`${session.date}T12:00:00`)) !== session.date
      || typeof session.startTime !== 'string'
      || typeof session.endTime !== 'string'
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.startTime)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.endTime)
      || session.endTime <= session.startTime
      || !Array.isArray(session.roster)) return false
    if (!['scheduled', 'open', 'closed'].includes(session.status) || sessionIds.has(session.id)) return false
    sessionIds.add(session.id)
    const rosterIds = new Set()
    for (const record of session.roster) {
      if (!record
        || typeof record.studentId !== 'string'
        || typeof record.studentCode !== 'string'
        || !record.studentCode.trim()
        || typeof record.studentName !== 'string'
        || !record.studentName.trim()
        || !studentIds.has(record.studentId)
        || !VALID_STATUSES.has(record.status)
        || (record.markedAt !== null && typeof record.markedAt !== 'string')) return false
      if (record.checkInLocation !== undefined
        && (!record.checkInLocation || !Number.isFinite(record.checkInLocation.latitude)
          || record.checkInLocation.latitude < -90 || record.checkInLocation.latitude > 90
          || !Number.isFinite(record.checkInLocation.longitude)
          || record.checkInLocation.longitude < -180 || record.checkInLocation.longitude > 180
          || !Number.isFinite(record.checkInLocation.accuracy)
          || record.checkInLocation.accuracy < 0 || record.checkInLocation.accuracy > 100000)) return false
      if (rosterIds.has(record.studentId)) return false
      rosterIds.add(record.studentId)
    }
  }

  const classIds = new Set()
  for (const classroom of classes) {
    if (!classroom || typeof classroom.id !== 'string' || !classroom.id.trim()
      || typeof classroom.courseCode !== 'string' || !classroom.courseCode.trim()
      || typeof classroom.courseName !== 'string' || !classroom.courseName.trim()
      || typeof classroom.room !== 'string' || !Array.isArray(classroom.studentIds)
      || classroom.studentIds.some((studentId) => !studentIds.has(studentId))) return false
    if (classIds.has(classroom.id)) return false
    classIds.add(classroom.id)
  }

  const courseSessionIds = new Set()
  for (const session of courseSessions) {
    if (!session || typeof session.id !== 'string' || !classIds.has(session.classId)
      || typeof session.title !== 'string' || !session.title.trim()
      || !Number.isInteger(session.weekday) || session.weekday < 0 || session.weekday > 6
      || typeof session.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.startTime)
      || typeof session.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.endTime)
      || session.endTime <= session.startTime || !Array.isArray(session.materials)) return false
    if (courseSessionIds.has(session.id)) return false
    courseSessionIds.add(session.id)
    if (session.materials.some((material) => !material || typeof material.id !== 'string'
      || !['text', 'image', 'slide', 'link'].includes(material.type)
      || typeof material.title !== 'string'
      || (material.type === 'text' && (typeof material.text !== 'string' || material.text.length > 20000))
      || (['image', 'slide'].includes(material.type) && typeof material.objectKey !== 'string')
      || (material.type === 'link' && (typeof material.url !== 'string' || !/^https:\/\//i.test(material.url))))) return false
  }

  if (data.activity !== undefined) {
    if (!Array.isArray(data.activity)) return false
    if (data.activity.some((event) => (
      !event
      || typeof event.id !== 'string'
      || typeof event.action !== 'string'
      || typeof event.detail !== 'string'
      || typeof event.createdAt !== 'string'
    ))) return false
  }

  return true
}

export function parseAttendanceBackup(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This backup is not valid JSON')
  }
  if (!validateData(parsed)) {
    throw new Error('This file is not a valid AttendanceFlow backup')
  }
  return parsed
}
