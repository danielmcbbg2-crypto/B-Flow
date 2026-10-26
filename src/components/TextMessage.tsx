import { useState } from 'react'
import { Copy, MessageSquare } from 'lucide-react'

/**
 * A link that opens the device's Messages app with the number and text filled in, so the text goes
 * from the person's own phone number and stays in their Messages. "?&body=" works on iPhone and
 * Android alike.
 */
export function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`
}

/** A button that opens Messages with the text ready to send. */
export function TextButton({ phone, message, label = 'Text', className = 'btn-ghost' }: { phone: string; message: string; label?: string; className?: string }) {
  if (!phone.trim()) return null
  return (
    <a className={className} href={smsHref(phone, message)}>
      <MessageSquare size={15} aria-hidden="true" /> {label}
    </a>
  )
}

/** The text to send, editable, with a button to open it in Messages (and a copy fallback for computers without Messages). */
export function TextComposer({ phone, initial, sendLabel = 'Open in Messages' }: { phone: string; initial: string; sendLabel?: string }) {
  const [message, setMessage] = useState(initial)
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-2">
      <textarea className="input min-h-[96px] text-sm" aria-label="Text message" value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <TextButton phone={phone} message={message} label={sendLabel} className="btn-accent" />
        <button
          type="button"
          className="btn-ghost"
          onClick={() => navigator.clipboard?.writeText(message).then(() => setCopied(true)).catch(() => {})}
        >
          <Copy size={15} aria-hidden="true" /> {copied ? 'Copied' : 'Copy text'}
        </button>
        <span className="num text-xs text-slate-500">{message.length} characters</span>
      </div>
      <p className="text-xs text-slate-500">
        Opens Messages on your iPhone (or a Mac with Messages) with the text ready: tap Send and it goes from your own number. On another computer,
        copy it and send it from your phone.
      </p>
    </div>
  )
}
