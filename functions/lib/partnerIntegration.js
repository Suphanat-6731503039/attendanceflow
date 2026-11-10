const RETRY_DELAYS_SECONDS = [1, 2, 4]
const MAX_DELIVERY_ATTEMPTS = 4
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

export async function verifyUniEnrollSignature(rawBody, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature || '')) return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  return constantTimeEqual(`sha256=${hex(digest)}`, signature.toLowerCase())
}

export function partnerBaseUrl(env) {
  const value = env.UNIENROLL_API_BASE_URL || 'https://unienroll-backend.team03-enrollment.workers.dev'
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('UNIENROLL_API_BASE_URL must be a valid HTTPS URL')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('UNIENROLL_API_BASE_URL must use HTTPS')
  }
  return url.origin
}

export async function fetchPartnerEnrollments(env, { courseCode, sectionNumber = '' }) {
  if (!env.UNIENROLL_PARTNER_TOKEN) throw new Error('UNIENROLL_PARTNER_TOKEN is not configured')
  const url = new URL('/api/partner/enrollments', partnerBaseUrl(env))
  if (courseCode) url.searchParams.set('course_code', courseCode)
  if (sectionNumber) url.searchParams.set('section_number', sectionNumber)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  let response
  try {
    response = await fetch(url, {
      headers: {
        'X-Partner-Key': env.UNIENROLL_PARTNER_TOKEN,
        ...(env.UNIENROLL_PARTNER_ID ? { 'X-Partner-Id': env.UNIENROLL_PARTNER_ID } : {}),
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('UniEnroll enrollment request timed out')
    throw new Error('Could not reach UniEnroll enrollment service')
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`UniEnroll enrollment request failed (${response.status})`)
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('UniEnroll returned invalid JSON')
  }
  const rows = Array.isArray(payload) ? payload : payload?.data?.enrollments || payload?.enrollments
  if (!Array.isArray(rows)) throw new Error('UniEnroll response did not contain an enrollment list')
  return rows
}

export async function receiveUniEnrollWebhook(request, env) {
  if (!env.UNIENROLL_SIGNATURE_SECRET) {
    return new Response(JSON.stringify({ success: false, error: { code: 'SERVER_CONFIGURATION', message: 'Webhook signature verification is not configured' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(JSON.stringify({ success: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Webhook body is too large' } }), {
      status: 413,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  const rawBody = await request.text()
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return new Response(JSON.stringify({ success: false, error: { code: 'REQUEST_TOO_LARGE', message: 'Webhook body is too large' } }), {
      status: 413,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  if (!await verifyUniEnrollSignature(rawBody, request.headers.get('X-UniEnroll-Signature'), env.UNIENROLL_SIGNATURE_SECRET)) {
    return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature is invalid' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_JSON', message: 'Webhook body must be valid JSON' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  if (typeof payload.event_id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(payload.event_id)
    || !['enrollment.created', 'enrollment.swapped', 'enrollment.dropped', 'enrollment.changed', 'schedule.changed'].includes(payload.event)
    || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)
    || (payload.timestamp !== undefined && !Number.isFinite(Date.parse(payload.timestamp)))
    || (payload.event !== 'schedule.changed'
      && (typeof payload.data.student_code !== 'string' || !payload.data.student_code.trim()
        || typeof payload.data.course_code !== 'string' || !payload.data.course_code.trim()))) {
    return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_WEBHOOK', message: 'Webhook event is invalid or unsupported' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  const now = new Date().toISOString()
  const result = await env.DB.prepare(`
    INSERT INTO webhook_inbox (event_id, event_type, payload_json, status, next_attempt_at, received_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `).bind(payload.event_id, payload.event, rawBody, Math.floor(Date.now() / 1000), now).run()
  const duplicate = Number(result.meta?.changes || 0) !== 1
  if (duplicate) {
    const stored = await env.DB.prepare('SELECT payload_json FROM webhook_inbox WHERE event_id = ?')
      .bind(payload.event_id).first()
    if (stored?.payload_json !== rawBody) {
      return new Response(JSON.stringify({ success: false, error: { code: 'EVENT_ID_CONFLICT', message: 'event_id was already used with a different payload' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }
  }
  return new Response(JSON.stringify({
    success: true,
    status: duplicate ? 'DUPLICATE' : 'ACCEPTED',
    event_id: payload.event_id,
    message: duplicate ? 'Event was already received' : 'Event was queued for processing',
    received_at: now,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function studentIdForCode() {
  return `unienroll-${crypto.randomUUID()}`
}

function enrollmentFields(row) {
  if (!row || typeof row !== 'object') return null
  const studentCode = String(row.student_code || row.studentCode || '').trim()
  const rawStudentName = String(row.student_name || row.full_name || row.name || '').trim()
  const courseCode = String(row.course_code || row.courseCode || '').trim().toUpperCase()
  const sectionNumber = String(row.section_number || row.sectionNumber || '').trim()
  if (!studentCode || studentCode.length > 80 || courseCode.length > 30 || sectionNumber.length > 40) return null
  return {
    studentCode,
    studentName: (rawStudentName || studentCode).slice(0, 100),
    courseCode,
    sectionNumber,
  }
}

export function applyEnrollmentEvent(data, payload) {
  const eventData = payload.data
  const fields = enrollmentFields(eventData)
  if (!fields) throw new Error('Enrollment webhook is missing a valid student_code')
  if (!fields.courseCode) throw new Error('Enrollment webhook is missing a valid course_code')
  const now = new Date().toISOString()
  let student = data.students.find((item) => item.code.toLowerCase() === fields.studentCode.toLowerCase())
  if (!student && payload.event === 'enrollment.dropped') return data
  const students = [...data.students]
  if (!student) {
    student = {
      id: studentIdForCode(),
      code: fields.studentCode,
      name: fields.studentName,
      email: '',
      active: true,
      createdAt: now,
    }
    students.push(student)
  } else {
    student = { ...student, name: fields.studentName || student.name, active: true }
    const index = students.findIndex((item) => item.id === student.id)
    students[index] = student
  }
  const sessions = data.sessions.map((session) => {
    if (fields.courseCode && session.courseCode.toUpperCase() !== fields.courseCode) return session
    const targetSection = fields.sectionNumber
    const previousSection = String(eventData.previous_section_number || eventData.old_section_number || '').trim()
    if (payload.event === 'enrollment.swapped' && previousSection
      && session.sectionNumber === previousSection && session.sectionNumber !== targetSection) {
      return {
        ...session,
        roster: session.roster.filter((record) => record.studentCode.toLowerCase() !== fields.studentCode.toLowerCase()
          || record.status !== 'unmarked'),
      }
    }
    if (targetSection && session.sectionNumber && session.sectionNumber !== targetSection) return session
    const current = session.roster.find((record) => record.studentCode.toLowerCase() === fields.studentCode.toLowerCase())
    if (payload.event === 'enrollment.dropped') {
      return {
        ...session,
        roster: session.roster.filter((record) => record.studentCode.toLowerCase() !== fields.studentCode.toLowerCase()
          || record.status !== 'unmarked'),
      }
    }
    if (current) {
      return {
        ...session,
        roster: session.roster.map((record) => record.studentCode.toLowerCase() === fields.studentCode.toLowerCase()
          ? { ...record, studentId: student.id, studentName: student.name, studentCode: student.code }
          : record),
      }
    }
    if (session.status === 'closed' || session.date < new Date().toISOString().slice(0, 10)) return session
    return {
      ...session,
      roster: [...session.roster, {
        studentId: student.id,
        studentCode: student.code,
        studentName: student.name,
        status: 'unmarked',
        markedAt: null,
      }],
    }
  })
  return { ...data, students, sessions }
}

export function applyEnrollmentRoster(data, sessionId, rows) {
  const session = data.sessions.find((item) => item.id === sessionId)
  if (!session) throw new Error('Class session was not found')
  const byCode = new Map()
  for (const row of rows) {
    const fields = enrollmentFields(row)
    if (!fields) throw new Error('UniEnroll returned an enrollment without a valid student_code')
    if (fields.courseCode && fields.courseCode !== session.courseCode.toUpperCase()) continue
    if (session.sectionNumber && fields.sectionNumber && fields.sectionNumber !== session.sectionNumber) continue
    byCode.set(fields.studentCode.toLowerCase(), fields)
  }
  const students = [...data.students]
  const currentRoster = session.roster
  const syncedRoster = [...byCode.values()].map((fields) => {
    let student = students.find((item) => item.code.toLowerCase() === fields.studentCode.toLowerCase())
    if (!student) {
      student = {
        id: studentIdForCode(),
        code: fields.studentCode,
        name: fields.studentName,
        email: '',
        active: true,
        createdAt: new Date().toISOString(),
      }
      students.push(student)
    } else {
      student = { ...student, name: fields.studentName || student.name, active: true }
      const index = students.findIndex((item) => item.id === student.id)
      students[index] = student
    }
    const oldRecord = currentRoster.find((record) => record.studentCode.toLowerCase() === fields.studentCode.toLowerCase())
    return oldRecord
      ? { ...oldRecord, studentId: student.id, studentCode: student.code, studentName: student.name }
      : {
        studentId: student.id,
        studentCode: student.code,
        studentName: student.name,
        status: 'unmarked',
        markedAt: null,
      }
  })
  const providerCodes = new Set(byCode.keys())
  const historicalRecords = currentRoster.filter((record) => record.status !== 'unmarked'
    && !providerCodes.has(record.studentCode.toLowerCase()))
  return {
    data: {
      ...data,
      students,
      sessions: data.sessions.map((item) => item.id === sessionId
        ? { ...item, roster: [...syncedRoster, ...historicalRecords] }
        : item),
    },
    syncedCount: syncedRoster.length,
  }
}

export async function processInboxEvent(db, row) {
  const now = Math.floor(Date.now() / 1000)
  const lockUntil = now + 30
  const claimed = await db.prepare(`
    UPDATE webhook_inbox SET locked_until = ?
    WHERE event_id = ? AND status = 'pending' AND next_attempt_at <= ?
      AND (locked_until IS NULL OR locked_until < ?)
  `).bind(lockUntil, row.event_id, now, now).run()
  if (Number(claimed.meta?.changes || 0) !== 1) return
  try {
    const payload = JSON.parse(row.payload_json)
    if (payload.event === 'schedule.changed') {
      await db.prepare(`
        UPDATE webhook_inbox SET status = 'processed', processed_at = ?, locked_until = NULL, last_error = NULL
        WHERE event_id = ?
      `).bind(new Date().toISOString(), row.event_id).run()
      return
    }
    const workspace = await db.prepare(`
      SELECT workspace.data_json, workspace.revision, accounts.id AS updated_by
      FROM attendance_workspace AS workspace
      JOIN accounts ON accounts.role = 'admin'
      WHERE workspace.id = 'shared'
      ORDER BY accounts.created_at
      LIMIT 1
    `).first()
    if (!workspace) throw new Error('Attendance workspace is not initialized')
    const data = JSON.parse(workspace.data_json)
    const next = applyEnrollmentEvent(data, payload)
    const timestamp = new Date().toISOString()
    const write = await db.prepare(`
      UPDATE attendance_workspace
      SET data_json = ?, revision = revision + 1, updated_at = ?, updated_by = ?
      WHERE id = 'shared' AND revision = ?
    `).bind(JSON.stringify(next), timestamp, workspace.updated_by, workspace.revision).run()
    if (Number(write.meta?.changes || 0) !== 1) throw new Error('Workspace changed during webhook processing')
    await db.prepare(`
      UPDATE webhook_inbox SET status = 'processed', processed_at = ?, locked_until = NULL, last_error = NULL
      WHERE event_id = ?
    `).bind(timestamp, row.event_id).run()
  } catch (error) {
    const attempts = Number(row.attempts || 0) + 1
    const failed = attempts >= MAX_DELIVERY_ATTEMPTS
    const nextAttempt = now + RETRY_DELAYS_SECONDS[Math.min(attempts - 1, RETRY_DELAYS_SECONDS.length - 1)]
    await db.prepare(`
      UPDATE webhook_inbox SET attempts = ?, status = ?, next_attempt_at = ?, locked_until = NULL, last_error = ?
      WHERE event_id = ?
    `).bind(attempts, failed ? 'failed' : 'pending', nextAttempt, String(error.message).slice(0, 300), row.event_id).run()
    if (failed) {
      await queueReconciliation(db, row, String(error.message), 'inbox')
      throw error
    }
  }
}

async function queueReconciliation(db, row, message, source = 'outbox') {
  let payload
  try {
    payload = JSON.parse(row.payload_json)
  } catch {
    payload = { data: {} }
  }
  const courseCode = String(payload.data?.course_code || '').slice(0, 40)
  if (!courseCode) return
  const sectionNumber = String(payload.data?.section_number || '').slice(0, 40)
  await db.prepare(`
    INSERT INTO reconciliation_queue (id, event_id, course_code, section_number, status, next_attempt_at, last_error, created_at, source)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(crypto.randomUUID(), row.event_id, courseCode, sectionNumber, Math.floor(Date.now() / 1000), message.slice(0, 300), new Date().toISOString(), source).run()
}

export async function processOutboxEvent(env, row, { wait = false } = {}) {
  const db = env.DB
  const now = Math.floor(Date.now() / 1000)
  const claimed = await db.prepare(`
    UPDATE webhook_outbox SET locked_until = ?
    WHERE event_id = ? AND status = 'pending' AND next_attempt_at <= ?
      AND (locked_until IS NULL OR locked_until < ?)
  `).bind(now + 30, row.event_id, now, now).run()
  if (Number(claimed.meta?.changes || 0) !== 1) return false
  const payload = JSON.parse(row.payload_json)
  if (!env.UNIENROLL_WEBHOOK_SECRET) {
    await db.prepare(`
      UPDATE webhook_outbox SET status = 'failed', attempts = attempts + 1,
        locked_until = NULL, last_error = 'UNIENROLL_WEBHOOK_SECRET is not configured'
      WHERE event_id = ?
    `).bind(row.event_id).run()
    await queueReconciliation(db, row, 'UNIENROLL_WEBHOOK_SECRET is not configured')
    return false
  }
  let target
  try {
    target = new URL('/api/webhooks/incoming', partnerBaseUrl(env))
  } catch (error) {
    await db.prepare(`
      UPDATE webhook_outbox SET status = 'failed', attempts = attempts + 1,
        locked_until = NULL, last_error = ?
      WHERE event_id = ?
    `).bind(error.message.slice(0, 300), row.event_id).run()
    await queueReconciliation(db, row, error.message)
    return false
  }

  const attempt = async () => {
    const attemptNumber = Number(row.attempts || 0) + 1
    let response
    let errorMessage = ''
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      try {
        response = await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': env.UNIENROLL_WEBHOOK_SECRET,
            'Idempotency-Key': row.event_id,
          },
          body: row.payload_json,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      errorMessage = error.name === 'AbortError' ? 'UniEnroll webhook request timed out' : 'Could not reach UniEnroll webhook receiver'
    }
    if (response?.ok) {
      const deliveredAt = new Date().toISOString()
      await db.prepare(`
        UPDATE webhook_outbox SET status = 'delivered', attempts = ?, delivered_at = ?,
          last_response_code = ?, locked_until = NULL, last_error = NULL
        WHERE event_id = ?
      `).bind(attemptNumber, deliveredAt, response.status, row.event_id).run()
      await db.prepare("UPDATE reconciliation_queue SET status = 'reconciled', reconciled_at = ?, last_error = NULL WHERE event_id = ?")
        .bind(deliveredAt, row.event_id).run()
      return { delivered: true, retryable: false, attemptNumber }
    }
    if (response) {
      errorMessage = `UniEnroll webhook receiver returned ${response.status}`
      if (response.status < 500 && response.status !== 408 && response.status !== 429) {
        await db.prepare(`
          UPDATE webhook_outbox SET status = 'failed', attempts = ?, last_response_code = ?,
            locked_until = NULL, last_error = ? WHERE event_id = ?
        `).bind(attemptNumber, response.status, errorMessage, row.event_id).run()
        await queueReconciliation(db, row, errorMessage)
        return { delivered: false, retryable: false, attemptNumber }
      }
    }
    const failed = attemptNumber >= MAX_DELIVERY_ATTEMPTS
    const delay = RETRY_DELAYS_SECONDS[Math.min(attemptNumber - 1, RETRY_DELAYS_SECONDS.length - 1)]
    await db.prepare(`
      UPDATE webhook_outbox SET status = ?, attempts = ?, next_attempt_at = ?,
        locked_until = NULL, last_error = ?, last_response_code = ?
      WHERE event_id = ?
    `).bind(failed ? 'failed' : 'pending', attemptNumber, now + delay, errorMessage || 'UniEnroll delivery failed', response?.status || null, row.event_id).run()
    if (failed) await queueReconciliation(db, row, errorMessage || 'UniEnroll delivery failed after retries')
    return { delivered: false, retryable: !failed, attemptNumber }
  }

  let result = await attempt()
  while (wait && result.retryable) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_SECONDS[result.attemptNumber - 1] * 1000))
    const latest = await db.prepare('SELECT * FROM webhook_outbox WHERE event_id = ?').bind(row.event_id).first()
    if (!latest || latest.status !== 'pending') break
    row = latest
    result = await attempt()
  }
  return result.delivered
}
