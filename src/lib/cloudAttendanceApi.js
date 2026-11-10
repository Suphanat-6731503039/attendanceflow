async function request(path, { method = 'GET', body, idempotencyKey, timeoutMs = 4000, retries = 0 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      window.clearTimeout(timeout)
      const retryable = error.name === 'AbortError' || error instanceof TypeError
      if (retryable && attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000 * (2 ** attempt)))
        continue
      }
      if (error.name === 'AbortError') throw new Error('AttendanceFlow request timed out')
      throw new Error('Could not reach AttendanceFlow. Check your internet connection and try again')
    }
    window.clearTimeout(timeout)

    let payload
    try {
      payload = await response.json()
    } catch {
      if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000 * (2 ** attempt)))
        continue
      }
      throw new Error(`AttendanceFlow returned an unreadable response (${response.status})`)
    }
    if (!response.ok || payload.success !== true) {
      const error = new Error(payload.error?.message || `Request failed (${response.status})`)
      error.code = payload.error?.code || 'REQUEST_FAILED'
      error.data = payload.data
      error.status = response.status
      if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000 * (2 ** attempt)))
        continue
      }
      throw error
    }
    return payload.data
  }
  throw new Error('AttendanceFlow request failed after retrying')
}

export function getAuthStatus() {
  return request('/api/auth/status')
}

export function getCurrentUser() {
  return request('/api/auth/session')
}

export function signIn(email, password) {
  return request('/api/auth/login', { method: 'POST', body: { email, password } })
}

export function setupOwner(setupCode, name, email, password) {
  return request('/api/auth/setup', { method: 'POST', body: { setupCode, name, email, password } })
}

export function joinWorkspace(inviteCode, name, email, password) {
  return request('/api/auth/join', { method: 'POST', body: { inviteCode, name, email, password } })
}

export function signOut() {
  return request('/api/auth/logout', { method: 'POST', body: {} })
}

export function getWorkspace() {
  return request('/api/data')
}

export function saveWorkspace(data, revision) {
  return request('/api/data', { method: 'PUT', body: { data, revision } })
}

export function createInvitation() {
  return request('/api/auth/invitations', { method: 'POST', body: {} })
}

export function createStudentInvitation(studentId, sessionId) {
  return request('/api/auth/student-invitations', {
    method: 'POST',
    body: { studentId, sessionId },
  })
}

export function getStudentSchedule() {
  return request('/api/student/data')
}

export function submitStudentCheckIn(sessionId, location) {
  const idempotencyKey = crypto.randomUUID()
  return request('/api/student/check-in', {
    method: 'POST',
    body: { sessionId, location },
    idempotencyKey,
    retries: 3,
  })
}

export function getPartnerEnrollments(courseCode, sectionNumber = '') {
  const query = new URLSearchParams({ course_code: courseCode })
  if (sectionNumber) query.set('section_number', sectionNumber)
  return request(`/api/partner/enrollments?${query}`)
}

export function syncPartnerEnrollments(sessionId) {
  return request('/api/partner/enrollments/sync', {
    method: 'POST',
    body: { sessionId },
  })
}

export function getPartnerIntegrationStatus() {
  return request('/api/partner/status')
}

export function retryPartnerReconciliation(eventId, source) {
  return request('/api/partner/reconciliation/retry', {
    method: 'POST',
    body: { eventId, source },
  })
}
