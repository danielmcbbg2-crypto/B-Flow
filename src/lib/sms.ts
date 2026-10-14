import type { SmsNotification, SmsSettings } from './types'
import { uid } from './utils'

/**
 * Sends one SMS through the configured gateway and returns the log entry.
 *
 * The app runs entirely in the browser, so direct Twilio/MessageBird calls are
 * subject to CORS and expose the API credentials to anyone using this device.
 * For production, point the "Webhook" provider at a small server function that
 * holds the credentials and relays to the SMS provider.
 */
export async function dispatchSms(
  settings: SmsSettings,
  to: string,
  message: string,
  triggerEvent: string,
): Promise<SmsNotification> {
  const base = { id: uid('s'), recipientPhone: to, message, timestamp: new Date().toISOString(), triggerEvent }

  try {
    switch (settings.provider) {
      case 'none':
        return { ...base, status: 'queued', detail: 'No SMS gateway configured — logged only.' }

      case 'webhook': {
        if (!settings.webhookUrl) return { ...base, status: 'failed', detail: 'Webhook URL missing.' }
        const res = await fetch(settings.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, from: settings.fromNumber || undefined, message, event: triggerEvent }),
        })
        return res.ok
          ? { ...base, status: 'dispatched', detail: `Webhook HTTP ${res.status}` }
          : { ...base, status: 'failed', detail: `Webhook HTTP ${res.status}` }
      }

      case 'twilio': {
        const { twilioAccountSid: sid, twilioAuthToken: token, fromNumber } = settings
        if (!sid || !token || !fromNumber) return { ...base, status: 'failed', detail: 'Twilio SID, token or From number missing.' }
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + btoa(`${sid}:${token}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: fromNumber, Body: message }),
        })
        return res.ok
          ? { ...base, status: 'dispatched', detail: `Twilio HTTP ${res.status}` }
          : { ...base, status: 'failed', detail: `Twilio HTTP ${res.status}` }
      }

      case 'messagebird': {
        if (!settings.messageBirdKey || !settings.fromNumber) return { ...base, status: 'failed', detail: 'MessageBird key or originator missing.' }
        const res = await fetch('https://rest.messagebird.com/messages', {
          method: 'POST',
          headers: { Authorization: `AccessKey ${settings.messageBirdKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients: [to], originator: settings.fromNumber, body: message }),
        })
        return res.ok
          ? { ...base, status: 'dispatched', detail: `MessageBird HTTP ${res.status}` }
          : { ...base, status: 'failed', detail: `MessageBird HTTP ${res.status}` }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ...base, status: 'failed', detail: `${msg} — the browser may have blocked the request (CORS). Use a webhook relay.` }
  }
}
