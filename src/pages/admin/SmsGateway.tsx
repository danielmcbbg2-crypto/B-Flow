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
            <TextComposer key={to.key || 'typed'} phone={to.phone} event={toContact ? `Text to ${toContact.name}` : 'Text'} initial={toContact ? `Hi ${toContact.name.split(' ')[0]}, it's Next Phase Maintenance. ` : 'Hi, it’s Next Phase Maintenance. '} />
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

      <section className="mb-8">
        <h2 className="mb-1 font-bold">Text log</h2>
        <p className="mb-3 text-sm text-slate-500">
          Every text opened in Messages from the portal: who opened it, to whom and when. The portal can't see whether you tapped Send; your Messages
          app has the conversation. Entries can't be changed or deleted.
        </p>
        {data.texts.length === 0 ? (
          <Empty title="No texts yet">Texts you open from the portal are listed here.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="th">Opened</th>
                  <th className="th">By</th>
                  <th className="th">To</th>
                  <th className="th">For</th>
                  <th className="th">Text</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.texts.slice(0, 200).map((t) => {
                  const digits = t.to.replace(/\D/g, '')
                  const who = data.users.find((u) => u.phone && u.phone.replace(/\D/g, '') === digits)
                  return (
                    <tr key={t.id}>
                      <td className="td num whitespace-nowrap text-slate-600">{fmtDateTime(t.openedAt)}</td>
                      <td className="td whitespace-nowrap">{data.users.find((u) => u.id === t.openedBy)?.name ?? '—'}</td>
                      <td className="td whitespace-nowrap">
                        {who && <p>{who.name}</p>}
                        <p className="num text-xs text-slate-500">{t.to}</p>
                      </td>
                      <td className="td whitespace-nowrap">{t.event}</td>
                      <td className="td max-w-sm whitespace-pre-wrap text-slate-700">{t.message}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="card mb-8 p-6" open>
        <summary className="cursor-pointer font-bold">Automatic texts (ClickSend)</summary>
        <p className="mt-2 text-sm text-slate-600">
          Some texts go out on their own, without you tapping Send: booking reminders the afternoon before, alerts to your admin phones, and (if you
          switch it on) a reply to new website enquiries. ClickSend sends these from your own mobile number, so replies still come to your phone. They
          won't show in your iPhone's Messages; they're listed in the automatic text log below. Texts you write yourself still open in Messages.
        </p>
      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        <section className="space-y-5 lg:col-span-5">
          <h2 className="font-bold">Provider & credentials</h2>
          {cloud ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                Automatic texts are sent by the portal's server functions through ClickSend. Your ClickSend login is stored as Supabase secrets and is never
                sent to anyone's browser.
              </p>
              <p className="text-xs text-slate-500">
                Set <code className="font-mono">CLICKSEND_USERNAME</code>, <code className="font-mono">CLICKSEND_API_KEY</code> and{' '}
                <code className="font-mono">CLICKSEND_FROM</code> (your mobile, verified in ClickSend as a sender) under Edge Functions → Secrets. Until
                they're set, automatic texts are logged as “Queued” and not sent. See the README for the steps.
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
              Demo mode never stores SMS provider credentials in the browser. ClickSend is set up in live mode, where the server keeps the login secret.
              See the README.
            </p>
            </>
          )}

          <div className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-bold">What's texted automatically</h3>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-slate-900" checked={s.bookingReminderTexts} onChange={(e) => set({ bookingReminderTexts: e.target.checked })} />
              <span>
                Booking reminders: text the trade and the client the afternoon before each booking (project tasks and scheduled maintenance jobs)
                <span className="block text-xs text-slate-500">Everyone with a mobile on file, including people without a portal login. Each booking is texted once per person.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-slate-900" checked={s.autoReply} onChange={(e) => set({ autoReply: e.target.checked })} />
              <span>
                Website enquiries: text people back straight away when they send a maintenance request
              </span>
            </label>
            {s.autoReply && (
              <Field label="Reply text ({first_name} is filled in)">
                <textarea className="input min-h-[80px] text-sm" maxLength={480} value={s.autoReplyMessage} onChange={(e) => set({ autoReplyMessage: e.target.value })} />
              </Field>
            )}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-bold">Office alerts</h3>
            {(
              [
                ['notifyOnNewRequest', 'Text the admin phones below when a client lodges a maintenance request'],
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
          <h2 className="font-bold">Automatic text log</h2>
          {data.sms.length > 0 && (
            <button className="text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => update((d) => { d.sms = [] })}>
              Clear log
            </button>
          )}
        </div>
        {data.sms.length === 0 ? (
          <Empty title="No automatic texts yet">Texts you send from your phone are in your Messages app.</Empty>
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
