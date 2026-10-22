import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, CheckCircle2, Clock3, FileText, ShieldCheck } from 'lucide-react'
import { BRAND, SITE_SERVICES } from '../lib/brand'
import { useStore, type LeadInput } from '../lib/store'
import { LEAD_URGENCY_LABEL, type LeadUrgency } from '../lib/types'

const PROMISES = [
  { icon: Clock3, title: 'A reply within one business day', body: 'A real person from our Melbourne office, not an auto-responder.' },
  { icon: FileText, title: 'Clear, itemised quotes', body: 'Every line priced, GST shown, no surprises once work starts.' },
  { icon: ShieldCheck, title: 'Licensed & insured trades', body: 'Plumbers, electricians and carpenters we know and stand behind.' },
]

const URGENCIES: LeadUrgency[] = ['urgent', 'soon', 'flexible']

const blank = (): LeadInput & { website: string } => ({
  name: '',
  email: '',
  phone: '',
  company: '',
  suburb: '',
  services: [],
  urgency: 'soon',
  contactBy: 'phone',
  message: '',
  website: '',
})

/** A row of buttons that act like radio buttons or checkboxes, styled as one segmented control. */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border px-3.5 py-2 text-sm transition-colors ${
        on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900'
      }`}
    >
      {on && <Check size={14} aria-hidden="true" />}
      {children}
    </button>
  )
}

/** Home page: a quote request from someone without an account, sent straight to the office. */
export function LeadCapture({ onSignIn }: { onSignIn: () => void }) {
  const { submitLead } = useStore()
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ number: number; name: string; contact: string } | null>(null)
  const set = (patch: Partial<typeof f>) => {
    setF((cur) => ({ ...cur, ...patch }))
    setError(null)
  }
  const toggleService = (s: string) => set({ services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s] })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    // A filled-in hidden field means a bot: look as if it worked and send nothing.
    if (f.website) return setSent({ number: 0, name: f.name, contact: '' })
    if (!f.name.trim()) return setError('Enter your name.')
    if (!f.phone.trim() && !f.email.trim()) return setError('Leave a phone number or email so we can reply.')
    setBusy(true)
    setError(null)
    try {
      const lead: LeadInput = { name: f.name, email: f.email, phone: f.phone, company: f.company, suburb: f.suburb, services: f.services, urgency: f.urgency, contactBy: f.contactBy, message: f.message }
      const contactBy = lead.contactBy === 'phone' && !lead.phone.trim() ? 'email' : lead.contactBy === 'email' && !lead.email.trim() ? 'phone' : lead.contactBy
      const { number } = await submitLead({ ...lead, contactBy })
      setSent({ number, name: lead.name.trim().split(/\s+/)[0], contact: contactBy === 'phone' ? `call you on ${lead.phone.trim()}` : `email you at ${lead.email.trim()}` })
      setF(blank())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="quote" className="scroll-mt-16 bg-slate-900 text-white" aria-labelledby="quote-title">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[5fr_7fr] lg:gap-16">
        <div className="lg:pt-6">
          <p className="text-sm uppercase tracking-[0.2em] text-accent">Free quote · No account needed</p>
          <h2 id="quote-title" className="mt-4 text-4xl font-bold leading-[1.15] sm:text-[42px]">Tell us about the job.</h2>
          <p className="mt-6 max-w-md text-base font-light leading-[1.8] text-white/80">
            Repairs, renovations or a maintenance plan for your properties: send a few details and we'll come back to you with next steps and a quote.
          </p>
          <ul className="mt-10 space-y-6">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-white/20">
                  <Icon size={20} strokeWidth={1.5} className="text-accent" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="mt-0.5 text-sm font-light leading-relaxed text-white/70">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-white/60">
            Already a client?{' '}
            <button type="button" className="text-white underline underline-offset-4 hover:text-accent" onClick={onSignIn}>
              Sign in to lodge a request
            </button>
          </p>
        </div>

        <div className="bg-white p-6 text-slate-900 shadow-2xl sm:p-10">
          {sent ? (
            <div className="flex min-h-[420px] flex-col items-start justify-center" role="status">
              <CheckCircle2 size={44} strokeWidth={1.25} className="text-accent" aria-hidden="true" />
              <h3 className="mt-6 text-2xl font-bold">Thanks{sent.name ? `, ${sent.name}` : ''}. We've got it.</h3>
              {sent.number > 0 && <p className="num mt-2 text-sm text-slate-500">Enquiry #{sent.number}</p>}
              <p className="mt-4 max-w-md font-light leading-[1.8]">
                {sent.contact ? `We'll ${sent.contact} within one business day.` : "We'll be in touch within one business day."}
                {BRAND.phone && <> For anything urgent, call us on <a className="font-normal underline underline-offset-4" href={`tel:${BRAND.phone.replace(/\s/g, '')}`}>{BRAND.phone}</a>.</>}
              </p>
              <button type="button" className="btn-ghost mt-8" onClick={() => setSent(null)}>
                Send another enquiry
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-7" noValidate>
              <fieldset>
                <legend className="text-sm font-semibold">What do you need?</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SITE_SERVICES.map((s) => (
                    <Choice key={s} on={f.services.includes(s)} onClick={() => toggleService(s)}>
                      {s.replace(/ Services$/, '')}
                    </Choice>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-sm font-semibold">How soon?</legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {URGENCIES.map((u) => (
                    <Choice key={u} on={f.urgency === u} onClick={() => set({ urgency: u })}>
                      {LEAD_URGENCY_LABEL[u]}
                    </Choice>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Your name</span>
                  <input className="input" required autoComplete="name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Company (optional)</span>
                  <input className="input" autoComplete="organization" value={f.company} onChange={(e) => set({ company: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Mobile</span>
                  <input className="input num" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Email</span>
                  <input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => set({ email: e.target.value })} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label">Suburb</span>
                  <input className="input" autoComplete="address-level2" value={f.suburb} onChange={(e) => set({ suburb: e.target.value })} placeholder="e.g. Carlton" />
                </label>
                <label className="block sm:col-span-2">
                  <span className="label">About the job</span>
                  <textarea
                    className="input min-h-[110px]"
                    maxLength={2000}
                    value={f.message}
                    onChange={(e) => set({ message: e.target.value })}
                    placeholder="What needs doing, the type of property, any access details…"
                  />
                </label>
                {/* Hidden from people; bots fill it in. */}
                <label className="hidden" aria-hidden="true">
                  Website
                  <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set({ website: e.target.value })} />
                </label>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold">Best way to reach you</legend>
                <div className="mt-3 flex gap-2">
                  <Choice on={f.contactBy === 'phone'} onClick={() => set({ contactBy: 'phone' })}>Phone</Choice>
                  <Choice on={f.contactBy === 'email'} onClick={() => set({ contactBy: 'email' })}>Email</Choice>
                </div>
              </fieldset>
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <div className="flex flex-col gap-4 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-relaxed text-slate-500 sm:max-w-xs">We only use your details to reply to this enquiry. No account or sign-up needed.</p>
                <button className="btn-accent shrink-0 px-7 py-3.5 text-base font-normal" disabled={busy}>
                  {busy ? 'Sending…' : 'Send enquiry'} {!busy && <ArrowRight size={16} />}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
