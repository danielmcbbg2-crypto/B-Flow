import { useState } from 'react'
import { BellRing, Send } from 'lucide-react'
import { Empty, Field, Modal, PageHeader, Tabs } from '../../components/ui'
import { RequestDetail, RequestRow } from '../../components/works'
import { hasNoLogin, useLookup, useStore } from '../../lib/store'
import { REQUEST_STATUS_LABEL, type MaintenanceRequest, type RequestStatus } from '../../lib/types'
import { todayISO } from '../../lib/utils'

export function Dispatch() {
  const { data, can, update, notifyAdmins } = useStore()
  const lk = useLookup()
  const [tab, setTab] = useState<'triage' | 'live' | 'completed'>('triage')
  const [openId, setOpenId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<MaintenanceRequest | null>(null)
  const [notes, setNotes] = useState('')

  const triage = data.requests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.urgency === b.urgency ? b.createdAt.localeCompare(a.createdAt) : a.urgency === 'urgent' ? -1 : 1))
  const live = data.requests.filter((r) => r.status !== 'pending' && r.status !== 'completed')
  const completed = data.requests.filter((r) => r.status === 'completed')
  const list = tab === 'triage' ? triage : tab === 'live' ? live : completed
  const open = lk.request(openId ?? undefined)

  const resendAlert = async (r: MaintenanceRequest) => {
    const p = lk.property(r.propertyId)
    await notifyAdmins(`NPM #${r.number}${r.urgency === 'urgent' ? ' URGENT' : ''} — ${r.title}${p ? ` · ${p.address}, ${p.suburb}` : ''}`, 'Manual re-alert')
    update((d) => {
      const x = d.requests.find((y) => y.id === r.id)
      if (x) x.smsNotified = true
    })
  }

  return (
    <>
      <PageHeader title="Triage & dispatch" subtitle="Assign the right trade, schedule the visit and notify everyone in one step." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'triage', label: 'Triage', count: triage.length },
          { value: 'live', label: 'Assigned & in progress', count: live.length },
          { value: 'completed', label: 'Completed', count: completed.length },
        ]}
      />
      {list.length === 0 ? (
        <Empty title="Nothing here" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map((r) => {
            const prov = lk.user(r.assignedProviderId)
            return (
              <RequestRow
                key={r.id}
                r={r}
                onOpen={() => { setOpenId(r.id); setNotes(r.notes) }}
                right={
                  <>
                    {prov && <span className="text-sm text-slate-600">{prov.name}</span>}
                    {can('canDispatchJobs') && r.status !== 'completed' && (
                      <button className={r.status === 'pending' ? 'btn-accent' : 'btn-ghost'} onClick={() => setAssigning(r)}>
                        {r.status === 'pending' ? 'Assign' : 'Reassign'}
                      </button>
                    )}
                  </>
                }
              />
            )
          })}
        </div>
      )}

      <RequestDetail r={open} open={!!open} onClose={() => setOpenId(null)}>
        {open && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <select
                  className="input"
                  value={open.status}
                  onChange={(e) =>
                    update((d) => {
                      const x = d.requests.find((y) => y.id === open.id)!
                      x.status = e.target.value as RequestStatus
                      if (x.status === 'completed' && !x.completedAt) x.completedAt = new Date().toISOString()
                    })
                  }
                >
                  {(Object.keys(REQUEST_STATUS_LABEL) as RequestStatus[]).map((s) => (
                    <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Scheduled date">
                <input
                  type="date"
                  className="input num"
                  value={open.scheduledDate ?? ''}
                  onChange={(e) => update((d) => { d.requests.find((y) => y.id === open.id)!.scheduledDate = e.target.value || undefined })}
                />
              </Field>
            </div>
            <Field label="Office notes (visible to client & trade)">
              <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-ghost" onClick={() => resendAlert(open)}><BellRing size={16} /> SMS admin alert</button>
              {open.status !== 'completed' && can('canDispatchJobs') && (
                <button className="btn-ghost" onClick={() => { setAssigning(open); setOpenId(null) }}>Assign trade</button>
              )}
              <button className="btn-primary" onClick={() => update((d) => { d.requests.find((y) => y.id === open.id)!.notes = notes })} disabled={notes === open.notes}>
                Save notes
              </button>
            </div>
          </div>
        )}
      </RequestDetail>

      <AssignModal r={assigning} onClose={() => setAssigning(null)} />
    </>
  )
}

function AssignModal({ r, onClose }: { r: MaintenanceRequest | null; onClose: () => void }) {
  if (!r) return null
  return <AssignForm key={r.id} r={r} onClose={onClose} />
}

function AssignForm({ r, onClose }: { r: MaintenanceRequest; onClose: () => void }) {
  const { assignRequest, data } = useStore()
  const lk = useLookup()
  const matching = lk.providers.filter((p) => p.trade === r.category)
  const others = lk.providers.filter((p) => p.trade !== r.category)
  // The current trade if they can still be chosen (so the list shows who the job goes to).
  const current = lk.providers.some((p) => p.id === r.assignedProviderId) ? r.assignedProviderId : undefined
  const [providerId, setProviderId] = useState(current ?? matching[0]?.id ?? lk.providers[0]?.id ?? '')
  const [date, setDate] = useState(r.scheduledDate ?? todayISO())
  const [sms, setSms] = useState(data.smsSettings.notifyProviderOnAssign)
  const [busy, setBusy] = useState(false)
  const chosen = lk.user(providerId)

  return (
    <Modal open onClose={onClose} title={`Assign #${r.number}`}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          await assignRequest(r.id, providerId, date, sms)
          setBusy(false)
          onClose()
        }}
      >
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{r.title}</span> · {r.category}
        </p>
        {lk.providers.length === 0 ? (
          <p className="text-sm text-slate-500">No service providers yet. Add one from Accounts.</p>
        ) : (
          <Field label="Service provider">
            <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)} required>
              {matching.length > 0 && (
                <optgroup label={`${r.category} trades`}>
                  {matching.map((p) => <option key={p.id} value={p.id}>{p.name}{p.company ? ` — ${p.company}` : ''}{hasNoLogin(p) ? ' (no login)' : p.status === 'invited' ? ' (invite pending)' : ''}</option>)}
                </optgroup>
              )}
              <optgroup label="Other trades">
                {others.map((p) => <option key={p.id} value={p.id}>{p.name}{p.company ? ` — ${p.company}` : ''}{p.trade ? ` (${p.trade})` : ''}{hasNoLogin(p) ? ' (no login)' : p.status === 'invited' ? ' (invite pending)' : ''}</option>)}
              </optgroup>
            </select>
          </Field>
        )}
        <Field label="Scheduled visit">
          <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-slate-900" checked={sms} onChange={(e) => setSms(e.target.checked)} />
          SMS the provider{chosen?.phone ? <span className="num text-slate-500"> ({chosen.phone})</span> : <span className="text-slate-500"> (no phone on file)</span>}
        </label>
        <p className="text-xs text-slate-500">
          The provider also gets a work order in their Inbox to acknowledge
          {chosen && hasNoLogin(chosen) ? ', which they’ll see once you invite them from Accounts' : chosen?.status === 'invited' ? ', which they’ll see once they accept their invite' : ''}.
        </p>
        <div className="flex justify-end">
          <button className="btn-accent" disabled={busy || !providerId}><Send size={16} /> {busy ? 'Dispatching…' : 'Dispatch'}</button>
        </div>
      </form>
    </Modal>
  )
}
