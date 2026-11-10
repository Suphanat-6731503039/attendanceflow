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
