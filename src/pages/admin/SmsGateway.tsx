import { useState } from 'react'
import { Plus, Smartphone, Trash2 } from 'lucide-react'
import { Empty, Field, PageHeader, Status } from '../../components/ui'
import { TextComposer } from '../../components/TextMessage'
import { useStore } from '../../lib/store'
import type { SmsSettings } from '../../lib/types'
import { fmtDateTime } from '../../lib/utils'

export function SmsGateway() {
  const { data, update, cloud } = useStore()
  const [s, setS] = useState<SmsSettings>(data.smsSettings)
  const [newNum, setNewNum] = useState('')
  // Anyone on file with a mobile: accounts first, then website requests.
  const contacts = [
    ...data.users.filter((u) => u.phone).map((u) => ({ key: `u:${u.id}`, label: `${u.name} (${u.role === 'provider' ? u.trade || 'trade' : u.role})`, phone: u.phone, name: u.name })),
    ...data.leads.filter((l) => l.phone && !l.clientId).map((l) => ({ key: `l:${l.id}`, label: `${l.name} (request #${l.number})`, phone: l.phone, name: l.name })),
  ].sort((a, b) => a.label.localeCompare(b.label))
  const [to, setTo] = useState({ key: '', phone: '' })
  const toContact = contacts.find((c) => c.key === to.key)
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(s) !== JSON.stringify(data.smsSettings)
  const set = (patch: Partial<SmsSettings>) => {
    setS({ ...s, ...patch })
    setSaved(false)
  }

  const save = () => {
    update((d) => { d.smsSettings = s })
    setSaved(true)
  }

  return (
    <>
      <PageHeader title="Text messages" subtitle="Texts go from your own number and stay in your iPhone's Messages." />
      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        <section className="card space-y-4 p-6 lg:col-span-3">
          <h2 className="font-bold">Send a text</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="To">
              <select className="input" value={to.key} onChange={(e) => setTo({ key: e.target.value, phone: contacts.find((c) => c.key === e.target.value)?.phone ?? '' })}>
                <option value="">Type a number…</option>
                {contacts.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Mobile">
              <input className="input num" type="tel" value={to.phone} onChange={(e) => setTo({ key: '', phone: e.target.value })} placeholder="04xx xxx xxx" />
            </Field>
          </div>
          {to.phone.replace(/\D/g, '').length >= 8 ? (
            <TextComposer key={to.key || 'typed'} phone={to.phone} initial={toContact ? `Hi ${toContact.name.split(' ')[0]}, it's Next Phase Maintenance. ` : 'Hi, it’s Next Phase Maintenance. '} />
          ) : (
            <p className="text-sm text-slate-500">Choose someone or type a mobile number.</p>
          )}
        </section>
        <section className="card h-fit space-y-3 p-6 text-sm text-slate-700 lg:col-span-2">
          <h2 className="flex items-center gap-2 font-bold"><Smartphone size={18} aria-hidden="true" /> How texting works</h2>
          <p>
            Wherever the portal texts someone (dispatching a trade, replying to a website request, sending an invite), it opens Messages on your iPhone
            with the number and text filled in. Check it, tap Send, and it goes from your normal number. The conversation stays in Messages, and replies
            come to your phone as usual.
          </p>
          <p className="text-xs text-slate-500">
            Using the portal on a computer? A Mac signed in to Messages works the same way. On Windows, use Copy text and send it from your phone.
          </p>
        </section>
      </div>

      <details className="card mb-8 p-6">
        <summary className="cursor-pointer font-bold">Automatic alerts (optional)</summary>
        <p className="mt-2 text-sm text-slate-600">
          The portal can also text alerts automatically (new requests to your admin phones). That needs an SMS provider with its own number, so
          those texts wouldn't come from your iPhone. Your inbox shows every alert either way.
        </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        <section className="space-y-5 lg:col-span-5">
          <h2 className="font-bold">Provider & credentials</h2>
          {cloud ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                Messages are sent by the secure <code className="font-mono">send-sms</code> server function. Your SMS credentials are stored as Supabase
                secrets and are never sent to anyone's browser.
              </p>
              <p className="text-xs text-slate-500">
                Twilio: set <code className="font-mono">TWILIO_ACCOUNT_SID</code>, <code className="font-mono">TWILIO_AUTH_TOKEN</code> and{' '}
                <code className="font-mono">TWILIO_FROM</code>. Any other provider: set <code className="font-mono">SMS_WEBHOOK_URL</code>. With neither set, messages
                are logged as “Queued”. See the README for setup steps.
              </p>
            </div>
          ) : (
            <>
            <Field label="SMS provider">
              <select className="input" value={s.provider} onChange={(e) => set({ provider: e.target.value as SmsSettings['provider'] })}>
                <option value="none">Not configured (log only)</option>
                <option value="webhook">Webhook relay</option>
              </select>
            </Field>
            {s.provider === 'webhook' && (
              <>
                <Field label="Webhook URL">
                  <input className="input num" type="url" value={s.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://…" />
                  <span className="mt-1 block text-xs text-slate-500">
                    Receives a POST with JSON <code className="font-mono">{'{ to, from, message, event }'}</code>.
                  </span>
                </Field>
                <Field label="From number">
                  <input className="input num" value={s.fromNumber} onChange={(e) => set({ fromNumber: e.target.value })} placeholder="+61…" />
                </Field>
              </>
            )}
            <p className="text-xs text-slate-500">
              Demo mode never stores SMS provider credentials in the browser. Twilio and other providers are set up in live mode, where a server
              function keeps the credentials secret. See the README.
            </p>
            </>
          )}

          <div className="space-y-2 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-bold">Triggers</h3>
            {(
              [
                ['notifyOnNewRequest', 'SMS admins when a client lodges a maintenance request'],
                ['notifyOnUrgentOnly', '…only for urgent requests'],
                ['notifyProviderOnAssign', 'After dispatching, offer to text the trade from my phone'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={s[k]} onChange={(e) => set({ [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>

          <div className="border-t border-slate-100 pt-5">
            <h3 className="text-sm font-bold">Admin recipient phones</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
              {s.recipients.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No numbers yet.</li>}
              {s.recipients.map((n) => (
                <li key={n} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="num">{n}</span>
                  <button className="text-slate-500 hover:text-red-600" onClick={() => set({ recipients: s.recipients.filter((x) => x !== n) })} aria-label={`Remove ${n}`}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const n = newNum.trim()
                if (n && !s.recipients.includes(n)) set({ recipients: [...s.recipients, n] })
                setNewNum('')
              }}
            >
              <input className="input num" type="tel" placeholder="+61 4xx xxx xxx" value={newNum} onChange={(e) => setNewNum(e.target.value)} />
              <button className="btn-ghost"><Plus size={16} /> Add</button>
            </form>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
            {saved && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
            <button className="btn-primary" onClick={save} disabled={!dirty}>Save settings</button>
          </div>
        </section>

      </div>
      </details>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Automatic alert log</h2>
          {data.sms.length > 0 && (
            <button className="text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => update((d) => { d.sms = [] })}>
              Clear log
            </button>
          )}
        </div>
        {data.sms.length === 0 ? (
          <Empty title="No automatic alerts yet">Texts you send from your phone are in your Messages app.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Time</th>
                  <th className="th">Trigger</th>
                  <th className="th">Recipient</th>
                  <th className="th">Message</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sms.slice(0, 200).map((m) => (
                  <tr key={m.id}>
                    <td className="td num whitespace-nowrap text-slate-600">{fmtDateTime(m.timestamp)}</td>
                    <td className="td whitespace-nowrap">{m.triggerEvent}</td>
                    <td className="td num whitespace-nowrap">{m.recipientPhone}</td>
                    <td className="td max-w-sm text-slate-700">{m.message}</td>
                    <td className="td">
                      <Status tone={m.status === 'dispatched' ? 'green' : m.status === 'failed' ? 'red' : 'slate'}>
                        {m.status === 'dispatched' ? 'Dispatched' : m.status === 'failed' ? 'Failed' : 'Queued'}
                      </Status>
                      {m.detail && <p className="mt-0.5 text-xs text-slate-500">{m.detail}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
