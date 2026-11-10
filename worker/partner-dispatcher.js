import { processInboxEvent, processOutboxEvent } from '../functions/lib/partnerIntegration.js'

async function dispatchDueEvents(env) {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare('DELETE FROM idempotency_keys WHERE expires_at <= ?').bind(now).run()
  const [inbox, outbox] = await Promise.all([
    env.DB.prepare(`
      SELECT * FROM webhook_inbox
      WHERE status = 'pending' AND next_attempt_at <= ?
        AND (locked_until IS NULL OR locked_until < ?)
      ORDER BY next_attempt_at LIMIT 20
    `).bind(now, now).all(),
    env.DB.prepare(`
      SELECT * FROM webhook_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
        AND (locked_until IS NULL OR locked_until < ?)
      ORDER BY next_attempt_at LIMIT 20
    `).bind(now, now).all(),
  ])
  for (const event of inbox.results || []) {
    try {
      await processInboxEvent(env.DB, event)
    } catch (error) {
      console.error('UniEnroll inbox event processing failed', { eventId: event.event_id, message: error.message })
    }
  }
  for (const event of outbox.results || []) {
    try {
      await processOutboxEvent(env, event)
    } catch (error) {
      console.error('UniEnroll outbox delivery failed', { eventId: event.event_id, message: error.message })
    }
  }
}

export default {
  async scheduled(_event, env, context) {
    context.waitUntil(dispatchDueEvents(env))
  },
}
