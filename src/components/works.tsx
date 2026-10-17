import { useCallback, useMemo, type ReactNode } from 'react'
import { Camera } from 'lucide-react'
import type { MaintenanceRequest, Project } from '../lib/types'
import { useLookup, useStore } from '../lib/store'
import { cx, fmtDate, fmtDateTime } from '../lib/utils'
import { RequestStatusText, Urgency } from './status'
import { Modal, PhotoStrip, Sep } from './ui'
import type { CalEvent } from './Calendar'

export function RequestRow({ r, onOpen, right }: { r: MaintenanceRequest; onOpen: () => void; right?: ReactNode }) {
  const lk = useLookup()
  const prop = lk.property(r.propertyId)
  return (
    <div className="flex flex-col gap-3 px-5 py-4 hover:bg-slate-50 sm:flex-row sm:items-center">
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-xs text-slate-500">#{r.number}</span>
          <Urgency u={r.urgency} />
          <RequestStatusText s={r.status} />
          {r.photos.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Camera size={13} />
              <span className="num">{r.photos.length}</span>
            </span>
          )}
        </div>
        <p className="mt-1 truncate font-semibold text-slate-900">{r.title}</p>
        <p className="mt-0.5 text-sm text-slate-500 sm:truncate">
          {prop ? `${prop.address}, ${prop.suburb}` : 'Unknown property'}
          <Sep />
          {r.category}
          {r.scheduledDate && (
            <>
              <Sep />
              <span className="num whitespace-nowrap">{fmtDate(r.scheduledDate)}</span>
            </>
          )}
        </p>
      </button>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

export function RequestDetail({
  r,
  open,
  onClose,
  children,
}: {
  r: MaintenanceRequest | undefined
  open: boolean
  onClose: () => void
  children?: ReactNode
}) {
  const lk = useLookup()
  if (!r) return null
  const prop = lk.property(r.propertyId)
  const client = lk.user(r.clientId)
  const provider = lk.user(r.assignedProviderId)
  const rows: [string, ReactNode][] = [
    ['Status', <RequestStatusText s={r.status} />],
    ['Priority', <Urgency u={r.urgency} />],
    ['Trade', r.category],
    ['Property', prop ? `${prop.address}, ${prop.suburb} ${prop.postcode}` : '—'],
    ['Access', prop?.accessCode || '—'],
    ['Client', client ? `${client.name}${client.phone ? ` · ${client.phone}` : ''}` : '—'],
    ['Service provider', provider ? `${provider.name}${provider.company ? ` · ${provider.company}` : ''}` : 'Unassigned'],
    ['Scheduled', <span className="num">{fmtDate(r.scheduledDate)}</span>],
    ['Lodged', <span className="num">{fmtDateTime(r.createdAt)}</span>],
  ]
  // An admin lodged it from the client's dashboard.
  if (r.createdBy && r.createdBy !== r.clientId) rows.push(['Lodged by', lk.byName(r.createdBy)])
  return (
    <Modal open={open} onClose={onClose} title={`Work order #${r.number}`} width="max-w-2xl">
      <h3 className="text-lg font-bold">{r.title}</h3>
      {r.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{r.description}</p>}
      <dl className="mt-4 grid gap-x-6 gap-y-2 border-y border-slate-200 py-4 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 sm:block">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
            <dd className="text-right text-slate-800 sm:text-left">{v}</dd>
          </div>
        ))}
      </dl>
      {r.photos.length > 0 && (
        <div className="mt-4">
          <p className="label">Request photos</p>
          <PhotoStrip photos={r.photos} />
        </div>
      )}
      {r.completionPhotos.length > 0 && (
        <div className="mt-4">
          <p className="label">Completion photos</p>
          <PhotoStrip photos={r.completionPhotos} />
        </div>
      )}
      {r.notes && (
        <div className="mt-4">
          <p className="label">Notes</p>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{r.notes}</p>
        </div>
      )}
      {children && <div className="mt-5 border-t border-slate-200 pt-5">{children}</div>}
    </Modal>
  )
}

/** Says who added a project or answered its quote when that wasn't the client (an admin from their dashboard). */
export function ProjectBy({ p, className }: { p: Project; className?: string }) {
  const lk = useLookup()
  const answered = p.quoteDecision && p.status !== 'quote_requested' && p.status !== 'quoted'
  const parts = [
    p.createdBy && p.createdBy !== p.clientId ? `Added by ${lk.byName(p.createdBy)}` : '',
    answered && p.quoteDecidedBy && p.quoteDecidedBy !== p.clientId
      ? `Quote ${p.quoteDecision === 'rejected' ? 'declined' : 'accepted'} by ${lk.byName(p.quoteDecidedBy)}`
      : '',
  ].filter(Boolean)
  if (!parts.length) return null
  return <p className={cx('text-xs text-slate-500', className)}>{parts.join(' · ')}</p>
}

/** Builds calendar events from requests & project milestones, and writes drags back to them. */
export function useLinkedCalendar(requests: MaintenanceRequest[], projects: Project[]) {
  const { update } = useStore()
  const lk = useLookup()
  const events = useMemo<CalEvent[]>(() => {
    const evs: CalEvent[] = []
    for (const r of requests) {
      if (!r.scheduledDate) continue
      const p = lk.property(r.propertyId)
      evs.push({
        id: `r:${r.id}`,
        date: r.scheduledDate,
        title: `#${r.number} ${r.title}`,
        kind: 'request',
        urgent: r.urgency === 'urgent',
        done: r.status === 'completed',
        subtitle: p ? `${p.address}, ${p.suburb}` : undefined,
      })
    }
    for (const pr of projects) {
      for (const m of pr.milestones) {
        evs.push({ id: `m:${pr.id}:${m.id}`, date: m.date, title: `${pr.title.split(' — ')[0]}: ${m.title}`, kind: 'milestone', done: m.done, subtitle: pr.title })
      }
    }
    return evs
  }, [requests, projects, lk])

  const onMove = useCallback(
    (ev: CalEvent, date: string) => {
      update((d) => {
        const [kind, a, b] = ev.id.split(':')
        if (kind === 'r') {
          const r = d.requests.find((x) => x.id === a)
          if (r) r.scheduledDate = date
        } else {
          const m = d.projects.find((x) => x.id === a)?.milestones.find((x) => x.id === b)
          if (m) m.date = date
        }
      })
    },
    [update],
  )

  return { events, onMove }
}

export function ProjectProgress({ p }: { p: Project }) {
  const done = p.milestones.filter((m) => m.done).length
  const total = p.milestones.length
  if (total === 0) return <span className="text-xs text-slate-500">No milestones yet</span>
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-slate-900" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span className="num text-xs text-slate-500">
        {done}/{total}
      </span>
    </div>
  )
}
