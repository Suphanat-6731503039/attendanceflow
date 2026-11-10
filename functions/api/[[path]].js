import {
  applyEnrollmentRoster,
  fetchPartnerEnrollments,
  processInboxEvent,
  processOutboxEvent,
  receiveUniEnrollWebhook,
} from '../lib/partnerIntegration.js'

const SESSION_COOKIE = 'attendance_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
const PASSWORD_ITERATIONS = 100000
const MAX_BODY_BYTES = 2 * 1024 * 1024
const VALID_ATTENDANCE_STATUSES = new Set(['unmarked', 'present', 'late', 'absent', 'excused'])

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

function ok(data, status = 200, headers = {}) {
  return jsonResponse({ success: true, data }, status, headers)
}

function fail(code, message, status = 400, data) {
  const body = { success: false, error: { code, message } }
  if (data) body.data = data
  return jsonResponse(body, status)
}

function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

function randomToken(byteLength = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

async function hashText(value) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let difference = a.length ^ b.length
  const max = Math.max(a.length, b.length)
  for (let index = 0; index < max; index += 1) {
    difference |= (a[index % (a.length || 1)] || 0) ^ (b[index % (b.length || 1)] || 0)
  }
  return difference === 0
}

async function derivePasswordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: fromBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
  }, key, 256)
  return toBase64Url(new Uint8Array(bits))
}

function cookieHeaders(token, request, clear = false) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  const value = clear ? '' : token
  const age = clear ? 0 : SESSION_TTL_SECONDS
  return { 'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}` }
}

function readCookie(request, name) {
  const cookie = request.headers.get('Cookie') || ''
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0)
  if (contentLength > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
  if (!request.body) throw new Error('INVALID_JSON')
  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('REQUEST_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error('INVALID_JSON')
  }
}

function validEmail(value) {
  return typeof value === 'string'
    && value.length <= 160
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function validateAttendanceData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.students) || !Array.isArray(data.sessions)) return false
  if (data.students.length > 20000 || data.sessions.length > 10000) return false

  const studentIds = new Set()
  const studentCodes = new Set()
  for (const student of data.students) {
    if (!student || typeof student.id !== 'string' || !student.id.trim() || student.id.length > 100
      || typeof student.code !== 'string' || !student.code.trim() || student.code.length > 100
      || typeof student.name !== 'string' || !student.name.trim() || student.name.length > 160
      || typeof student.active !== 'boolean'
      || (student.email !== undefined && student.email !== '' && !validEmail(student.email))) return false
    const normalizedCode = student.code.trim().toLowerCase()
    if (studentIds.has(student.id) || studentCodes.has(normalizedCode)) return false
    studentIds.add(student.id)
    studentCodes.add(normalizedCode)
  }

  const sessionIds = new Set()
  for (const session of data.sessions) {
    const [year, month, day] = typeof session?.date === 'string' ? session.date.split('-').map(Number) : []
    const dateIsValid = Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
      && new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === session.date
    if (!session || typeof session.id !== 'string' || session.id.length > 120 || sessionIds.has(session.id)
      || typeof session.courseCode !== 'string' || !session.courseCode.trim() || session.courseCode.length > 30
      || typeof session.courseName !== 'string' || !session.courseName.trim() || session.courseName.length > 160
      || typeof session.room !== 'string' || session.room.length > 100
      || typeof session.date !== 'string' || !dateIsValid
      || typeof session.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.startTime)
      || typeof session.endTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.endTime)
      || session.endTime <= session.startTime
      || !['scheduled', 'open', 'closed'].includes(session.status)
      || !Array.isArray(session.roster) || session.roster.length > 20000) return false
    sessionIds.add(session.id)
    const rosterStudentIds = new Set()
    for (const record of session.roster) {
      if (!record || typeof record.studentId !== 'string' || !studentIds.has(record.studentId)
        || typeof record.studentCode !== 'string' || !record.studentCode.trim()
        || typeof record.studentName !== 'string' || !record.studentName.trim()
        || !VALID_ATTENDANCE_STATUSES.has(record.status)
        || (record.markedAt !== null && typeof record.markedAt !== 'string')) return false
      if (record.checkInLocation !== undefined
        && (!record.checkInLocation || !Number.isFinite(record.checkInLocation.latitude)
          || record.checkInLocation.latitude < -90 || record.checkInLocation.latitude > 90
          || !Number.isFinite(record.checkInLocation.longitude)
          || record.checkInLocation.longitude < -180 || record.checkInLocation.longitude > 180
          || !Number.isFinite(record.checkInLocation.accuracy)
          || record.checkInLocation.accuracy < 0 || record.checkInLocation.accuracy > 100000)) return false
      if (rosterStudentIds.has(record.studentId)) return false
      rosterStudentIds.add(record.studentId)
    }
  }

  if (data.activity !== undefined && (!Array.isArray(data.activity) || data.activity.length > 500
    || data.activity.some((event) => !event || typeof event.id !== 'string'
      || typeof event.action !== 'string' || typeof event.detail !== 'string'
      || typeof event.createdAt !== 'string'))) return false
  return true
}

async function createSession(db, accountId) {
  const token = randomToken()
  const tokenHash = await hashText(token)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expiresAt = nowSeconds + SESSION_TTL_SECONDS
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(nowSeconds).run()
  await db.prepare('INSERT INTO auth_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, accountId, expiresAt, new Date().toISOString()).run()
  return token
}

async function getAccount(request, db) {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token || token.length > 128) return null
  const tokenHash = await hashText(token)
  const result = await db.prepare(`
    SELECT accounts.id, accounts.email, accounts.full_name, accounts.role, accounts.student_id
    FROM auth_sessions
    JOIN accounts ON accounts.id = auth_sessions.account_id
    WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?
  `).bind(tokenHash, Math.floor(Date.now() / 1000)).first()
  return result || null
}

function publicAccount(account) {
  return {
    id: account.id,
    email: account.email,
    name: account.full_name,
    role: account.student_id ? 'student' : account.role,
    studentId: account.student_id || null,
  }
}

async function readWorkspace(db) {
  const row = await db.prepare('SELECT data_json, revision, updated_at FROM attendance_workspace WHERE id = ?')
    .bind('shared').first()
  if (!row) return null
  let data
  try {
    data = JSON.parse(row.data_json)
  } catch {
    throw new Error('WORKSPACE_DATA_CORRUPTED')
  }
  if (!validateAttendanceData(data)) throw new Error('WORKSPACE_DATA_INVALID')
  return { data, revision: row.revision, updatedAt: row.updated_at }
}

function emptyData() {
  return { version: 1, students: [], sessions: [], activity: [] }
}

async function recordLoginFailure(db, email, ipAddress) {
  const now = Math.floor(Date.now() / 1000)
  const emailKey = await hashText(`email:${email.toLowerCase()}`)
  const ipKey = await hashText(`ip:${ipAddress || 'unknown'}`)
  await db.batch([
    db.prepare('DELETE FROM auth_attempts WHERE attempted_at < ?').bind(now - 86400),
    db.prepare('INSERT INTO auth_attempts (attempt_key, attempted_at) VALUES (?, ?), (?, ?)')
      .bind(emailKey, now, ipKey, now),
  ])
}

async function isRateLimited(db, email, ipAddress) {
  const now = Math.floor(Date.now() / 1000)
  const emailKey = await hashText(`email:${email.toLowerCase()}`)
  const ipKey = await hashText(`ip:${ipAddress || 'unknown'}`)
  const result = await db.prepare(`
    SELECT COUNT(*) AS attempts FROM auth_attempts
    WHERE attempted_at > ? AND attempt_key IN (?, ?)
  `).bind(now - 900, emailKey, ipKey).first()
  return Number(result?.attempts || 0) >= 10
}

async function login(request, env) {
  const body = await readJson(request)
  const identifier = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const isAccountId = /^(?:stu|prof)-\d{4}-\d{3}$/.test(identifier)
  if ((!validEmail(identifier) && !isAccountId) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) {
    return fail('INVALID_CREDENTIALS', 'Enter a valid account ID or email and password', 400)
  }
  const email = isAccountId ? `${identifier}@attendanceflow.local` : identifier
  const ipAddress = request.headers.get('CF-Connecting-IP') || ''
  if (await isRateLimited(env.DB, email, ipAddress)) return fail('TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again in 15 minutes', 429)

  const account = await env.DB.prepare('SELECT id, email, full_name, password_salt, password_hash, role, student_id FROM accounts WHERE email = ?')
    .bind(email).first()
  const salt = account?.password_salt || toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const computedHash = await derivePasswordHash(body.password, salt)
  if (!account || !constantTimeEqual(computedHash, account.password_hash)) {
    await recordLoginFailure(env.DB, email, ipAddress)
    return fail('INVALID_CREDENTIALS', 'Email or password is incorrect', 401)
  }

  const sessionToken = await createSession(env.DB, account.id)
  const emailKey = await hashText(`email:${email}`)
  const ipKey = await hashText(`ip:${ipAddress || 'unknown'}`)
  await env.DB.prepare('DELETE FROM auth_attempts WHERE attempt_key IN (?, ?)').bind(emailKey, ipKey).run()
  return ok({ user: publicAccount(account) }, 200, cookieHeaders(sessionToken, request))
}

async function setupOwner(request, env) {
  const body = await readJson(request)
  if (typeof body.setupCode !== 'string' || body.setupCode.length < 24 || body.setupCode.length > 128 || !validEmail(body.email)
    || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160
    || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    return fail('INVALID_SETUP', 'Enter the setup code, a valid email, your name, and a password of at least 12 characters')
  }
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM accounts').first()
  if (Number(count?.count || 0) > 0) return fail('ALREADY_INITIALIZED', 'The workspace is already set up. Sign in or use a teammate invite', 409)

  const tokenHash = await hashText(body.setupCode)
  const tokenRow = await env.DB.prepare('SELECT token_hash FROM setup_tokens WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?')
    .bind(tokenHash, Math.floor(Date.now() / 1000)).first()
  if (!tokenRow || !constantTimeEqual(await hashText(body.setupCode), tokenRow.token_hash)) {
    return fail('INVALID_SETUP_CODE', 'The setup code is invalid or has expired', 401)
  }

  const email = body.email.trim().toLowerCase()
  const accountId = randomToken(16)
  const claimId = randomToken(16)
  const now = new Date().toISOString()
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const passwordHash = await derivePasswordHash(body.password, salt)
  const statements = await env.DB.batch([
    env.DB.prepare('UPDATE setup_tokens SET consumed_at = ?, claimed_by = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?')
      .bind(now, claimId, tokenHash, Math.floor(Date.now() / 1000)),
    env.DB.prepare(`
      INSERT INTO accounts (id, email, full_name, password_salt, password_hash, role, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, 'admin', ?, ?
      WHERE EXISTS (SELECT 1 FROM setup_tokens WHERE token_hash = ? AND claimed_by = ?)
        AND NOT EXISTS (SELECT 1 FROM accounts WHERE role = 'admin')
    `).bind(accountId, email, body.name.trim(), salt, passwordHash, now, now, tokenHash, claimId),
    env.DB.prepare(`
      INSERT INTO attendance_workspace (id, data_json, revision, updated_at, updated_by)
      SELECT 'shared', ?, 1, ?, ?
      WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ? AND role = 'admin')
    `).bind(JSON.stringify(emptyData()), now, accountId, accountId),
  ])
  if (Number(statements[1]?.meta?.changes || 0) !== 1 || Number(statements[2]?.meta?.changes || 0) !== 1) {
    return fail('SETUP_FAILED', 'The initial setup could not be completed. Refresh and try again', 409)
  }

  const sessionToken = await createSession(env.DB, accountId)
  return ok({ user: { id: accountId, email, name: body.name.trim(), role: 'admin', studentId: null } }, 201, cookieHeaders(sessionToken, request))
}

async function joinWorkspace(request, env) {
  const body = await readJson(request)
  if (typeof body.inviteCode !== 'string' || body.inviteCode.length < 24 || body.inviteCode.length > 128 || !validEmail(body.email)
    || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160
    || typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
    return fail('INVALID_REGISTRATION', 'Enter a valid invite code, email, name, and password of at least 12 characters')
  }
  const email = body.email.trim().toLowerCase()
  const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first()
  if (exists) return fail('ACCOUNT_EXISTS', 'An account already uses this email. Sign in instead', 409)
  const tokenHash = await hashText(body.inviteCode)
  const invitation = await env.DB.prepare('SELECT id, role, student_id, session_id FROM invitations WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .bind(tokenHash, Math.floor(Date.now() / 1000)).first()
  if (!invitation) return fail('INVALID_INVITE', 'This invite is invalid, expired, or already used', 401)
  if (invitation.role === 'student') {
    const workspace = await readWorkspace(env.DB)
    const student = workspace?.data.students.find((item) => item.id === invitation.student_id && item.active)
    const session = workspace?.data.sessions.find((item) => item.id === invitation.session_id)
    if (!student || !session || !session.roster.some((record) => record.studentId === student.id)) {
      return fail('INVITE_NO_LONGER_VALID', 'This student invitation is no longer valid. Ask your professor for a new invite', 409)
    }
  }

  const accountId = randomToken(16)
  const claimId = randomToken(16)
  const now = new Date().toISOString()
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  const passwordHash = await derivePasswordHash(body.password, salt)
  const statements = await env.DB.batch([
    env.DB.prepare('UPDATE invitations SET used_at = ?, claimed_by = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?')
      .bind(now, claimId, invitation.id, Math.floor(Date.now() / 1000)),
    env.DB.prepare(`
      INSERT INTO accounts (id, email, full_name, password_salt, password_hash, role, created_at, updated_at, student_id)
      SELECT ?, ?, ?, ?, ?, 'instructor', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM invitations WHERE id = ? AND claimed_by = ?)
        AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM accounts WHERE student_id = ?))
    `).bind(accountId, email, body.name.trim(), salt, passwordHash, now, now, invitation.student_id, invitation.id, claimId, invitation.student_id, invitation.student_id),
  ])
  if (Number(statements[1]?.meta?.changes || 0) !== 1) return fail('INVITE_ALREADY_USED', 'This invite was just used by another account. Ask the administrator for a new one', 409)

  const sessionToken = await createSession(env.DB, accountId)
  return ok({ user: { id: accountId, email, name: body.name.trim(), role: invitation.student_id ? 'student' : 'instructor', studentId: invitation.student_id || null } }, 201, cookieHeaders(sessionToken, request))
}

async function issueInvite(request, env, account) {
  if (account.role !== 'admin') return fail('FORBIDDEN', 'Only an administrator can invite a teammate', 403)
  const openInvites = await env.DB.prepare('SELECT COUNT(*) AS count FROM invitations WHERE used_at IS NULL AND expires_at > ?')
    .bind(Math.floor(Date.now() / 1000)).first()
  if (Number(openInvites?.count || 0) >= 100) return fail('INVITE_LIMIT', 'There are already 100 active invites', 429)
  const code = randomToken(24)
  const now = new Date().toISOString()
  await env.DB.prepare("INSERT INTO invitations (id, token_hash, created_by, expires_at, created_at, role) VALUES (?, ?, ?, ?, ?, 'instructor')")
    .bind(randomToken(16), await hashText(code), account.id, Math.floor(Date.now() / 1000) + 60 * 60 * 24, now).run()
  return ok({ code, expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201)
}

async function issueStudentInvite(request, env, account) {
  const body = await readJson(request)
  if (account.student_id) return fail('FORBIDDEN', 'Students cannot invite other students', 403)
  if (typeof body.studentId !== 'string' || typeof body.sessionId !== 'string') {
    return fail('INVALID_INVITATION', 'Choose a student and class session')
  }
  const workspace = await readWorkspace(env.DB)
  const student = workspace?.data.students.find((item) => item.id === body.studentId && item.active)
  const session = workspace?.data.sessions.find((item) => item.id === body.sessionId)
  if (!student || !session || !session.roster.some((record) => record.studentId === student.id)) {
    return fail('STUDENT_NOT_ENROLLED', 'The student is not on this class roster', 404)
  }
  const linkedAccount = await env.DB.prepare('SELECT id FROM accounts WHERE student_id = ?').bind(student.id).first()
  if (linkedAccount) return fail('STUDENT_ALREADY_REGISTERED', 'This student already has an account', 409)
  const code = randomToken(24)
  const now = new Date().toISOString()
  await env.DB.prepare("INSERT INTO invitations (id, token_hash, created_by, expires_at, created_at, role, student_id, session_id) VALUES (?, ?, ?, ?, ?, 'student', ?, ?)")
    .bind(randomToken(16), await hashText(code), account.id, Math.floor(Date.now() / 1000) + 60 * 60 * 24, now, student.id, session.id).run()
  return ok({ code, expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201)
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

async function getStudentSchedule(env, account) {
  if (!account.student_id) return fail('FORBIDDEN', 'A student account is required', 403)
  const workspace = await readWorkspace(env.DB)
  if (!workspace) return fail('WORKSPACE_NOT_INITIALIZED', 'The attendance workspace has not been initialized', 503)
  const student = workspace.data.students.find((item) => item.id === account.student_id)
  if (!student) return fail('STUDENT_NOT_FOUND', 'The linked student record could not be found', 404)
  const sessions = workspace.data.sessions
    .filter((session) => session.roster.some((record) => record.studentId === student.id))
    .map((session) => ({
      ...session,
      roster: session.roster.filter((record) => record.studentId === student.id),
    }))
  return ok({ student, sessions })
}

async function studentCheckIn(request, env, account, context) {
  if (!account.student_id) return fail('FORBIDDEN', 'A student account is required', 403)
  const rawIdempotencyKey = request.headers.get('Idempotency-Key') || ''
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(rawIdempotencyKey)) {
    return fail('IDEMPOTENCY_KEY_REQUIRED', 'Provide a valid Idempotency-Key header', 400)
  }
  const body = await readJson(request)
  if (typeof body.sessionId !== 'string' || !body.location || !Number.isFinite(body.location.latitude)
    || body.location.latitude < -90 || body.location.latitude > 90
    || !Number.isFinite(body.location.longitude)
    || body.location.longitude < -180 || body.location.longitude > 180
    || !Number.isFinite(body.location.accuracy) || body.location.accuracy < 0 || body.location.accuracy > 100000) {
    return fail('INVALID_CHECK_IN', 'A valid location is required')
  }
  const workspace = await readWorkspace(env.DB)
  if (!workspace) return fail('WORKSPACE_NOT_INITIALIZED', 'The attendance workspace has not been initialized', 503)
  const idempotencyKeyHash = await hashText(`${account.id}:${rawIdempotencyKey}`)
  const requestHash = await hashText(JSON.stringify({
    accountId: account.id,
    sessionId: body.sessionId,
    location: body.location,
  }))
  const previous = await env.DB.prepare(`
    SELECT request_hash, response_json, status_code
    FROM idempotency_keys
    WHERE key_hash = ? AND expires_at > ?
  `).bind(idempotencyKeyHash, Math.floor(Date.now() / 1000)).first()
  if (previous) {
    if (previous.request_hash !== requestHash) {
      return fail('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different request', 409)
    }
    return jsonResponse(JSON.parse(previous.response_json), previous.status_code, { 'X-Idempotent-Replay': 'true' })
  }
  const session = workspace.data.sessions.find((item) => item.id === body.sessionId)
  const record = session?.roster.find((item) => item.studentId === account.student_id)
  const student = workspace.data.students.find((item) => item.id === account.student_id && item.active)
  if (!session || !record || !student) return fail('SESSION_NOT_FOUND', 'This class is not on your schedule', 404)
  const now = bangkokDateTime()
  if (session.status === 'closed' || session.date !== now.date || now.time < session.startTime || now.time >= session.endTime) {
    return fail('CHECK_IN_CLOSED', 'Check-in is available only during today’s class time', 403)
  }
  if (record.status !== 'unmarked') return fail('ALREADY_CHECKED_IN', 'This attendance record can no longer be changed by student check-in', 409)
  const markedAt = new Date().toISOString()
  const eventId = crypto.randomUUID()
  const updatedAt = new Date().toISOString()
  const updatedData = {
    ...workspace.data,
    sessions: workspace.data.sessions.map((item) => item.id !== session.id ? item : {
      ...item,
      roster: item.roster.map((entry) => entry.studentId !== account.student_id ? entry : {
        ...entry,
        status: 'present',
        markedAt: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()),
        checkInAt: markedAt,
        checkInLocation: {
          latitude: body.location.latitude,
          longitude: body.location.longitude,
          accuracy: body.location.accuracy,
        },
      }),
    }),
  }
  const eventPayload = {
    event_id: eventId,
    event: 'attendance.recorded',
    timestamp: markedAt,
    data: {
      student_code: record.studentCode,
      course_code: session.courseCode,
      section_number: session.sectionNumber || '',
      attendance_status: 'PRESENT',
      check_in_time: markedAt,
      room: session.room,
      device_id: 'AttendanceFlow',
    },
  }
  const responsePayload = {
    success: true,
    data: { checkedInAt: markedAt, eventId, integrationStatus: 'queued' },
  }
  const statements = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO idempotency_keys (key_hash, account_id, request_hash, response_json, status_code, created_at, expires_at)
      SELECT ?, ?, ?, ?, 200, ?, ?
      FROM attendance_workspace
      WHERE id = 'shared' AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM idempotency_keys WHERE key_hash = ?)
    `).bind(
      idempotencyKeyHash,
      account.id,
      requestHash,
      JSON.stringify(responsePayload),
      markedAt,
      Math.floor(Date.now() / 1000) + 86400,
      workspace.revision,
      idempotencyKeyHash,
    ),
    env.DB.prepare(`
    UPDATE attendance_workspace
    SET data_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?, last_operation_id = ?
    WHERE id = 'shared' AND revision = ?
      AND EXISTS (
        SELECT 1 FROM idempotency_keys
        WHERE key_hash = ? AND request_hash = ? AND created_at = ?
      )
  `).bind(JSON.stringify(updatedData), updatedAt, account.id, eventId, workspace.revision, idempotencyKeyHash, requestHash, markedAt),
    env.DB.prepare(`
      INSERT INTO webhook_outbox (event_id, event_type, payload_json, status, next_attempt_at, created_at)
      SELECT ?, 'attendance.recorded', ?, 'pending', ?, ?
      WHERE EXISTS (
        SELECT 1 FROM attendance_workspace
        WHERE id = 'shared' AND revision = ? AND last_operation_id = ?
      )
    `).bind(eventId, JSON.stringify(eventPayload), Math.floor(Date.now() / 1000), markedAt, workspace.revision + 1, eventId),
  ])
  if (Number(statements[0]?.meta?.changes || 0) !== 1 || Number(statements[1]?.meta?.changes || 0) !== 1
    || Number(statements[2]?.meta?.changes || 0) !== 1) {
    const replay = await env.DB.prepare(`
      SELECT request_hash, response_json, status_code FROM idempotency_keys
      WHERE key_hash = ? AND expires_at > ?
    `).bind(idempotencyKeyHash, Math.floor(Date.now() / 1000)).first()
    if (replay && replay.request_hash === requestHash) {
      return jsonResponse(JSON.parse(replay.response_json), replay.status_code, { 'X-Idempotent-Replay': 'true' })
    }
    return fail('DATA_CONFLICT', 'The class changed while checking in. Refresh and try again', 409)
  }
  if (typeof context?.waitUntil === 'function') {
    const outboxEvent = await env.DB.prepare('SELECT * FROM webhook_outbox WHERE event_id = ?').bind(eventId).first()
    context.waitUntil(processOutboxEvent(env, outboxEvent, { wait: true }))
  }
  return jsonResponse(responsePayload)
}

async function partnerEnrollmentProxy(request, env, account) {
  if (account.student_id) return fail('FORBIDDEN', 'Only instructors can access enrollment rosters', 403)
  const url = new URL(request.url)
  const courseCode = String(url.searchParams.get('course_code') || '').trim().toUpperCase()
  const sectionNumber = String(url.searchParams.get('section_number') || '').trim()
  if (!courseCode || courseCode.length > 30 || sectionNumber.length > 40) {
    return fail('INVALID_REQUEST', 'Provide a valid course_code and optional section_number')
  }
  let enrollments
  try {
    enrollments = await fetchPartnerEnrollments(env, { courseCode, sectionNumber })
  } catch (error) {
    console.error('UniEnroll enrollment proxy failed', { message: error.message })
    return fail('PARTNER_UNAVAILABLE', error.message, 503)
  }
  if (enrollments.length > 20000) return fail('PARTNER_RESPONSE_TOO_LARGE', 'UniEnroll returned too many enrollments', 502)
  return ok({ enrollments })
}

async function syncPartnerRoster(request, env, account) {
  if (account.student_id) return fail('FORBIDDEN', 'Only instructors can sync enrollment rosters', 403)
  const body = await readJson(request)
  if (typeof body.sessionId !== 'string' || body.sessionId.length > 120) {
    return fail('INVALID_REQUEST', 'A valid class session is required')
  }
  const workspace = await readWorkspace(env.DB)
  if (!workspace) return fail('WORKSPACE_NOT_INITIALIZED', 'The attendance workspace has not been initialized', 503)
  const session = workspace.data.sessions.find((item) => item.id === body.sessionId)
  if (!session) return fail('SESSION_NOT_FOUND', 'This class session could not be found', 404)
  let enrollments
  try {
    enrollments = await fetchPartnerEnrollments(env, {
      courseCode: session.courseCode,
      sectionNumber: session.sectionNumber || '',
    })
  } catch (error) {
    console.error('UniEnroll roster sync failed', { sessionId: session.id, message: error.message })
    return fail('PARTNER_UNAVAILABLE', error.message, 503)
  }
  if (enrollments.length > 20000) return fail('PARTNER_RESPONSE_TOO_LARGE', 'UniEnroll returned too many enrollments', 502)
  const { data, syncedCount } = applyEnrollmentRoster(workspace.data, session.id, enrollments)
  if (!validateAttendanceData(data)) {
    console.error('UniEnroll roster validation failed', { sessionId: session.id })
    return fail('PARTNER_DATA_INVALID', 'UniEnroll roster did not pass AttendanceFlow validation', 502)
  }
  const serialized = JSON.stringify(data)
  if (new TextEncoder().encode(serialized).byteLength > 1024 * 1024) {
    return fail('DATA_TOO_LARGE', 'Synced roster exceeds the 1 MB workspace limit', 413)
  }
  const updatedAt = new Date().toISOString()
  const result = await env.DB.prepare(`
    UPDATE attendance_workspace
    SET data_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?
    WHERE id = 'shared' AND revision = ?
  `).bind(serialized, updatedAt, account.id, workspace.revision).run()
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail('DATA_CONFLICT', 'Attendance data changed during roster sync. Refresh and try again', 409)
  }
  return ok({ syncedCount, revision: workspace.revision + 1, updatedAt })
}

async function partnerIntegrationStatus(env, account) {
  if (account.student_id) return fail('FORBIDDEN', 'Only instructors can view integration status', 403)
  const [outbox, inbox, reconciliation, failedOutbox, failedInbox] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM webhook_outbox GROUP BY status").all(),
    env.DB.prepare("SELECT status, COUNT(*) AS count FROM webhook_inbox GROUP BY status").all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM reconciliation_queue WHERE status = 'pending'").first(),
    env.DB.prepare("SELECT event_id, event_type, last_error, created_at FROM webhook_outbox WHERE status = 'failed' ORDER BY created_at DESC LIMIT 20").all(),
    env.DB.prepare("SELECT event_id, event_type, last_error, received_at AS created_at FROM webhook_inbox WHERE status = 'failed' ORDER BY received_at DESC LIMIT 20").all(),
  ])
  const counts = (result) => Object.fromEntries((result.results || []).map((row) => [row.status, Number(row.count)]))
  return ok({
    configured: Boolean(env.UNIENROLL_PARTNER_TOKEN && env.UNIENROLL_WEBHOOK_SECRET
      && env.UNIENROLL_SIGNATURE_SECRET),
    outbox: counts(outbox),
    inbox: counts(inbox),
    reconciliationPending: Number(reconciliation?.count || 0),
    failedEvents: [
      ...(failedOutbox.results || []).map((event) => ({ ...event, source: 'outbox' })),
      ...(failedInbox.results || []).map((event) => ({ ...event, source: 'inbox' })),
    ].sort((left, right) => right.created_at.localeCompare(left.created_at)),
  })
}

async function retryReconciliation(request, env, account, context) {
  if (account.student_id) return fail('FORBIDDEN', 'Only instructors can retry reconciliation', 403)
  const body = await readJson(request)
  if (typeof body.eventId !== 'string' || body.eventId.length > 128) {
    return fail('INVALID_REQUEST', 'A valid eventId is required')
  }
  const source = body.source || 'outbox'
  if (!['inbox', 'outbox'].includes(source)) return fail('INVALID_REQUEST', 'source must be inbox or outbox')
  const now = Math.floor(Date.now() / 1000)
  const result = source === 'inbox'
    ? await env.DB.prepare(`
      UPDATE webhook_inbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?, locked_until = NULL, last_error = NULL
      WHERE event_id = ? AND status = 'failed'
    `).bind(now, body.eventId).run()
    : await env.DB.prepare(`
      UPDATE webhook_outbox
      SET status = 'pending', attempts = 0, next_attempt_at = ?, locked_until = NULL, last_error = NULL
      WHERE event_id = ? AND status = 'failed'
    `).bind(now, body.eventId).run()
  if (Number(result.meta?.changes || 0) !== 1) {
    return fail('RECONCILIATION_NOT_FOUND', 'No failed event is available to retry', 404)
  }
  await env.DB.prepare("UPDATE reconciliation_queue SET status = 'pending', attempts = 0, next_attempt_at = ?, last_error = NULL WHERE event_id = ? AND source = ?")
    .bind(now, body.eventId, source).run()
  if (typeof context?.waitUntil === 'function') {
    if (source === 'inbox') {
      const row = await env.DB.prepare('SELECT * FROM webhook_inbox WHERE event_id = ?').bind(body.eventId).first()
      context.waitUntil(processInboxEvent(env.DB, row))
    } else {
      const row = await env.DB.prepare('SELECT * FROM webhook_outbox WHERE event_id = ?').bind(body.eventId).first()
      context.waitUntil(processOutboxEvent(env, row, { wait: true }))
    }
  }
  return ok({ eventId: body.eventId, source, status: 'pending' }, 202)
}

function validOrigin(request) {
  const origin = request.headers.get('Origin')
  return Boolean(origin && origin === new URL(request.url).origin)
}

export async function onRequest({ request, env, ...context }) {
  if (!env.DB) return fail('SERVER_CONFIGURATION', 'The shared attendance database is not configured', 503)
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = request.method.toUpperCase()

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, POST, PUT, OPTIONS' } })
  if (!path.startsWith('/api/')) return fail('NOT_FOUND', 'API route not found', 404)

  if (path === '/api/webhooks/receive' && method === 'POST') {
    try {
      return await receiveUniEnrollWebhook(request, env)
    } catch (error) {
      console.error('UniEnroll webhook receiver error', { message: error.message })
      return fail('WEBHOOK_RECEIVER_ERROR', 'The webhook could not be accepted', 500)
    }
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !validOrigin(request)) {
    return fail('INVALID_ORIGIN', 'Cross-origin requests are not allowed', 403)
  }

  try {
    if (path === '/api/auth/status' && method === 'GET') {
      const result = await env.DB.prepare('SELECT COUNT(*) AS count FROM accounts').first()
      return ok({ initialized: Number(result?.count || 0) > 0 })
    }

    if (path === '/api/auth/setup' && method === 'POST') return await setupOwner(request, env)
    if (path === '/api/auth/login' && method === 'POST') return await login(request, env)
    if (path === '/api/auth/join' && method === 'POST') return await joinWorkspace(request, env)

    const account = await getAccount(request, env.DB)
    if (path === '/api/auth/session' && method === 'GET') {
      return account
        ? ok({ user: publicAccount(account) })
        : fail('UNAUTHENTICATED', 'Please sign in to continue', 401)
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const token = readCookie(request, SESSION_COOKIE)
      if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await hashText(token)).run()
      return ok({ signedOut: true }, 200, cookieHeaders('', request, true))
    }

    if (!account) return fail('UNAUTHENTICATED', 'Please sign in to continue', 401)

    if (path === '/api/auth/invitations' && method === 'POST') return await issueInvite(request, env, account)
    if (path === '/api/auth/student-invitations' && method === 'POST') return await issueStudentInvite(request, env, account)
    if (path === '/api/student/data' && method === 'GET') return await getStudentSchedule(env, account)
    if (path === '/api/student/check-in' && method === 'POST') return await studentCheckIn(request, env, account, context)
    if (path === '/api/partner/enrollments' && method === 'GET') return await partnerEnrollmentProxy(request, env, account)
    if (path === '/api/partner/enrollments/sync' && method === 'POST') return await syncPartnerRoster(request, env, account)
    if (path === '/api/partner/status' && method === 'GET') return await partnerIntegrationStatus(env, account)
    if (path === '/api/partner/reconciliation/retry' && method === 'POST') return await retryReconciliation(request, env, account, context)

    if (path === '/api/data' && method === 'GET') {
      if (account.student_id) return fail('FORBIDDEN', 'Student accounts can only access their own schedule', 403)
      const workspace = await readWorkspace(env.DB)
      if (!workspace) return fail('WORKSPACE_NOT_INITIALIZED', 'The attendance workspace has not been initialized', 503)
      return ok(workspace)
    }

    if (path === '/api/data' && method === 'PUT') {
      if (account.student_id) return fail('FORBIDDEN', 'Student accounts cannot edit the shared workspace', 403)
      const body = await readJson(request)
      if (!Number.isInteger(body.revision) || body.revision < 1 || !validateAttendanceData(body.data)) {
        return fail('INVALID_DATA', 'The attendance data is invalid and was not saved')
      }
      const text = JSON.stringify(body.data)
      if (new TextEncoder().encode(text).byteLength > 1024 * 1024) return fail('DATA_TOO_LARGE', 'Attendance data exceeds the 1 MB workspace limit', 413)
      const now = new Date().toISOString()
      const result = await env.DB.prepare(`
        UPDATE attendance_workspace
        SET data_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?
        WHERE id = 'shared' AND revision = ?
      `).bind(text, now, account.id, body.revision).run()
      if (Number(result.meta.changes || 0) !== 1) {
        const latest = await readWorkspace(env.DB)
        return fail('DATA_CONFLICT', 'Another user changed the attendance data. The latest shared copy was loaded; retry your change', 409, latest)
      }
      return ok({ data: body.data, revision: body.revision + 1, updatedAt: now })
    }

    return fail('NOT_FOUND', 'API route not found', 404)
  } catch (error) {
    if (error.message === 'REQUEST_TOO_LARGE') return fail('REQUEST_TOO_LARGE', 'Request body is too large', 413)
    if (error.message === 'INVALID_JSON') return fail('INVALID_JSON', 'Request body must be valid JSON')
    if (error.message === 'WORKSPACE_DATA_CORRUPTED' || error.message === 'WORKSPACE_DATA_INVALID') {
      console.error('Attendance workspace integrity error', error.message)
      return fail('WORKSPACE_INTEGRITY', 'Saved workspace data needs administrator recovery', 500)
    }
    console.error('Attendance API error', { path, message: error.message })
    return fail('INTERNAL_ERROR', 'The request could not be completed. Try again', 500)
  }
}
