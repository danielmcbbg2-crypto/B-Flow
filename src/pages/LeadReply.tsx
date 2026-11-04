import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, MessageSquare } from 'lucide-react'
import { LogoMark } from '../components/Logo'
import { ANON_KEY, FUNCTIONS_URL } from '../lib/supabase'

/**
 * The reply page for a Service.com.au lead, opened from the link texted to the office. No sign-in:
 * the link is the key. Shows the job and Claude's drafted reply; "Copy & open job" copies the reply
 * and opens the job on Service.com.au to paste and submit, then the customer's number can be added
 * here to text them from Next Phase.
 */

type Reply = {
  lead: { number: number; name: string; suburb: string; services: string[]; urgency: string; jobUrl: string; hasPhone: boolean; createdAt: string }
  summary: string
  draft: string
  fit: 'good' | 'check' | 'skip'
  fitReason: string
  status: 'awaiting' | 'approved' | 'skipped'
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/service-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? `Something went wrong (${res.status})`)
  return out as T
}

const FIT = {
  good: { label: 'Good fit', cls: 'bg-emerald-100 text-emerald-800' },
  check: { label: 'Worth a check', cls: 'bg-amber-100 text-amber-800' },
  skip: { label: 'Probably skip', cls: 'bg-slate-200 text-slate-700' },
}

export function LeadReply({ token }: { token: string }) {
  const [reply, setReply] = useState<Reply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [phone, setPhone] = useState('')
  const [texted, setTexted] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.title = 'Reply to lead · Next Phase'
    call<Reply>({ action: 'get', token })
      .then((r) => {
        setReply(r)
        setDraft(r.draft)
        setTexted(r.lead.hasPhone)
      })
      .catch((e: Error) => setError(e.message))
  }, [token])

  // Copy and open in the tap itself (phones only allow both straight after a tap), then record it.
  const approve = () => {
    if (!reply) return
    navigator.clipboard?.writeText(draft).then(() => setCopied(true), () => setCopied(false))
    if (reply.lead.jobUrl) window.open(reply.lead.jobUrl, '_blank', 'noopener')
    call({ action: 'decide', token, decision: 'approve', draft })
      .then(() => setReply({ ...reply, draft, status: 'approved' }))
      .catch((e: Error) => setError(e.message))
  }

  const skip = () => {
    if (!reply) return
    call({ action: 'decide', token, decision: 'skip' })
      .then(() => setReply({ ...reply, status: 'skipped' }))
      .catch((e: Error) => setError(e.message))
  }

  const textCustomer = async () => {
    setBusy(true)
    setError(null)
    try {
      await call({ action: 'contact', token, phone })
      setTexted(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <LogoMark size={28} /> Service.com.au lead
        </div>

        {!reply && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {error && <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {reply && (
          <>
            <section className="space-y-2 border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-slate-900">
                  #{reply.lead.number} · {reply.lead.name}
                  {reply.lead.suburb ? `, ${reply.lead.suburb}` : ''}
                </span>
                <span className={`px-1.5 py-0.5 text-[11px] font-semibold ${FIT[reply.fit].cls}`}>{FIT[reply.fit].label}</span>
                {reply.lead.urgency === 'urgent' && <span className="bg-red-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-white">Urgent</span>}
              </div>
              <p className="text-sm text-slate-700">{reply.summary}</p>
              {reply.fitReason && <p className="text-xs text-slate-500">{reply.fitReason}</p>}
              {reply.lead.services.length > 0 && <p className="text-xs text-slate-500">{reply.lead.services.join(' · ')}</p>}
            </section>

            {reply.status === 'skipped' ? (
              <p className="border border-slate-200 bg-white p-4 text-sm text-slate-600">Skipped. It’s marked as lost in your leads.</p>
            ) : (
              <section className="space-y-3 border border-slate-200 bg-white p-4">
                <label className="block text-sm font-semibold text-slate-900" htmlFor="draft">
                  Your reply
                </label>
                <textarea id="draft" className="input min-h-[180px] w-full text-[15px] leading-relaxed" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button className="btn-accent w-full py-3 text-base" onClick={approve}>
                  {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  {reply.lead.jobUrl ? 'Copy reply & open job' : 'Copy reply'}
                  {reply.lead.jobUrl && <ExternalLink className="h-4 w-4" />}
                </button>
                {reply.status === 'approved' && (
                  <p className="text-sm text-slate-600">
                    {copied ? 'Copied. ' : ''}Paste it into <strong>Respond</strong> on the job in Service.com.au and submit
                    {reply.lead.jobUrl ? '.' : ' (open the job from the Service.com.au app or email).'}
                  </p>
                )}
                {reply.status === 'awaiting' && (
                  <button className="w-full text-center text-sm text-slate-500 underline" onClick={skip}>
                    Not for us, skip this lead
                  </button>
                )}
              </section>
            )}

            {reply.status === 'approved' && (
              <section className="space-y-3 border border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <MessageSquare className="h-4 w-4" /> Text them from Next Phase
                </p>
                {texted ? (
                  <p className="text-sm text-emerald-700">Done. They’ve been sent a text from Next Phase.</p>
                ) : (
                  <>
                    <p className="text-sm text-slate-600">Once you’ve submitted, Service.com.au shows their number. Paste it here and they’ll get a friendly text asking for photos.</p>
                    <input className="input w-full" type="tel" inputMode="tel" placeholder="04xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    <button className="btn-primary w-full" disabled={busy || phone.replace(/\D/g, '').length < 8} onClick={textCustomer}>
                      {busy ? 'Sending…' : 'Send text'}
                    </button>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
