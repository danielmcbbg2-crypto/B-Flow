import type { SmsNotification, SmsSettings } from './types'
import { uid } from './utils'

/**
 * Demo-mode SMS: logs the message, or posts it to a webhook relay if one is set.
 * Real SMS providers are only configured in live mode, where the send-sms
 * Supabase function keeps their credentials on the server.
 */
export async function dispatchSms(
  settings: SmsSettings,
  to: string,
  message: string,
  triggerEvent: string,
): Promise<SmsNotification> {
  const base = { id: uid('s'), recipientPhone: to, message, timestamp: new Date().toISOString(), triggerEvent }
  if (settings.provider !== 'webhook') return { ...base, status: 'queued', detail: 'No SMS gateway configured — logged only.' }
  if (!settings.webhookUrl) return { ...base, status: 'failed', detail: 'Webhook URL missing.' }
  try {
    const res = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from: settings.fromNumber || undefined, message, event: triggerEvent }),
    })
    return { ...base, status: res.ok ? 'dispatched' : 'failed', detail: `Webhook HTTP ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ...base, status: 'failed', detail: `${msg} — check the webhook URL allows requests from this site (CORS).` }
  }
}
