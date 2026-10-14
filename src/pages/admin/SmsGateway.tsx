import { useState } from 'react'
import { Plus, Send, Trash2, TriangleAlert } from 'lucide-react'
import { Empty, Field, PageHeader, Status } from '../../components/ui'
import { useStore } from '../../lib/store'
import type { SmsSettings } from '../../lib/types'
import { fmtDateTime } from '../../lib/utils'

export function SmsGateway() {
  const { data, update, sendSms } = useStore()
  const [s, setS] = useState<SmsSettings>(data.smsSettings)
  const [newNum, setNewNum] = useState('')
  const [test, setTest] = useState({ to: data.smsSettings.recipients[0] ?? '', message: 'Test message from Next Phase Maintenance ops.' })
  const [sending, setSending] = useState(false)
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
      <PageHeader title="SMS gateway" subtitle="Alerts for new requests and dispatches, sent to your linked admin phones." />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card space-y-5 p-6 lg:col-span-3">
          <h2 className="font-bold">Provider & credentials</h2>
          <Field label="SMS provider">
            <select className="input" value={s.provider} onChange={(e) => set({ provider: e.target.value as SmsSettings['provider'] })}>
              <option value="none">Not configured (log only)</option>
              <option value="webhook">Custom webhook (recommended)</option>
              <option value="twilio">Twilio</option>
              <option value="messagebird">MessageBird</option>
            </select>
          </Field>
          {s.provider === 'twilio' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account SID"><input className="input num" value={s.twilioAccountSid} onChange={(e) => set({ twilioAccountSid: e.target.value })} placeholder="AC…" /></Field>
              <Field label="Auth token"><input className="input num" type="password" autoComplete="off" value={s.twilioAuthToken} onChange={(e) => set({ twilioAuthToken: e.target.value })} /></Field>
            </div>
          )}
          {s.provider === 'messagebird' && (
            <Field label="Access key"><input className="input num" type="password" autoComplete="off" value={s.messageBirdKey} onChange={(e) => set({ messageBirdKey: e.target.value })} /></Field>
          )}
          {s.provider === 'webhook' && (
            <Field label="Webhook URL">
              <input className="input num" type="url" value={s.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://…" />
              <span className="mt-1 block text-xs text-slate-500">
                Receives a POST with JSON <code className="num">{'{ to, from, message, event }'}</code>.
              </span>
            </Field>
          )}
          {s.provider !== 'none' && (
            <Field label={s.provider === 'messagebird' ? 'Originator' : 'From number'}>
              <input className="input num" value={s.fromNumber} onChange={(e) => set({ fromNumber: e.target.value })} placeholder="+61…" />
            </Field>
          )}
          {(s.provider === 'twilio' || s.provider === 'messagebird') && (
            <p className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <TriangleAlert size={16} className="shrink-0" />
              This app runs in the browser, so these credentials are stored on this device and browsers often block direct calls to SMS APIs.
              For production, use a webhook relay (a small server function) that keeps the credentials off the device.
            </p>
          )}

          <div className="space-y-2 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-bold">Triggers</h3>
            {(
              [
                ['notifyOnNewRequest', 'SMS admins when a client lodges a maintenance request'],
                ['notifyOnUrgentOnly', '…only for urgent requests'],
                ['notifyProviderOnAssign', 'Offer SMS to provider on dispatch by default'],
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
                  <button className="text-slate-400 hover:text-red-600" onClick={() => set({ recipients: s.recipients.filter((x) => x !== n) })} aria-label={`Remove ${n}`}>
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

        <section className="card h-fit space-y-4 p-6 lg:col-span-2">
          <h2 className="font-bold">Send a test</h2>
          <p className="text-xs text-slate-500">Uses the saved settings.{dirty && ' Save your changes first.'}</p>
          <Field label="To"><input className="input num" type="tel" value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} /></Field>
          <Field label="Message">
            <textarea className="input" maxLength={320} value={test.message} onChange={(e) => setTest({ ...test, message: e.target.value })} />
            <span className="num mt-1 block text-right text-xs text-slate-400">{test.message.length}/160</span>
          </Field>
          <button
            className="btn-accent w-full"
            disabled={sending || !test.to || !test.message}
            onClick={async () => {
              setSending(true)
              await sendSms(test.to, test.message, 'Test send')
              setSending(false)
            }}
          >
            <Send size={16} /> {sending ? 'Sending…' : 'Send test SMS'}
          </button>
        </section>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Dispatch log</h2>
          {data.sms.length > 0 && (
            <button className="text-sm font-semibold text-slate-500 hover:text-slate-900" onClick={() => update((d) => { d.sms = [] })}>
              Clear log
            </button>
          )}
        </div>
        {data.sms.length === 0 ? (
          <Empty title="No messages sent yet" />
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
