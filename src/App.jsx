import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FileText,
  LayoutDashboard,
  Menu,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

import {
  parseAttendanceBackup,
  validateData,
} from './lib/attendanceDataValidation'
import {
  createInvitation,
  createStudentInvitation,
  getAuthStatus,
  getCurrentUser,
  getPartnerIntegrationStatus,
  getStudentSchedule,
  getWorkspace,
  joinWorkspace,
  saveWorkspace,
  setupOwner,
  signIn,
  signOut,
  submitStudentCheckIn,
  syncPartnerEnrollments,
  retryPartnerReconciliation,
} from './lib/cloudAttendanceApi'

const pageDetails = {
  overview: { label: 'Overview', title: 'Good morning, Araya', subtitle: 'Here is your attendance snapshot' },
  sessions: { label: 'Class sessions', title: 'Class sessions', subtitle: 'Create sessions and manage their independent rosters' },
  attendance: { label: 'Attendance roster', title: 'Attendance roster', subtitle: 'Record attendance for one class session at a time' },
  students: { label: 'Students', title: 'Student directory', subtitle: 'Manage student records synced from UniEnroll' },
  reports: { label: 'Reports', title: 'Attendance reports', subtitle: 'Review session history and export attendance records' },
  settings: { label: 'Data & backup', title: 'Data & backup', subtitle: 'Manage shared records, invite teammates, and protect your data' },
}

const emptyCounts = { present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 }

function createId(prefix) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || 'ST'
}

function localDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function bangkokDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

function formatDate(value, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', options).format(new Date(`${value}T12:00:00`))
}

function formatBangkokDate(value, options) {
  return new Intl.DateTimeFormat('th-TH', { ...options, timeZone: 'Asia/Bangkok' })
    .format(new Date(`${value}T12:00:00+07:00`))
}

function sessionCounts(session) {
  return (session?.roster || []).reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1
    return result
  }, { ...emptyCounts })
}

function recordActivity(data, action, detail) {
  return [
    { id: createId('activity'), action, detail, createdAt: new Date().toISOString() },
    ...(Array.isArray(data.activity) ? data.activity : []),
  ].slice(0, 500)
}

function escapeCsv(value) {
  const safeValue = String(value ?? '').replace(/^(\s*[=+\-@])/, "'$1")
  return `"${safeValue.replaceAll('"', '""')}"`
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function currentRoute() {
  const path = window.location.pathname.toLowerCase()
  return ['/student', '/professor'].includes(path) ? path : '/admin'
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location access'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
      }),
      (error) => reject(new Error(error.code === 1
        ? 'Location permission is required to check in'
        : 'Could not get your location. Please try again')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  })
}

function App() {
  const [data, setData] = useState(null)
  const dataRef = useRef(null)
  const savedDataRef = useRef(null)
  const workspaceRevisionRef = useRef(0)
  const writeQueueRef = useRef(Promise.resolve())
  const writingRef = useRef(false)
  const pendingNoticeRef = useRef('')
  const [account, setAccount] = useState(null)
  const [authMode, setAuthMode] = useState(() => new URLSearchParams(window.location.search).has('invite') ? 'join' : 'login')
  const [workspaceInitialized, setWorkspaceInitialized] = useState(true)
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authBootError, setAuthBootError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [view, setView] = useState('overview')
  const [route, setRoute] = useState(currentRoute)
  const [studentSchedule, setStudentSchedule] = useState(null)
  const [portalError, setPortalError] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [reportSessionId, setReportSessionId] = useState('all')
  const [mobileNav, setMobileNav] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [studentFilter, setStudentFilter] = useState('active')
  const [showCreateSession, setShowCreateSession] = useState(false)
  const [studentEditor, setStudentEditor] = useState(null)
  const [sessionError, setSessionError] = useState('')
  const [studentError, setStudentError] = useState('')
  const [backupError, setBackupError] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [partnerSyncing, setPartnerSyncing] = useState(false)
  const importInput = useRef(null)
  const inviteFromUrl = new URLSearchParams(window.location.search).get('invite') || ''

  const sessions = data?.sessions || []
  const students = data?.students || []
  const selectedSession = sessions.find((session) => session.id === selectedSessionId)
    || sessions.find((session) => session.status === 'open')
    || sessions[0]
  const activeStudents = students.filter((student) => student.active)
  const currentPage = pageDetails[view] || pageDetails.overview
  const todayLabel = useMemo(() => new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date()), [])

  const currentCounts = useMemo(() => sessionCounts(selectedSession), [selectedSession])
  const filteredRoster = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    return (selectedSession?.roster || []).filter((record) => {
      const matchesSearch = !normalizedSearch
        || record.studentName.toLowerCase().includes(normalizedSearch)
        || record.studentCode.toLowerCase().includes(normalizedSearch)
      const matchesStatus = statusFilter === 'all' || record.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [search, selectedSession, statusFilter])

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const status = await getAuthStatus()
        if (active) setWorkspaceInitialized(status.initialized)
        if (!status.initialized) {
          if (active) setAuthMode('login')
          return
        }
        try {
          const session = await getCurrentUser()
          if (session.user.role === 'student') {
            const schedule = await getStudentSchedule()
            if (active) {
              setAccount(session.user)
              setStudentSchedule(schedule)
              setRoute('/student')
              window.history.replaceState({}, '', '/student')
            }
          } else {
            const workspace = await getWorkspace()
            if (active) {
              loadWorkspace(session.user, workspace)
              if (route === '/student') {
                setRoute('/professor')
                window.history.replaceState({}, '', '/professor')
              }
            }
          }
        } catch (error) {
          if (error.status !== 401) throw error
          if (active) setAuthMode('login')
        }
      } catch (error) {
        if (active) setAuthBootError(error.message)
      } finally {
        if (active) setAuthLoading(false)
      }
    }
    initialize()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!account || !data) return undefined
    let active = true
    async function syncWorkspace() {
      if (writingRef.current || !dataRef.current || !savedDataRef.current) return
      try {
        const workspace = await getWorkspace()
        if (!active || workspace.revision <= workspaceRevisionRef.current) return
        if (JSON.stringify(dataRef.current) !== JSON.stringify(savedDataRef.current)) return
        dataRef.current = workspace.data
        savedDataRef.current = workspace.data
        workspaceRevisionRef.current = workspace.revision
        setData(workspace.data)
        setStorageError('')
      } catch (error) {
        if (active) setStorageError(`Could not sync shared changes: ${error.message}`)
      }
    }
    const interval = window.setInterval(syncWorkspace, 15000)
    window.addEventListener('focus', syncWorkspace)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', syncWorkspace)
    }
  }, [account, data])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function loadWorkspace(user, workspace) {
    dataRef.current = workspace.data
    savedDataRef.current = workspace.data
    workspaceRevisionRef.current = workspace.revision
    setData(workspace.data)
    setAccount(user)
    setStorageError('')
    setSelectedSessionId(workspace.data.sessions.find((session) => session.status === 'open')?.id || workspace.data.sessions[0]?.id || '')
  }

  function navigate(nextRoute) {
    const routePath = nextRoute.toLowerCase()
    window.history.pushState({}, '', routePath)
    setRoute(routePath)
  }

  async function loadStudent(user) {
    const schedule = await getStudentSchedule()
    dataRef.current = null
    savedDataRef.current = null
    window.history.replaceState({}, '', '/student')
    setAccount(user)
    setStudentSchedule(schedule)
    setData(null)
    setRoute('/student')
  }

  async function submitAuth(event) {
    event.preventDefault()
    setAuthError('')
    setAuthBusy(true)
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const email = String(form.get('email') || '').trim()
    const password = String(form.get('password') || '')
    try {
      let result
      if (authMode === 'setup') {
        result = await setupOwner(String(form.get('setupCode') || '').trim(), name, email, password)
      } else if (authMode === 'join') {
        result = await joinWorkspace(String(form.get('inviteCode') || '').trim(), name, email, password)
      } else {
        result = await signIn(email, password)
      }
      if (result.user.role === 'student') {
        await loadStudent(result.user)
      } else {
        const workspace = await getWorkspace()
        loadWorkspace(result.user, workspace)
        if (route === '/student') navigate('/professor')
      }
      setAuthMode('login')
      setAuthBootError('')
      setNotice(authMode === 'setup' ? 'Attendance workspace created' : authMode === 'join' ? 'You joined the Attendance workspace' : 'Signed in successfully')
    } catch (error) {
      setAuthError(error.message)
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    try {
      await signOut()
      dataRef.current = null
      savedDataRef.current = null
      setData(null)
      setStudentSchedule(null)
      setAccount(null)
      setAuthMode('login')
      setAuthError('')
      setNotice('')
    } catch (error) {
      setStorageError(`Could not sign out: ${error.message}`)
    }
  }

  function commitData(update, successMessage) {
    const current = dataRef.current
    if (!current) return false
    const next = typeof update === 'function' ? update(current) : update
    if (!validateData(next)) {
      setStorageError('Attendance data failed validation and was not saved')
      return false
    }
    dataRef.current = next
    pendingNoticeRef.current = successMessage
    setData(next)
    setStorageError('')
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      writingRef.current = true
      let wrote = false
      while (dataRef.current && JSON.stringify(dataRef.current) !== JSON.stringify(savedDataRef.current)) {
        const snapshot = dataRef.current
        const workspace = await saveWorkspace(snapshot, workspaceRevisionRef.current)
        savedDataRef.current = workspace.data
        workspaceRevisionRef.current = workspace.revision
        wrote = true
      }
      if (wrote) {
        setStorageError('')
        if (pendingNoticeRef.current) setNotice(pendingNoticeRef.current)
        pendingNoticeRef.current = ''
      }
    }).catch(async (error) => {
      let latest = error.data
      let refreshErrorMessage = ''
      if (!latest?.data || !Number.isInteger(latest.revision)) {
        try {
          latest = await getWorkspace()
        } catch (refreshError) {
          refreshErrorMessage = ` The shared copy could not be reloaded: ${refreshError.message}`
        }
      }
      if (latest?.data && Number.isInteger(latest.revision)) {
        dataRef.current = latest.data
        savedDataRef.current = latest.data
        workspaceRevisionRef.current = latest.revision
        setData(latest.data)
      }
      setStorageError(`Could not save your change: ${error.message}${refreshErrorMessage}`)
      pendingNoticeRef.current = ''
    }).finally(() => {
      writingRef.current = false
    })
    return true
  }

  function updateAttendance(studentId, status) {
    if (!selectedSession || selectedSession.status === 'closed') return
    const record = selectedSession.roster.find((item) => item.studentId === studentId)
    if (!record || record.status === status) return
    const markedAt = status === 'present' || status === 'late'
      ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
      : null
    commitData((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id !== selectedSession.id ? session : {
        ...session,
        roster: session.roster.map((item) => item.studentId === studentId ? { ...item, status, markedAt } : item),
      }),
      activity: recordActivity(current, 'attendance.updated', `${record.studentName}: ${status} · ${selectedSession.courseCode} · ${selectedSession.date}`),
    }), `${record.studentName}'s status changed to ${status}`)
  }

  function addStudentToSession(studentId) {
    if (!selectedSession || selectedSession.status === 'closed') return
    const student = students.find((item) => item.id === studentId && item.active)
    if (!student || selectedSession.roster.some((record) => record.studentId === student.id)) return
    commitData((current) => ({
      ...current,
      sessions: current.sessions.map((session) => session.id !== selectedSession.id ? session : {
        ...session,
        roster: [...session.roster, {
          studentId: student.id,
          studentCode: student.code,
          studentName: student.name,
          status: 'unmarked',
          markedAt: null,
        }],
      }),
      activity: recordActivity(current, 'attendance.roster_added', `${student.name} added to ${selectedSession.courseCode} · ${selectedSession.date}`),
    }), `${student.name} added to this session`)
  }

  async function syncPartnerRoster(session) {
    if (!session || partnerSyncing) return
    setPartnerSyncing(true)
    setStorageError('')
    try {
      await writeQueueRef.current
      if (JSON.stringify(dataRef.current) !== JSON.stringify(savedDataRef.current)) {
        throw new Error('Save your pending workspace changes before syncing the roster')
      }
      const result = await syncPartnerEnrollments(session.id)
      const workspace = await getWorkspace()
      dataRef.current = workspace.data
      savedDataRef.current = workspace.data
      workspaceRevisionRef.current = workspace.revision
      setData(workspace.data)
      setNotice(`Synced ${result.syncedCount} students from UniEnroll`)
    } catch (error) {
      setStorageError(`Could not sync UniEnroll roster: ${error.message}`)
    } finally {
      setPartnerSyncing(false)
    }
  }

  function createSession(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const startTime = String(form.get('startTime'))
    const endTime = String(form.get('endTime'))
    const courseCode = String(form.get('courseCode')).trim().toUpperCase()
    const courseName = String(form.get('courseName')).trim()
    const room = String(form.get('room')).trim()
    const sectionNumber = String(form.get('sectionNumber') || '').trim()
    if (!courseCode || !courseName || !room || !form.get('date')) {
      setSessionError('Enter the course code, course name, room, and date')
      return
    }
    if (endTime <= startTime) {
      setSessionError('End time must be later than the start time')
      return
    }
    const date = String(form.get('date'))
    const status = form.get('openNow') === 'on' ? 'open' : 'scheduled'
    const id = createId('session')
    const selectedStudentIds = new Set(form.getAll('studentIds').map(String))
    if (!selectedStudentIds.size) {
      setSessionError('Select at least one student for this class')
      return
    }
    const newSession = {
      id,
      courseCode,
      courseName,
      room: String(form.get('room')).trim(),
      ...(sectionNumber ? { sectionNumber } : {}),
      date,
      startTime,
      endTime,
      status,
      roster: activeStudents.filter((student) => selectedStudentIds.has(student.id)).map((student) => ({
        studentId: student.id,
        studentCode: student.code,
        studentName: student.name,
        status: 'unmarked',
        markedAt: null,
      })),
      createdAt: new Date().toISOString(),
    }
    const saved = commitData((current) => ({
      ...current,
      sessions: [newSession, ...current.sessions],
      activity: recordActivity(current, 'session.created', `${courseCode} · ${date}`),
    }), `${courseCode} session created`)
    if (saved) {
      setSelectedSessionId(id)
      setView(status === 'open' ? 'attendance' : 'sessions')
      setShowCreateSession(false)
      setSessionError('')
      return id
    }
    return null
  }

  function saveStudent(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const code = String(form.get('code')).trim()
    const name = String(form.get('name')).trim()
    const studentEmail = String(form.get('email')).trim()
    const editingId = studentEditor?.id
    if (!code || !name) {
      setStudentError('Enter a student ID and name')
      return
    }
    const duplicate = students.some((student) => student.code.toLowerCase() === code.toLowerCase() && student.id !== editingId)
    if (duplicate) {
      setStudentError('That student ID already exists in your directory')
      return
    }

    if (editingId) {
      const saved = commitData((current) => ({
        ...current,
        students: current.students.map((student) => student.id === editingId ? { ...student, code, name, email: studentEmail } : student),
        sessions: current.sessions.map((session) => session.status === 'closed' ? session : ({
          ...session,
          roster: session.roster.map((record) => record.studentId === editingId ? { ...record, studentCode: code, studentName: name } : record),
        })),
        activity: recordActivity(current, 'student.updated', `${name} (${code})`),
      }), `${name}'s details updated`)
      if (saved) setStudentEditor(null)
    } else {
      const student = { id: createId('student'), code, name, email: studentEmail, active: true, createdAt: new Date().toISOString() }
      const saved = commitData((current) => ({
        ...current,
        students: [...current.students, student],
        activity: recordActivity(current, 'student.created', `${name} (${code})`),
      }), `${name} added to the student directory`)
      if (saved) setStudentEditor(null)
    }
    setStudentError('')
  }

  function archiveStudent(student) {
    if (!student.active) return
    if (!window.confirm(`Archive ${student.name}? They will stay in past session records but won't be added to new sessions`)) return
    commitData((current) => ({
      ...current,
      students: current.students.map((item) => item.id === student.id ? { ...item, active: false, archivedAt: new Date().toISOString() } : item),
      activity: recordActivity(current, 'student.archived', `${student.name} (${student.code})`),
    }), `${student.name} archived. Their attendance history was kept`)
  }

  function toggleSession(session) {
    const nextStatus = session.status === 'open' ? 'closed' : 'open'
    if (nextStatus === 'closed' && !window.confirm('Close this session? All unmarked students will be recorded as absent')) return
    commitData((current) => ({
      ...current,
      sessions: current.sessions.map((item) => item.id !== session.id ? item : ({
        ...item,
        status: nextStatus,
        closedAt: nextStatus === 'closed' ? new Date().toISOString() : null,
        roster: nextStatus === 'closed'
          ? item.roster.map((record) => record.status === 'unmarked' ? { ...record, status: 'absent', markedAt: null } : record)
          : item.roster,
      })),
      activity: recordActivity(current, `session.${nextStatus}`, `${session.courseCode} · ${session.date}`),
    }), `${session.courseCode} session ${nextStatus}`)
    setSelectedSessionId(session.id)
  }

  function exportSessionCsv(session) {
    if (!session) return
    const rows = [
      ['Course code', 'Course name', 'Date', 'Room', 'Student ID', 'Student name', 'Status', 'Check-in time'],
      ...session.roster.map((record) => [
        session.courseCode,
        session.courseName,
        session.date,
        session.room,
        record.studentCode,
        record.studentName,
        record.status,
        record.markedAt || '',
      ]),
    ]
    const safeCourseCode = session.courseCode.replace(/[^a-z0-9._-]/gi, '_')
    downloadFile(`${safeCourseCode}-${session.date}-attendance.csv`, `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8')
    setNotice(`${session.courseCode} attendance CSV downloaded`)
  }

  function exportAllCsv() {
    const rows = [
      ['Course code', 'Course name', 'Date', 'Room', 'Student ID', 'Student name', 'Status', 'Check-in time'],
      ...sessions.flatMap((session) => session.roster.map((record) => [
        session.courseCode,
        session.courseName,
        session.date,
        session.room,
        record.studentCode,
        record.studentName,
        record.status,
        record.markedAt || '',
      ])),
    ]
    downloadFile('attendanceflow-attendance.csv', `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`, 'text/csv;charset=utf-8')
    setNotice('Attendance report CSV downloaded')
  }

  function exportBackup() {
    if (!data) return
    downloadFile(`attendanceflow-backup-${localDate()}.json`, JSON.stringify(data, null, 2), 'application/json')
    setNotice('AttendanceFlow backup downloaded')
  }

  async function importBackup(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Backup files must be 5 MB or smaller')
      const imported = parseAttendanceBackup(await file.text())
      if (!window.confirm(`Replace the shared workspace with ${imported.students.length} students and ${imported.sessions.length} sessions from this backup? This affects everyone in the workspace`)) return
      if (commitData(imported, 'Backup restored successfully')) {
        setSelectedSessionId(imported.sessions.find((session) => session.status === 'open')?.id || imported.sessions[0]?.id || '')
        setReportSessionId('all')
        setBackupError('')
      }
    } catch (error) {
      setBackupError(error.message)
    } finally {
      event.target.value = ''
    }
  }

  async function createInvite() {
    setInviteError('')
    setInviteCopied(false)
    try {
      const invitation = await createInvitation()
      setInviteCode(invitation.code)
    } catch (error) {
      setInviteError(error.message)
    }
  }

  async function createStudentInvite(sessionId, studentId) {
    setPortalError('')
    try {
      return await createStudentInvitation(studentId, sessionId)
    } catch (error) {
      setPortalError(error.message)
      return null
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setInviteCopied(true)
    } catch (error) {
      setInviteError(`Could not copy the invite code: ${error.message}`)
    }
  }

  if (authLoading) return <div className="auth-loading">Connecting to the shared AttendanceFlow workspace</div>
  if (!account) return <AuthScreen
    mode={authMode}
    initialized={workspaceInitialized}
    error={authError || authBootError}
    busy={authBusy}
    inviteCode={inviteFromUrl}
    onSubmit={submitAuth}
    onModeChange={(mode) => { setAuthMode(mode); setAuthError(''); setAuthBootError('') }}
  />
  if (account.role === 'student') {
    if (!studentSchedule) return <div className="auth-loading">Loading your class schedule</div>
    return <StudentPortal
      account={account}
      schedule={studentSchedule}
      error={portalError}
      onSignOut={handleSignOut}
      onRefresh={async () => {
        try {
          setStudentSchedule(await getStudentSchedule())
          setPortalError('')
        } catch (error) {
          setPortalError(`Could not refresh your schedule: ${error.message}`)
        }
      }}
      onCheckIn={async (sessionId, location) => {
        setPortalError('')
        try {
          await submitStudentCheckIn(sessionId, location)
          try {
            setStudentSchedule(await getStudentSchedule())
          } catch (error) {
            setPortalError(`เช็กชื่อสำเร็จแล้ว แต่รีเฟรชตารางไม่สำเร็จ: ${error.message}`)
          }
        } catch (error) {
          setPortalError(error.message)
          throw error
        }
      }}
    />
  }
  if (!data) return <div className="auth-loading">Loading shared attendance data</div>

  if (route === '/professor') return <ProfessorPortal
    account={account}
    sessions={sessions}
    students={activeStudents}
    onSignOut={handleSignOut}
    onCreateSession={() => { setSessionError(''); setShowCreateSession(true) }}
    onToggleSession={toggleSession}
    onInviteStudent={createStudentInvite}
    onSyncPartner={syncPartnerRoster}
    partnerSyncing={partnerSyncing}
    inviteError={portalError}
    storageError={storageError}
    showCreateSession={showCreateSession}
    sessionError={sessionError}
    onSubmitSession={createSession}
    onCloseCreateSession={() => setShowCreateSession(false)}
  />

  return (
    <div className="app-shell">
      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
        <div className="brand"><span className="brand-mark"><Check size={17} strokeWidth={3} /></span><span>Attendance<span>Flow</span></span></div>
        <div className="profile-mini"><div className="avatar coral-avatar">{initials(account.name)}</div><div><strong>{account.name}</strong><small>{account.role === 'admin' ? 'Workspace administrator' : 'Attendance instructor'}</small></div><ChevronDown size={15} /></div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          <NavButton icon={<LayoutDashboard size={18} />} active={view === 'overview'} onClick={() => { setView('overview'); setMobileNav(false) }}>Overview</NavButton>
          <NavButton icon={<CalendarDays size={18} />} active={view === 'sessions'} onClick={() => { setView('sessions'); setMobileNav(false) }}>Class sessions</NavButton>
          <NavButton icon={<Users size={18} />} active={view === 'attendance'} onClick={() => { setView('attendance'); setMobileNav(false) }}>Attendance</NavButton>
          <NavButton icon={<UserPlus size={18} />} active={view === 'students'} onClick={() => { setView('students'); setMobileNav(false) }}>Students</NavButton>
          <NavButton icon={<BarChart3 size={18} />} active={view === 'reports'} onClick={() => { setView('reports'); setMobileNav(false) }}>Reports</NavButton>
        </nav>
        <div className="sidebar-bottom">
          <NavButton icon={<Settings size={18} />} active={view === 'settings'} onClick={() => { setView('settings'); setMobileNav(false) }}>Data & backup</NavButton>
          <NavButton icon={<CircleHelp size={18} />} onClick={() => setNotice('Attendance is shared with your team. Use Data & backup to download a portable copy')}>Help center</NavButton>
          <div className="workspace-note"><span className="workspace-indicator" /><div><strong>Shared cloud workspace</strong><small>Independent of Enrollment</small></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="menu-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={21} /></button>
          <div className="breadcrumb"><span>AttendanceFlow</span><ChevronRight size={14} /><strong>{currentPage.label}</strong></div>
          <div className="top-actions"><a className="text-button" href="/professor">Professor view</a><span className="term-label">Cloud · Shared data</span><button className="text-button sign-out-button" onClick={handleSignOut}>Sign out</button><div className="top-avatar">{initials(account.name)}</div></div>
        </header>

        <div className="page-wrap">
          <section className="welcome-row">
            <div><p className="eyebrow">{todayLabel}</p><h1>{currentPage.title}</h1><p className="muted">{currentPage.subtitle}</p></div>
            {view === 'sessions' && <button className="primary-button" onClick={() => { setSessionError(''); setShowCreateSession(true) }}><Plus size={17} /> New session</button>}
            {view === 'students' && <button className="primary-button" onClick={() => { setStudentError(''); setStudentEditor({}); }}><UserPlus size={16} /> Add student</button>}
          </section>

          <div className="demo-banner">
            <div className="demo-banner-icon"><ShieldCheck size={17} /></div>
            <div><strong>UniEnroll integration</strong><span>Sync enrollment rosters and securely queue attendance events for delivery</span></div>
            <span className="demo-tag">CLOUD SYNC</span>
          </div>

          {storageError && <div className="storage-warning" role="alert"><ShieldCheck size={16} /><span>{storageError}</span><button onClick={() => setStorageError('')} aria-label="Dismiss storage warning"><X size={15} /></button></div>}
          {notice && <div className="toast" role="status"><Check size={17} />{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={15} /></button></div>}

          {view === 'overview' && <Overview
            data={data}
            sessions={sessions}
            selectedSession={selectedSession}
            onSelectSession={setSelectedSessionId}
            onViewAttendance={() => setView('attendance')}
            onViewSessions={() => setView('sessions')}
            onViewReports={() => setView('reports')}
            onSetStatus={updateAttendance}
          />}
          {view === 'sessions' && <SessionsView
            sessions={sessions}
            selectedSessionId={selectedSession?.id}
            onSelect={(session) => { setSelectedSessionId(session.id); setView('attendance') }}
            onCreate={() => { setSessionError(''); setShowCreateSession(true) }}
            onToggle={toggleSession}
            onExport={exportSessionCsv}
          />}
          {view === 'attendance' && <AttendanceView
            sessions={sessions}
            selectedSession={selectedSession}
            roster={filteredRoster}
            students={activeStudents}
            counts={currentCounts}
            search={search}
            statusFilter={statusFilter}
            onSelectSession={setSelectedSessionId}
            onSearch={setSearch}
            onFilter={setStatusFilter}
            onSetStatus={updateAttendance}
            onAddStudent={addStudentToSession}
            onToggleSession={toggleSession}
            onExport={exportSessionCsv}
            onSyncPartner={syncPartnerRoster}
            partnerSyncing={partnerSyncing}
          />}
          {view === 'students' && <StudentsView
            students={students}
            search={search}
            studentFilter={studentFilter}
            onSearch={setSearch}
            onFilter={setStudentFilter}
            onAdd={() => { setStudentError(''); setStudentEditor({}) }}
            onEdit={(student) => { setStudentError(''); setStudentEditor(student) }}
            onArchive={archiveStudent}
          />}
          {view === 'reports' && <ReportsView
            sessions={sessions}
            reportSessionId={reportSessionId}
            onSelect={setReportSessionId}
            onExport={exportAllCsv}
            onExportSession={exportSessionCsv}
            onOpenSession={(sessionId) => { setSelectedSessionId(sessionId); setView('attendance') }}
          />}
          {view === 'settings' && <SettingsView
            data={data}
            error={backupError}
            importInput={importInput}
            onExport={exportBackup}
            onImport={importBackup}
            user={account}
            inviteCode={inviteCode}
            inviteError={inviteError}
            inviteCopied={inviteCopied}
            onCreateInvite={createInvite}
            onCopyInvite={copyInvite}
          />}
        </div>
      </main>

      {showCreateSession && <Modal title="Create class session" eyebrow="Session setup" onClose={() => setShowCreateSession(false)}>
        <p className="modal-description">The session gets its own roster from your active student directory</p>
        <form onSubmit={createSession}>
          <div className="form-grid"><label>Course code<input name="courseCode" required maxLength="20" placeholder="e.g. CS204" /></label><label>Section <span className="optional-label">optional</span><input name="sectionNumber" maxLength="40" placeholder="e.g. SEC01" /></label></div>
          <label>Room<input name="room" required maxLength="60" placeholder="e.g. Studio 3B" /></label>
          <label>Course name<input name="courseName" required maxLength="100" placeholder="e.g. Human-Computer Interaction" /></label>
          <div className="form-grid"><label>Date<input name="date" type="date" required defaultValue={localDate()} /></label><label>Students<select name="studentIds" multiple required size={4} defaultValue={activeStudents.map((student) => student.id)}>{activeStudents.map((student) => <option key={student.id} value={student.id}>{student.code} · {student.name}</option>)}</select><small className="field-hint">Use Ctrl/Command to select more than one student</small></label></div>
          <div className="form-grid"><label>Starts<input name="startTime" type="time" required defaultValue="14:00" /></label><label>Ends<input name="endTime" type="time" required defaultValue="15:30" /></label></div>
          <label className="check-label"><input name="openNow" type="checkbox" /> Open this session for attendance now</label>
          {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
          <button className="primary-button modal-submit" type="submit"><Plus size={16} /> Create session</button>
        </form>
      </Modal>}

      {studentEditor && <Modal title={studentEditor.id ? 'Edit student' : 'Add student'} eyebrow="Student directory" onClose={() => setStudentEditor(null)}>
        <p className="modal-description">This directory is managed here and is not synced to Enrollment</p>
        <form onSubmit={saveStudent}>
          <label>Student ID<input name="code" required maxLength="40" defaultValue={studentEditor.code || ''} placeholder="e.g. 65010042" /></label>
          <label>Full name<input name="name" required maxLength="100" defaultValue={studentEditor.name || ''} placeholder="Student name" /></label>
          <label>Email <span className="optional-label">optional</span><input name="email" type="email" maxLength="160" defaultValue={studentEditor.email || ''} placeholder="student@university.ac.th" /></label>
          {studentError && <p className="form-error" role="alert">{studentError}</p>}
          <button className="primary-button modal-submit" type="submit"><Check size={16} /> Save student</button>
        </form>
      </Modal>}
    </div>
  )
}

function StudentPortal({ account, schedule, error, onSignOut, onRefresh, onCheckIn }) {
  const [busySessionId, setBusySessionId] = useState('')
  const [formError, setFormError] = useState('')
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const studentNow = bangkokDateTime(new Date(clock))
  const today = studentNow.date
  const todaySessions = schedule.sessions
    .filter((session) => session.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const otherSessions = schedule.sessions
    .filter((session) => session.date !== today)
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  const dateLabel = new Intl.DateTimeFormat('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(clock))

  function checkInIsOpen(session) {
    return session.status !== 'closed' && session.date === today
      && studentNow.time >= session.startTime && studentNow.time < session.endTime
  }

  async function submitCheckIn(session) {
    setFormError('')
    setBusySessionId(session.id)
    try {
      const location = await getCurrentLocation()
      await onCheckIn(session.id, location)
    } catch (checkInError) {
      setFormError(checkInError.message)
    } finally {
      setBusySessionId('')
    }
  }

  return <div className="portal-shell student-portal">
    <header className="portal-topbar">
      <a className="brand portal-brand" href="/student"><span className="brand-mark"><Check size={17} strokeWidth={3} /></span><span>Attendance<span>Flow</span></span></a>
      <div className="portal-user"><span>{account.name}</span><button className="outline-button" onClick={onSignOut}>ออกจากระบบ</button></div>
    </header>
    <main className="portal-content">
      <section className="portal-welcome">
        <div><p className="eyebrow">{dateLabel}</p><h1>สวัสดี, {schedule.student.name}</h1><p>รหัสนักศึกษา {schedule.student.code} · ตรวจสอบตารางเรียนและเช็กชื่อของคุณ</p></div>
        <button className="outline-button" onClick={onRefresh}><Navigation size={15} /> รีเฟรชตาราง</button>
      </section>
      {(error || formError) && <div className="portal-alert" role="alert">{formError || error}</div>}
      <section className="portal-notice"><Bell size={18} /><div><strong>{todaySessions.length ? `วันนี้มีเรียน ${todaySessions.length} วิชา` : 'วันนี้ไม่มีตารางเรียน'}</strong><span>{todaySessions.length ? 'เช็กชื่อได้ในช่วงเวลาเรียนของแต่ละวิชา โดยต้องอนุญาตตำแหน่งที่ตั้ง' : 'ตรวจสอบกำหนดการเรียนครั้งถัดไปได้ด้านล่าง'}</span></div></section>
      <section className="portal-section">
        <div className="portal-section-heading"><div><p className="eyebrow">TODAY</p><h2>วิชาที่เรียนวันนี้</h2></div><span className="subtle-label">{todaySessions.length} วิชา</span></div>
        {todaySessions.length ? <div className="portal-class-grid">{todaySessions.map((session) => {
          const record = session.roster[0]
          const open = checkInIsOpen(session) && record?.status !== 'present' && record?.status !== 'late'
          return <article className="portal-class-card" key={session.id}>
            <div className="portal-class-top"><span className="course-code">{session.courseCode}</span><StatusBadge status={record?.status === 'present' || record?.status === 'late' ? 'present' : open ? 'open' : session.status === 'closed' ? 'absent' : 'upcoming'} label={record?.status === 'present' || record?.status === 'late' ? 'เช็กชื่อแล้ว' : open ? 'เปิดเช็กชื่อ' : session.status === 'closed' ? 'ปิดเช็กชื่อ' : 'ยังไม่ถึงเวลา'} /></div>
            <h3>{session.courseName}</h3>
            <p className="portal-class-meta"><Clock3 size={15} /> {session.startTime}–{session.endTime}</p>
            <p className="portal-class-meta"><MapPin size={15} /> {session.room}</p>
            {record?.status === 'present' || record?.status === 'late'
              ? <div className="checkin-success"><Check size={16} /> เช็กชื่อแล้วเวลา {record.markedAt || '—'}</div>
              : open ? <div className="student-checkin">
                <button className="primary-button" disabled={busySessionId === session.id} onClick={() => submitCheckIn(session)}><MapPin size={15} />{busySessionId === session.id ? 'กำลังบันทึก...' : 'เช็กชื่อ'}</button>
                <small>ระบบจะบันทึกเวลาจากเซิร์ฟเวอร์และตำแหน่งเมื่อคุณกดยืนยัน</small>
              </div> : <div className="checkin-locked"><Clock3 size={15} /> เปิดเช็กชื่อ {session.startTime}–{session.endTime} เท่านั้น</div>}
          </article>
        })}</div> : <div className="portal-empty"><CalendarDays size={23} /><strong>ไม่มีเรียนในวันนี้</strong><span>วิชาและวันเรียนครั้งถัดไปจะแสดงที่นี่</span></div>}
      </section>
      <section className="portal-section">
        <div className="portal-section-heading"><div><p className="eyebrow">UP NEXT</p><h2>วิชาอื่นในภาคเรียนนี้</h2></div><span className="subtle-label">{otherSessions.length} คลาส</span></div>
        {otherSessions.length ? <div className="portal-schedule-list">{otherSessions.map((session) => <div className="portal-schedule-row" key={session.id}>
          <div className="schedule-date"><strong>{formatBangkokDate(session.date, { day: 'numeric' })}</strong><span>{formatBangkokDate(session.date, { month: 'short' })}</span></div>
          <div className="schedule-info"><strong>{session.courseCode} · {session.courseName}</strong><span>{session.startTime}–{session.endTime} · {session.room}</span></div>
          <span className="date-label">{formatBangkokDate(session.date, { weekday: 'short' })}</span>
        </div>)}</div> : <div className="portal-empty compact-empty"><span>ยังไม่มีคลาสที่กำหนดไว้เพิ่มเติม</span></div>}
      </section>
      <p className="privacy-note"><ShieldCheck size={15} /> ระบบจะบันทึกเวลาและตำแหน่งเช็กชื่อเพื่อให้อาจารย์ตรวจสอบ</p>
    </main>
  </div>
}

function ProfessorPortal({
  account,
  sessions,
  students,
  onSignOut,
  onCreateSession,
  onToggleSession,
  onInviteStudent,
  onSyncPartner,
  partnerSyncing,
  inviteError,
  storageError,
  showCreateSession,
  sessionError,
  onSubmitSession,
  onCloseCreateSession,
}) {
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [detailRecord, setDetailRecord] = useState(null)
  const [invite, setInvite] = useState(null)
  const [inviteBusyId, setInviteBusyId] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || sessions[0]
  const sortedSessions = [...sessions].sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
  const checkInCount = selectedSession?.roster.filter((record) => record.status === 'present' || record.status === 'late').length || 0

  async function createInviteFor(record) {
    setInviteBusyId(record.studentId)
    setInvite(null)
    setCopyMessage('')
    const result = await onInviteStudent(selectedSession.id, record.studentId)
    if (result) setInvite({ ...result, studentName: record.studentName })
    setInviteBusyId('')
  }

  async function copyStudentLink() {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/student?invite=${encodeURIComponent(invite.code)}`)
      setCopyMessage('คัดลอกลิงก์คำเชิญแล้ว')
    } catch (error) {
      setCopyMessage(`คัดลอกลิงก์ไม่สำเร็จ: ${error.message}`)
    }
  }

  return <div className="portal-shell professor-portal">
    <header className="portal-topbar">
      <a className="brand portal-brand" href="/professor"><span className="brand-mark"><Check size={17} strokeWidth={3} /></span><span>Attendance<span>Flow</span></span></a>
      <div className="portal-user"><span>{account.name} · อาจารย์</span><a className="text-button" href="/Admin">หน้า Admin</a><button className="outline-button" onClick={onSignOut}>ออกจากระบบ</button></div>
    </header>
    <main className="portal-content">
      <section className="portal-welcome">
        <div><p className="eyebrow">PROFESSOR WORKSPACE</p><h1>จัดการชั้นเรียน</h1><p>สร้างคลาส เชิญนักศึกษา และตรวจสอบหลักฐานการเข้าเรียน</p></div>
        <button className="primary-button" onClick={onCreateSession}><Plus size={16} /> สร้างชั้นเรียน</button>
      </section>
      {(storageError || inviteError) && <div className="portal-alert" role="alert">{storageError || inviteError}</div>}
      <section className="professor-stats">
        <div><CalendarDays size={18} /><span>ชั้นเรียนทั้งหมด</span><strong>{sessions.length}</strong></div>
        <div><Users size={18} /><span>นักศึกษาในคลาสที่เลือก</span><strong>{selectedSession?.roster.length || 0}</strong></div>
        <div><Check size={18} /><span>เช็กชื่อแล้ว</span><strong>{checkInCount}</strong></div>
      </section>
      <section className="portal-section professor-session-section">
        <div className="portal-section-heading"><div><p className="eyebrow">CLASS SCHEDULE</p><h2>ชั้นเรียนของคุณ</h2></div><label className="filter-field"><span>เลือกคลาส</span><select value={selectedSession?.id || ''} onChange={(event) => setSelectedSessionId(event.target.value)}><option value="" disabled>เลือกคลาส</option>{sortedSessions.map((session) => <option key={session.id} value={session.id}>{session.courseCode} · {session.date} · {session.startTime}</option>)}</select></label></div>
        {selectedSession ? <>
          <div className="professor-class-summary"><div className="session-art coral-art"><BookOpen size={22} /></div><div><span className="course-code">{selectedSession.courseCode}{selectedSession.sectionNumber ? ` · ${selectedSession.sectionNumber}` : ''} · {selectedSession.date}</span><h3>{selectedSession.courseName}</h3><span><Clock3 size={14} /> {selectedSession.startTime}–{selectedSession.endTime} · {selectedSession.room}</span></div><StatusBadge status={selectedSession.status === 'open' ? 'open' : selectedSession.status === 'closed' ? 'absent' : 'upcoming'} label={selectedSession.status === 'open' ? 'กำลังเรียน' : selectedSession.status === 'closed' ? 'ปิดคลาส' : 'กำหนดการ'} /><button className="outline-button" disabled={partnerSyncing} onClick={() => onSyncPartner(selectedSession)}>{partnerSyncing ? 'กำลังซิงก์...' : 'ซิงก์รายชื่อ UniEnroll'}</button><button className="outline-button" onClick={() => onToggleSession(selectedSession)}>{selectedSession.status === 'open' ? 'ปิดคลาส' : selectedSession.status === 'closed' ? 'เปิดคลาสอีกครั้ง' : 'เปิดคลาส'}</button></div>
          <div className="professor-roster">
            <div className="professor-roster-head"><span>นักศึกษา</span><span>เวลาเช็กชื่อ</span><span>สถานะ</span><span>รายละเอียด</span></div>
            {selectedSession.roster.map((record) => <div className="professor-roster-row" key={record.studentId}>
              <div className="student-cell"><div className={`student-avatar avatar-${initials(record.studentName).charAt(0).toLowerCase()}`}>{initials(record.studentName)}</div><div><strong>{record.studentName}</strong><small>{record.studentCode}</small></div></div>
              <span className="time-cell">{record.markedAt || '—'}</span>
              <StatusBadge status={record.status} label={record.status === 'present' ? 'เข้าเรียน' : record.status === 'late' ? 'มาสาย' : record.status === 'absent' ? 'ขาดเรียน' : record.status === 'excused' ? 'ลา' : 'ยังไม่เช็กชื่อ'} />
              <div className="professor-row-actions"><button className="outline-button" onClick={() => setDetailRecord(record)}>เช็ครายละเอียด</button><button className="text-button" disabled={inviteBusyId === record.studentId} onClick={() => createInviteFor(record)}><UserPlus size={14} />{inviteBusyId === record.studentId ? 'กำลังสร้าง...' : 'เชิญนักศึกษา'}</button></div>
            </div>)}
            {!selectedSession.roster.length && <div className="portal-empty compact-empty"><span>ยังไม่มีนักศึกษาในชั้นเรียนนี้</span></div>}
          </div>
          {invite && <div className="invite-result"><div><strong>คำเชิญสำหรับ {invite.studentName}</strong><span>ลิงก์นี้ใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง</span><code>{window.location.origin}/student?invite={invite.code}</code></div><button className="outline-button" onClick={copyStudentLink}><Copy size={14} /> คัดลอกลิงก์</button>{copyMessage && <small>{copyMessage}</small>}</div>}
        </> : <div className="portal-empty"><CalendarDays size={23} /><strong>ยังไม่มีชั้นเรียน</strong><span>สร้างชั้นเรียนแรกเพื่อกำหนดวัน เวลา และเชิญนักศึกษา</span><button className="primary-button" onClick={onCreateSession}><Plus size={15} /> สร้างชั้นเรียน</button></div>}
      </section>
      <section className="portal-section">
        <div className="portal-section-heading"><div><p className="eyebrow">ALL CLASSES</p><h2>ตารางคลาสทั้งหมด</h2></div><span className="subtle-label">{sessions.length} คลาส</span></div>
        <div className="portal-schedule-list">{sortedSessions.map((session) => <button className={`portal-schedule-row session-picker ${selectedSession?.id === session.id ? 'selected' : ''}`} key={session.id} onClick={() => setSelectedSessionId(session.id)}>
          <div className="schedule-date"><strong>{formatBangkokDate(session.date, { day: 'numeric' })}</strong><span>{formatBangkokDate(session.date, { month: 'short' })}</span></div>
          <div className="schedule-info"><strong>{session.courseCode}{session.sectionNumber ? ` · ${session.sectionNumber}` : ''} · {session.courseName}</strong><span>{session.startTime}–{session.endTime} · {session.room} · {session.roster.length} คน</span></div>
          <ChevronRight size={16} />
        </button>)}</div>
      </section>
    </main>
    {detailRecord && <Modal eyebrow="ATTENDANCE EVIDENCE" title={detailRecord.studentName} onClose={() => setDetailRecord(null)}>
      <div className="attendance-detail">
        <p className="muted">{detailRecord.studentCode} · {selectedSession?.courseCode}</p>
        <div className="detail-fact"><Clock3 size={16} /><span>เวลาเช็กชื่อ</span><strong>{detailRecord.checkInAt ? new Date(detailRecord.checkInAt).toLocaleString('th-TH') : detailRecord.markedAt || 'ยังไม่มีข้อมูล'}</strong></div>
        <div className="detail-fact"><MapPin size={16} /><span>ตำแหน่ง</span><strong>{detailRecord.checkInLocation ? `${detailRecord.checkInLocation.latitude.toFixed(5)}, ${detailRecord.checkInLocation.longitude.toFixed(5)} (±${Math.round(detailRecord.checkInLocation.accuracy)} ม.)` : 'ยังไม่มีข้อมูลตำแหน่ง'}</strong></div>
        {detailRecord.checkInLocation && <a className="text-button map-link" href={`https://www.google.com/maps?q=${detailRecord.checkInLocation.latitude},${detailRecord.checkInLocation.longitude}`} target="_blank" rel="noreferrer"><Navigation size={14} /> เปิดแผนที่</a>}
      </div>
    </Modal>}
    {showCreateSession && <Modal title="สร้างชั้นเรียน" eyebrow="CLASS SETUP" onClose={onCloseCreateSession}>
      <p className="modal-description">กำหนดวัน เวลา สถานที่ และเลือกนักศึกษาที่เชิญเข้าเรียน</p>
      <form onSubmit={(event) => {
        const createdSessionId = onSubmitSession(event)
        if (createdSessionId) setSelectedSessionId(createdSessionId)
      }}>
        <div className="form-grid"><label>รหัสวิชา<input name="courseCode" required maxLength="20" placeholder="เช่น CS204" /></label><label>Section <span className="optional-label">ไม่บังคับ</span><input name="sectionNumber" maxLength="40" placeholder="เช่น SEC01" /></label></div>
        <label>ห้องเรียน<input name="room" required maxLength="60" placeholder="เช่น อาคาร A ห้อง 301" /></label>
        <label>ชื่อวิชา<input name="courseName" required maxLength="100" placeholder="ชื่อวิชา" /></label>
        <div className="form-grid"><label>วันที่เรียน<input name="date" type="date" required defaultValue={localDate()} /></label><label>นักศึกษาเข้าเรียน<select name="studentIds" multiple required size={4} defaultValue={students.map((student) => student.id)}>{students.map((student) => <option key={student.id} value={student.id}>{student.code} · {student.name}</option>)}</select><small className="field-hint">กด Ctrl/Command เพื่อเลือกนักศึกษาหลายคน</small></label></div>
        <div className="form-grid"><label>เวลาเริ่ม<input name="startTime" type="time" required defaultValue="09:00" /></label><label>เวลาสิ้นสุด<input name="endTime" type="time" required defaultValue="10:30" /></label></div>
        {sessionError && <p className="form-error" role="alert">{sessionError}</p>}
        <button className="primary-button modal-submit" type="submit"><Plus size={15} /> บันทึกชั้นเรียน</button>
      </form>
    </Modal>}
  </div>
}

function AuthScreen({ mode, initialized, error, busy, inviteCode = '', onSubmit, onModeChange }) {
  const isSetup = mode === 'setup'
  const isJoin = mode === 'join'
  const title = isSetup ? 'Create your workspace' : isJoin ? 'Join your team' : 'Welcome back'
  const description = isSetup
    ? 'Set up the first administrator account for your independent Attendance workspace'
    : isJoin
      ? 'Use the invite code from your workspace administrator to create your account'
      : 'Sign in to access your team’s shared attendance records'

  return <main className="login-page">
    <section className="login-art"><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
      <div className="brand"><span className="brand-mark"><Check size={17} strokeWidth={3} /></span><span>Attendance<span>Flow</span></span></div>
      <div className="login-art-copy">
      <p className="eyebrow">Independent attendance</p><h1>Every class<br />accounted for</h1>      <p>Manage attendance in a secure shared workspace with optional UniEnroll roster and webhook integration</p>
    </div></section>
    <section className="login-panel"><div className="login-form-wrap">
      <div className="mobile-brand"><span className="brand-mark"><Check size={17} strokeWidth={3} /></span><strong>Attendance<span>Flow</span></strong></div>
      <p className="eyebrow">{isSetup ? 'First-time setup' : isJoin ? 'Team invitation' : 'Secure workspace'}</p><h2>{title}</h2><p className="login-muted">{description}</p>
      <form onSubmit={onSubmit}>
        {isSetup && <label>One-time setup code<input name="setupCode" required autoComplete="one-time-code" maxLength="128" /></label>}
        {isJoin && <label>Invitation code<input name="inviteCode" required autoComplete="one-time-code" maxLength="128" defaultValue={inviteCode} /></label>}
        {(isSetup || isJoin) && <label>Your name<input name="name" required autoComplete="name" maxLength="160" /></label>}
        <label>{isSetup || isJoin ? 'Email address' : 'Email address or account ID'}<input name="email" type={isSetup || isJoin ? 'email' : 'text'} required autoComplete={isSetup || isJoin ? 'email' : 'username'} maxLength="160" /></label>
        <label>Password<input name="password" type="password" required autoComplete={isJoin || isSetup ? 'new-password' : 'current-password'} minLength={isSetup || isJoin ? 12 : undefined} maxLength="128" /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button login-button" type="submit" disabled={busy}>{busy ? 'Please wait...' : isSetup ? 'Create workspace' : isJoin ? 'Join workspace' : 'Sign in'}</button>
      </form>
      {!isSetup && <button className="demo-button" type="button" onClick={() => onModeChange(isJoin ? 'login' : initialized ? 'join' : 'setup')}>
        {isJoin ? 'Back to sign in' : initialized ? 'Have a team invite? Join workspace' : 'First time here? Set up workspace'}
      </button>}
      {isSetup && <button className="demo-button" type="button" onClick={() => onModeChange('login')}>Back to sign in</button>}
      <p className="login-footnote">Private shared data · No connection to Enrollment</p>
    </div></section>
  </main>
}

function NavButton({ icon, active = false, onClick, children }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}{children}</button>
}

function Overview({ data, sessions, selectedSession, onSelectSession, onViewAttendance, onViewSessions, onViewReports, onSetStatus }) {
  const today = localDate()
  const openSession = sessions.find((session) => session.status === 'open') || selectedSession
  const counts = sessionCounts(openSession)
  const total = openSession?.roster.length || 0
  const rate = total ? Math.round(((counts.present + counts.late) / total) * 100) : 0
  const nextSessions = sessions.filter((session) => session.status !== 'closed' && session.id !== openSession?.id).slice(0, 3)

  return <>
    <section className="stat-grid">
      <StatCard label="Present" value={counts.present} detail={openSession?.courseCode || 'No session selected'} icon={<Check size={19} />} tone="sage" />
      <StatCard label="Late" value={counts.late} detail="Marked late for this session" icon={<Clock3 size={19} />} tone="amber" />
      <StatCard label="Absent" value={counts.absent} detail={`${counts.unmarked} not yet marked`} icon={<ArrowDownRight size={19} />} tone="coral" />
      <StatCard label="Attendance rate" value={`${rate}%`} detail={`${total} students in session`} icon={<BarChart3 size={19} />} tone="blue" />
    </section>
    <section className="content-grid">
      <div className="panel active-session-panel">
        <div className="panel-heading"><div><p className="eyebrow">{openSession?.status === 'open' ? 'Taking attendance' : 'Session overview'}</p><h2>{openSession?.status === 'open' ? 'Active session' : 'Select a session'}</h2></div>{openSession && <StatusBadge status={openSession.status} />}</div>
        {openSession ? <div className="active-card">
          <div className="session-art coral-art"><BookOpen size={24} /></div>
          <div className="active-info"><span className="course-code">{openSession.courseCode} <span className="dot-separator">·</span> {formatDate(openSession.date)}</span><h3>{openSession.courseName}</h3><p><Clock3 size={14} /> {openSession.startTime}–{openSession.endTime} <span>·</span> {openSession.room}</p><div className="progress-line"><span style={{ width: `${rate}%` }} /></div><small>{counts.present + counts.late} of {total} students present or late</small></div>
          <button className="primary-button" onClick={() => { onSelectSession(openSession.id); onViewAttendance() }}>{openSession.status === 'closed' ? 'View roster' : 'Take attendance'} <ArrowUpRight size={15} /></button>
        </div> : <div className="empty-state"><CalendarDays size={22} /><strong>No sessions yet</strong><span>Create your first class session to begin</span><button className="text-button" onClick={onViewSessions}>Go to sessions <ArrowUpRight size={14} /></button></div>}
        <div className="panel-footer"><span>Records sync to your shared workspace</span><button className="text-button" onClick={onViewReports}>See history <ChevronRight size={14} /></button></div>
      </div>
      <div className="panel pulse-panel">
        <div className="panel-heading"><div><p className="eyebrow">Session summary</p><h2>Attendance pulse</h2></div><span className="subtle-label">{today === openSession?.date ? 'Today' : formatDate(openSession?.date)}</span></div>
        <div className="pulse-total"><strong>{rate}%</strong><span>present or late</span></div>
        <div className="distribution-bars">
          <Distribution label="Present" value={counts.present} total={total} tone="sage" />
          <Distribution label="Late" value={counts.late} total={total} tone="amber" />
          <Distribution label="Absent" value={counts.absent} total={total} tone="coral" />
          <Distribution label="Not marked" value={counts.unmarked} total={total} tone="gray" />
        </div>
        <div className="pulse-note"><span className="trend-icon"><ShieldCheck size={14} /></span><span>Based on {total} students assigned to this session</span></div>
      </div>
    </section>
    {openSession && <section className="panel roster-preview">
      <div className="panel-heading"><div><p className="eyebrow">{openSession.courseCode} · {formatDate(openSession.date)}</p><h2>Recent attendance</h2></div><button className="text-button" onClick={() => { onSelectSession(openSession.id); onViewAttendance() }}>Manage roster <ArrowUpRight size={14} /></button></div>
      <RosterTable students={openSession.roster.slice(0, 5)} onSetStatus={onSetStatus} disabled={openSession.status === 'closed'} compact />
    </section>}
    <section className="panel upcoming-panel">
      <div className="panel-heading"><div><p className="eyebrow">On your timetable</p><h2>Other sessions</h2></div><button className="text-button" onClick={onViewSessions}>All sessions <ArrowUpRight size={14} /></button></div>
      <div className="session-list">{nextSessions.length ? nextSessions.map((session) => <SessionRow key={session.id} session={session} onSelect={() => { onSelectSession(session.id); onViewAttendance() }} />) : <div className="empty-state"><span>No upcoming sessions</span></div>}</div>
    </section>
    {data.activity?.length > 0 && <ActivityPanel activity={data.activity.slice(0, 4)} />}
  </>
}

function SessionsView({ sessions, selectedSessionId, onSelect, onCreate, onToggle, onExport }) {
  const [filter, setFilter] = useState('all')
  const filtered = sessions.filter((session) => filter === 'all' || session.status === filter)
  return <section className="panel session-manager">
    <div className="panel-heading"><div><p className="eyebrow">Your timetable</p><h2>All class sessions</h2><p className="panel-subtitle">Each session keeps its own roster and attendance history</p></div><button className="primary-button" onClick={onCreate}><Plus size={17} /> New session</button></div>
    <div className="list-toolbar"><label>Status<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All sessions ({sessions.length})</option><option value="open">Open</option><option value="scheduled">Scheduled</option><option value="closed">Closed</option></select></label></div>
    <div className="session-list">{filtered.map((session) => <SessionRow key={session.id} session={session} detailed selected={session.id === selectedSessionId} onSelect={() => onSelect(session)} onToggle={() => onToggle(session)} onExport={() => onExport(session)} />)}</div>
    {!filtered.length && <div className="empty-state"><CalendarDays size={23} /><strong>No sessions in this filter</strong><span>Create a session or change the filter</span></div>}
  </section>
}

function AttendanceView({ sessions, selectedSession, roster, students, counts, search, statusFilter, onSelectSession, onSearch, onFilter, onSetStatus, onAddStudent, onToggleSession, onExport, onSyncPartner, partnerSyncing }) {
  const [addId, setAddId] = useState('')
  const [integrationStatus, setIntegrationStatus] = useState(null)
  const [integrationError, setIntegrationError] = useState('')
  const [retryingEvent, setRetryingEvent] = useState('')
  useEffect(() => {
    let active = true
    const refreshStatus = () => {
      getPartnerIntegrationStatus()
        .then((status) => {
          if (active) {
            setIntegrationStatus(status)
            setIntegrationError('')
          }
        })
        .catch((error) => { if (active) setIntegrationError(error.message) })
    }
    refreshStatus()
    const interval = window.setInterval(refreshStatus, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])
  async function retryEvent(event) {
    setRetryingEvent(event.event_id)
    setIntegrationError('')
    try {
      await retryPartnerReconciliation(event.event_id, event.source)
      setIntegrationStatus(await getPartnerIntegrationStatus())
    } catch (error) {
      setIntegrationError(error.message)
    } finally {
      setRetryingEvent('')
    }
  }
  if (!selectedSession) return <div className="panel empty-state"><CalendarDays size={25} /><strong>No class sessions yet</strong><span>Create a session before recording attendance</span></div>
  const availableStudents = students.filter((student) => !selectedSession.roster.some((record) => record.studentId === student.id))
  const presentTotal = counts.present + counts.late
  return <section className="panel attendance-panel">
    <div className="panel-heading attendance-heading">
      <div><p className="eyebrow">Attendance roster</p><h2>{selectedSession.courseName}</h2><p className="panel-subtitle">{selectedSession.courseCode} <span>·</span> {formatDate(selectedSession.date)} <span>·</span> {selectedSession.startTime}–{selectedSession.endTime} <span>·</span> {selectedSession.room}</p></div>
      <div className="session-heading-actions"><StatusBadge status={selectedSession.status} /><button className="outline-button" onClick={() => onSyncPartner(selectedSession)} disabled={partnerSyncing}>{partnerSyncing ? 'Syncing…' : 'Sync enrollment'}</button><button className="outline-button" onClick={() => onExport(selectedSession)}><Download size={14} /> Export CSV</button><button className="primary-button" onClick={() => onToggleSession(selectedSession)}>{selectedSession.status === 'closed' ? 'Reopen session' : 'Close session'}</button></div>
    </div>
    <label className="session-select-field">Session<select value={selectedSession.id} onChange={(event) => onSelectSession(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.courseCode} · {formatDate(session.date)} · {session.courseName}</option>)}</select></label>
    <section className="integration-status-panel">
      <div><strong>UniEnroll integration</strong><span>{integrationStatus?.configured ? 'Credentials configured' : 'Integration credentials are incomplete'}</span></div>
      {integrationStatus && <p>Attendance events: {integrationStatus.outbox?.pending || 0} pending, {integrationStatus.outbox?.delivered || 0} delivered, {integrationStatus.outbox?.failed || 0} failed · Enrollment events: {integrationStatus.inbox?.pending || 0} pending, {integrationStatus.inbox?.processed || 0} processed</p>}
      {integrationError && <p className="form-error" role="alert">{integrationError}</p>}
      {integrationStatus?.failedEvents?.map((event) => <div className="integration-failed-event" key={`${event.source}:${event.event_id}`}><span><strong>{event.event_type}</strong> · {event.last_error || 'Delivery failed'}</span><button className="outline-button" disabled={retryingEvent === event.event_id} onClick={() => retryEvent(event)}>{retryingEvent === event.event_id ? 'Retrying…' : 'Retry'}</button></div>)}
    </section>
    <div className="roster-summary"><span><strong>{presentTotal}</strong> present / late</span><span><strong>{counts.absent}</strong> absent</span><span><strong>{counts.excused}</strong> excused</span><span><strong>{counts.unmarked}</strong> not marked</span><span><strong>{selectedSession.roster.length}</strong> students</span></div>
    <div className="roster-toolbar">
      <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name or student ID" /></label>
      <label className="filter-field"><span>Status</span><select value={statusFilter} onChange={(event) => onFilter(event.target.value)}><option value="all">All statuses</option><option value="unmarked">Not marked</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="excused">Excused</option></select></label>
    </div>
    {availableStudents.length > 0 && selectedSession.status !== 'closed' && <form className="add-roster-form" onSubmit={(event) => { event.preventDefault(); if (addId) { onAddStudent(addId); setAddId('') } }}>
      <UserPlus size={16} /><select aria-label="Choose a student to add" value={addId} onChange={(event) => setAddId(event.target.value)}><option value="">Add a student from your directory</option>{availableStudents.map((student) => <option key={student.id} value={student.id}>{student.code} · {student.name}</option>)}</select><button className="outline-button" type="submit" disabled={!addId}><Plus size={14} /> Add to session</button>
    </form>}
    <RosterTable students={roster} onSetStatus={onSetStatus} disabled={selectedSession.status === 'closed'} />
    {!roster.length && <div className="empty-state"><Search size={22} /><strong>No students found</strong><span>Try a different search or status filter</span></div>}
    <div className="table-footnote"><ShieldCheck size={15} /><span>{selectedSession.status === 'closed' ? 'Closed sessions are read-only unless you reopen them' : 'Unmarked students are not automatically counted absent. Close the session to mark them absent'}</span></div>
  </section>
}

function StudentsView({ students, search, studentFilter, onSearch, onFilter, onAdd, onEdit, onArchive }) {
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = students.filter((student) => {
    const matchesText = !normalizedSearch || student.name.toLowerCase().includes(normalizedSearch) || student.code.toLowerCase().includes(normalizedSearch)
    const matchesState = studentFilter === 'all' || (studentFilter === 'active' ? student.active : !student.active)
    return matchesText && matchesState
  })
  return <section className="panel students-panel">
    <div className="panel-heading"><div><p className="eyebrow">Self-managed directory</p><h2>Students</h2><p className="panel-subtitle">New sessions copy active students into their own roster</p></div><button className="primary-button" onClick={onAdd}><UserPlus size={15} /> Add student</button></div>
    <div className="roster-toolbar student-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search name or student ID" /></label><label className="filter-field"><span>Show</span><select value={studentFilter} onChange={(event) => onFilter(event.target.value)}><option value="active">Active ({students.filter((student) => student.active).length})</option><option value="archived">Archived ({students.filter((student) => !student.active).length})</option><option value="all">Everyone ({students.length})</option></select></label></div>
    <div className="student-directory">
      <div className="directory-head"><span>Student</span><span>Student ID</span><span>Email</span><span>Status</span><span>Actions</span></div>
      {filtered.map((student) => <div className="directory-row" key={student.id}>
        <div className="student-cell"><div className={`student-avatar avatar-${initials(student.name).charAt(0).toLowerCase()}`}>{initials(student.name)}</div><strong>{student.name}</strong></div>
        <span className="directory-code">{student.code}</span><span className="directory-email">{student.email || '—'}</span><StatusBadge status={student.active ? 'present' : 'upcoming'} label={student.active ? 'Active' : 'Archived'} />
        <div className="directory-actions"><button className="icon-action" aria-label={`Edit ${student.name}`} onClick={() => onEdit(student)}><Pencil size={14} /></button>{student.active && <button className="icon-action archive-action" aria-label={`Archive ${student.name}`} onClick={() => onArchive(student)}><Archive size={14} /></button>}</div>
      </div>)}
      {!filtered.length && <div className="empty-state"><Users size={22} /><strong>No students found</strong><span>Add a student or change the filter</span></div>}
    </div>
    <div className="table-footnote"><ShieldCheck size={15} /><span>Archiving keeps a student's existing session history intact</span></div>
  </section>
}

function ReportsView({ sessions, reportSessionId, onSelect, onExport, onExportSession, onOpenSession }) {
  const sortedSessions = [...sessions].sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`))
  const visibleSessions = reportSessionId === 'all' ? sortedSessions : sortedSessions.filter((session) => session.id === reportSessionId)
  const totals = visibleSessions.reduce((total, session) => {
    const counts = sessionCounts(session)
    Object.keys(emptyCounts).forEach((key) => { total[key] += counts[key] })
    total.sessions += 1
    return total
  }, { ...emptyCounts, sessions: 0 })
  const decided = totals.present + totals.late + totals.absent + totals.excused
  const rate = decided ? Math.round(((totals.present + totals.late) / decided) * 100) : 0
  return <div className="reports-view">
    <section className="panel report-filter-panel"><div><p className="eyebrow">Attendance history</p><h2>Reports</h2></div><label className="filter-field"><span>Session</span><select value={reportSessionId} onChange={(event) => onSelect(event.target.value)}><option value="all">All sessions</option>{sortedSessions.map((session) => <option key={session.id} value={session.id}>{session.courseCode} · {formatDate(session.date)} · {session.courseName}</option>)}</select></label><button className="outline-button" onClick={reportSessionId === 'all' ? onExport : () => onExportSession(sessions.find((session) => session.id === reportSessionId))}><Download size={14} /> Export CSV</button></section>
    <section className="report-cards"><StatCard label="Attendance rate" value={`${rate}%`} detail="Present and late / decided records" icon={<BarChart3 size={19} />} tone="blue" /><StatCard label="Sessions" value={totals.sessions} detail="In selected history" icon={<CalendarDays size={19} />} tone="sage" /><StatCard label="Not marked" value={totals.unmarked} detail="Still open or not recorded" icon={<Clock3 size={19} />} tone="amber" /></section>
    <section className="panel report-breakdown"><div className="panel-heading"><div><p className="eyebrow">All selected sessions</p><h2>Status breakdown</h2></div><span className="subtle-label">{decided} marked records</span></div><div className="report-status-list"><Distribution label="Present" value={totals.present} total={decided} tone="sage" /><Distribution label="Late" value={totals.late} total={decided} tone="amber" /><Distribution label="Absent" value={totals.absent} total={decided} tone="coral" /><Distribution label="Excused" value={totals.excused} total={decided} tone="gray" /></div></section>
    <section className="panel report-history"><div className="panel-heading"><div><p className="eyebrow">By class session</p><h2>Session history</h2></div><span className="subtle-label">{visibleSessions.length} sessions</span></div>
      <div className="history-table"><div className="history-head"><span>Course / session</span><span>Date</span><span>Present</span><span>Late</span><span>Absent</span><span>Rate</span><span>Status</span><span>Actions</span></div>
        {visibleSessions.map((session) => {
          const counts = sessionCounts(session)
          const marked = counts.present + counts.late + counts.absent + counts.excused
          const sessionRate = marked ? Math.round(((counts.present + counts.late) / marked) * 100) : 0
          return <div className="history-row" key={session.id}><div><strong>{session.courseCode} · {session.courseName}</strong><small>{session.startTime}–{session.endTime} · {session.room}</small></div><span>{formatDate(session.date)}</span><strong>{counts.present}</strong><strong>{counts.late}</strong><strong>{counts.absent}</strong><strong>{marked ? `${sessionRate}%` : '—'}</strong><StatusBadge status={session.status} /><button className="icon-action" aria-label={`Open ${session.courseCode} attendance`} onClick={() => onOpenSession(session.id)}><ArrowUpRight size={15} /></button></div>
        })}
      </div>
      {!visibleSessions.length && <div className="empty-state"><FileText size={22} /><strong>No attendance history</strong><span>Session reports will appear here</span></div>}
    </section>
  </div>
}

function SettingsView({ data, error, importInput, onExport, onImport, user, inviteCode, inviteError, inviteCopied, onCreateInvite, onCopyInvite }) {
  return <div className="settings-view">
    <section className="panel data-card"><div className="data-card-icon"><ShieldCheck size={19} /></div><div><p className="eyebrow">Where your data lives</p><h2>Shared Cloudflare workspace</h2><p>Attendance records are stored in the dedicated AttendanceFlow database and shared with invited teammates. UniEnroll rosters and attendance events sync through the configured integration</p><div className="data-facts"><span><strong>{data.students.length}</strong> students</span><span><strong>{data.sessions.length}</strong> sessions</span><span><strong>{data.activity?.length || 0}</strong> activity events</span></div></div></section>
    {user.role === 'admin' && <section className="panel backup-panel"><div className="panel-heading"><div><p className="eyebrow">Team access</p><h2>Invite a teammate</h2><p className="panel-subtitle">Create a one-time invitation code for an instructor. It expires after 24 hours</p></div></div><div className="backup-actions"><button className="primary-button" onClick={onCreateInvite}><UserPlus size={15} /> Create invite code</button>{inviteCode && <button className="outline-button" onClick={onCopyInvite}><Copy size={15} /> {inviteCopied ? 'Copied' : 'Copy code'}</button>}</div>{inviteCode && <div className="invite-code" aria-label="One-time invitation code">{inviteCode}</div>}{inviteError && <p className="form-error" role="alert">{inviteError}</p>}</section>}
    <section className="panel backup-panel"><div className="panel-heading"><div><p className="eyebrow">Portability</p><h2>Backup and restore</h2><p className="panel-subtitle">Backups include the student directory, sessions, rosters and attendance records. Restoring replaces shared data for every teammate</p></div></div><div className="backup-actions"><button className="primary-button" onClick={onExport}><Download size={15} /> Download backup</button><button className="outline-button" onClick={() => importInput.current?.click()}><Upload size={15} /> Restore from backup</button><input ref={importInput} className="sr-only" type="file" accept="application/json,.json" onChange={onImport} /></div>{error && <p className="form-error" role="alert">{error}</p>}</section>
  </div>
}

function ActivityPanel({ activity }) {
  return <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent changes</h2></div></div><div className="activity-list">{activity.map((item) => <div className="activity-row" key={item.id}><span className="activity-dot" /><div><strong>{item.detail}</strong><small>{item.action.replaceAll('.', ' ')} · {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</small></div></div>)}</div></section>
}

function RosterTable({ students, onSetStatus, disabled = false, compact = false }) {
  return <div className={`roster-table ${compact ? 'compact' : ''}`}><div className="roster-head"><span>Student</span><span>Check-in time</span><span>Status</span><span className="sr-only">Update status</span></div>
    {students.map((record) => <div className="roster-row" key={record.studentId}><div className="student-cell"><div className={`student-avatar avatar-${initials(record.studentName).charAt(0).toLowerCase()}`}>{initials(record.studentName)}</div><div><strong>{record.studentName}</strong><small>{record.studentCode}</small></div></div><span className="time-cell">{record.markedAt || '—'}</span><StatusBadge status={record.status} /><label className="status-control"><span className="sr-only">Change status for {record.studentName}</span><select value={record.status} disabled={disabled} onChange={(event) => onSetStatus(record.studentId, event.target.value)}><option value="unmarked">Not marked</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="excused">Excused</option></select><ChevronDown size={13} /></label></div>)}
  </div>
}

function SessionRow({ session, detailed = false, selected = false, onSelect, onToggle, onExport }) {
  const counts = sessionCounts(session)
  const statusTone = session.status === 'open' ? 'present' : session.status === 'closed' ? 'absent' : 'upcoming'
  return <div className={`session-row ${selected ? 'selected-session-row' : ''}`}><div className={`session-art ${session.status === 'open' ? 'coral-art' : session.status === 'closed' ? 'blue-art' : 'sage-art'}`}><BookOpen size={20} /></div><button className="session-row-info session-row-link" onClick={onSelect}><div><span className="course-code">{session.courseCode}</span><span className="date-label">{formatDate(session.date)}</span></div><strong>{session.courseName}</strong><small><Clock3 size={13} />{session.startTime}–{session.endTime}<span>·</span>{session.room}</small></button><div className="session-row-meta"><StatusBadge status={statusTone} label={session.status} />{detailed && <span className="roster-count"><Users size={13} /> {session.roster.length} students · {counts.present + counts.late} present</span>}</div>{detailed && <div className="row-actions">{session.status === 'closed' ? <button className="outline-button" onClick={onToggle}>Reopen</button> : <button className="outline-button" onClick={onToggle}>{session.status === 'open' ? 'Close session' : 'Open session'}</button>}{session.status === 'closed' && <button className="icon-action" aria-label={`Export ${session.courseCode} attendance`} onClick={onExport}><Download size={14} /></button>}</div>}</div>
}

function StatCard({ label, value, detail, icon, tone }) {
  return <div className={`stat-card ${tone}`}><div className="stat-icon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>
}

function Distribution({ label, value, total, tone }) {
  const width = total ? `${Math.round(value / total * 100)}%` : '0%'
  return <div className="distribution-row"><div className="distribution-label"><span>{label}</span><strong>{value}</strong></div><div className="distribution-track"><span className={tone} style={{ width }} /></div></div>
}

function StatusBadge({ status, label }) {
  return <span className={`status-badge ${status}`}><i />{label || status}</span>
}

function Modal({ eyebrow, title, onClose, children }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button><p className="eyebrow">{eyebrow}</p><h2 id="modal-title">{title}</h2>{children}</section></div>
}

export default App
