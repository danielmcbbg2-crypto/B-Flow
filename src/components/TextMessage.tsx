import { useState } from 'react'
import { Copy, MessageSquare } from 'lucide-react'
import { useStore } from '../lib/store'

/**
 * A link that opens the device's Messages app with the number and text filled in, so the text goes
 * from the person's own phone number and stays in their Messages. "?&body=" works on iPhone and
 * Android alike.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${intlNumber(phone)}?&body=${encodeURIComponent(body)}`
}

/**
 * Australian numbers in international form (0433 555 642 → +61433555642), so Messages reads them the
 * same on any device, whatever its region (a Mac set to another country misreads 04… numbers).
 */
export function intlNumber(phone: string): string {
  const p = phone.replace(/[^\d+]/g, '')
  if (p.startsWith('+')) return p
  if (/^0[2-578]\d{8}$/.test(p)) return `+61${p.slice(1)}`
  if (/^61[2-578]\d{8}$/.test(p)) return `+${p}`
  return p
}

/**
 * A button that opens Messages with the text ready to send, and records it in the text log. `logAs`
 * replaces the text in the log, e.g. to leave a sign-in link out of it.
 */
export function TextButton({
  phone,
  message,
  event,
  logAs,
  label = 'Text',
  className = 'btn-ghost',
}: {
  phone: string
  message: string
  event: string
  logAs?: string
  label?: string
  className?: string
}) {
  const { logText } = useStore()
  if (!phone.trim()) return null
  return (
    <a className={className} href={smsHref(phone, message)} onClick={() => logText(phone, logAs ?? message, event)}>
      <MessageSquare size={15} aria-hidden="true" /> {label}
    </a>
  )
}

/** The text to send, editable, with a button to open it in Messages (and a copy fallback for computers without Messages). */
export function TextComposer({ phone, initial, event, sendLabel = 'Open in Messages' }: { phone: string; initial: string; event: string; sendLabel?: string }) {
  const [message, setMessage] = useState(initial)
  const { logText } = useStore()
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2">
      <textarea className="input min-h-[96px] text-sm" aria-label="Text message" value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <TextButton phone={phone} message={message} event={event} label={sendLabel} className="btn-accent" />
        <button
          type="button"
          className="btn-ghost"
          onClick={() =>
            navigator.clipboard
              ?.writeText(message)
              .then(() => {
                setCopied(true)
                logText(phone, message, `${event} (copied)`)
              })
              .catch(() => {})
          }
        >
          <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy text'}
        </button>
        <span className="num text-xs text-slate-500">{message.length} characters</span>
      </div>
      <p className="text-xs text-slate-500">
        Opens Messages on your iPhone (or a Mac with Messages) with the text ready: tap Send and it goes from your own number. On another computer,
        copy it and send it from your phone. Each one you open is kept in the text log.
      </p>
    </div>
  )
}
