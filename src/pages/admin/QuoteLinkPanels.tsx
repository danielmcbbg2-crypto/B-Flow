import { useState } from 'react'
import { Check, Copy, ExternalLink, Mail } from 'lucide-react'
import { Status, type Tone } from '../../components/ui'
import { TextButton } from '../../components/TextMessage'
import { useLookup, useStore } from '../../lib/store'
import { DEPOSIT_STATUS_LABEL, type DepositStatus, type Project } from '../../lib/types'
import { quoteTotal } from '../../lib/quote'
import { fmtDate, money } from '../../lib/utils'

export const quoteLink = (token: string) => `${window.location.origin}/#/quote/${token}`

/**
 * An issued quote's private link, for the client to read and accept it (no login needed): copy it,
 * or email or text it to the client with a short message. Sending it counts as a follow-up.
 */
export function SendQuoteLink({ p }: { p: Project }) {
  const { update } = useStore()
  const lk = useLookup()
  const [copied, setCopied] = useState(false)
  if (!p.quoteToken) return null
  const client = lk.user(p.clientId)
  const first = client?.name.split(' ')[0] || 'there'
  const link = quoteLink(p.quoteToken)
  const message = `Hi ${first}, it's Next Phase Maintenance. Your quote for ${p.title} is ready: ${money(quoteTotal(p))} inc. GST${
    p.quoteValidUntil ? `, valid until ${fmtDate(p.quoteValidUntil)}` : ''
  }. You can read it and accept it here: ${link}`
  const sent = () =>
    update((d) => {
      const x = d.projects.find((y) => y.id === p.id)
      if (x) x.quoteFollowedUpAt = new Date().toISOString()
    })
  const copy = async () => {
    await navigator.clipboard?.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <span className="mr-auto flex flex-wrap items-center gap-2 text-sm" aria-label="Send the quote link">
      <span className="text-slate-600">Send the quote{client ? ` to ${client.name}` : ''}:</span>
      {client?.email && (
        <a className="btn-ghost px-3 py-1.5" href={`mailto:${client.email}?subject=${encodeURIComponent(`Your quote P-${p.number}: ${p.title}`)}&body=${encodeURIComponent(message)}`} onClick={sent}>
          <Mail size={15} aria-hidden="true" /> Email
        </a>
      )}
      {client?.phone && <TextButton phone={client.phone} message={message} event={`Quote P-${p.number}`} label="Text" className="btn-ghost px-3 py-1.5" onOpen={sent} />}
      <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => void copy()}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? 'Copied' : 'Copy link'}
      </button>
      <a className="text-xs text-slate-500 underline" href={link} target="_blank" rel="noreferrer">
        Preview <ExternalLink size={11} className="inline" aria-hidden="true" />
      </a>
    </span>
  )
}

const DEPOSIT_TONE: Record<DepositStatus, Tone> = {
  none: 'slate',
  pending: 'slate',
  working: 'slate',
  sent: 'outline',
  failed: 'red',
  held: 'orange',
  paid: 'green',
  skipped: 'slate',
}

/** An accepted quote's deposit invoice: what it's for, where it's up to, its pay link, and Send. */
export function DepositPanel({ p }: { p: Project }) {
  const { data, sendQuoteDeposit, cloud } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!['approved', 'in_progress', 'completed'].includes(p.status) || !p.deposit) return null
  const d = p.deposit
  const inv = d.invoiceId ? data.invoices.find((i) => i.id === d.invoiceId) : undefined
  const canSend = ['none', 'failed', 'held', 'skipped'].includes(d.status) && cloud
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sendQuoteDeposit(p.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mb-5 rounded-md border border-slate-200 p-3 text-sm" aria-label="Deposit invoice">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Deposit</span>
        <Status tone={DEPOSIT_TONE[d.status]}>{DEPOSIT_STATUS_LABEL[d.status]}</Status>
        {d.amount ? <span className="num">{money(d.amount)} inc. GST</span> : null}
        {inv && <span className="num text-slate-600">· invoice {inv.qbInvoiceNumber}</span>}
        {p.quoteAnsweredName && <span className="text-slate-500">· accepted by {p.quoteAnsweredName} from the link</span>}
        {inv?.payLink && d.status === 'sent' && (
          <a className="ml-auto font-semibold underline" href={inv.payLink} target="_blank" rel="noreferrer">Pay link</a>
        )}
        {canSend && (
          <button type="button" className="btn-ghost ml-auto px-3 py-1 text-xs" disabled={busy} onClick={() => void send()}>
            {busy ? 'Sending…' : d.status === 'failed' ? 'Try again' : 'Send deposit invoice'}
          </button>
        )}
      </div>
      {d.status === 'sent' && <p className="mt-1 text-slate-600">Emailed from QuickBooks with its pay link. It’s marked paid here once it’s paid.</p>}
      {d.status === 'none' && <p className="mt-1 text-slate-600">Accepted before deposits were sent automatically, or it came to $0.</p>}
      {d.status === 'skipped' && <p className="mt-1 text-slate-600">Accepted before QuickBooks was connected.</p>}
      {d.error && <p className={d.status === 'held' ? 'mt-1 text-amber-800' : 'mt-1 text-red-600'}>{d.error}</p>}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </section>
  )
}

/** The quote as a QuickBooks estimate: its number, or why it didn't go, with Try again. */
export function EstimateLine({ p }: { p: Project }) {
  const { retryQuoteEstimate } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const e = p.estimate
  if (!e || e.status === 'none') return null
  const retry = async () => {
    setBusy(true)
    setError(null)
    try {
      await retryQuoteEstimate(p.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="mr-auto flex flex-wrap items-center gap-2 text-xs text-slate-500" aria-label="QuickBooks estimate">
      {e.status === 'synced' && <>QuickBooks estimate <span className="num font-semibold text-slate-700">{e.number}</span></>}
      {(e.status === 'pending' || e.status === 'working') && 'Updating its QuickBooks estimate…'}
      {e.status === 'skipped' && 'Not in QuickBooks (issued before it was connected).'}
      {e.status === 'failed' && <span className="text-red-600">QuickBooks estimate failed: {e.error}</span>}
      {(e.status === 'failed' || e.status === 'skipped') && (
        <button type="button" className="underline" disabled={busy} onClick={() => void retry()}>{busy ? 'Sending…' : e.status === 'failed' ? 'Try again' : 'Add it to QuickBooks'}</button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  )
}

