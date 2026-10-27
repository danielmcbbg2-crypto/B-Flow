import { useMemo, useState } from 'react'
import { AlertTriangle, BellRing, Check } from 'lucide-react'
import { TextButton } from '../../components/TextMessage'
import { BRAND } from '../../lib/brand'
import { useLookup, useStore } from '../../lib/store'
import type { TextLogEntry, UserAccount as Profile } from '../../lib/types'
import { cx, todayISO, toISODate } from '../../lib/utils'

/** A booked start on a given day: a project task or a scheduled maintenance job. */
export interface Booking {
  kind: 'task' | 'request'
  id: string
  title: string
  /** "Bathroom renovation" or "Job #1042". */
  job: string
  href: string
  time?: string
  address: string
  trade?: Profile
  /** Undefined when the client doesn't hear about it (a task kept off their schedule). */
  client?: Profile
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

/** "7:30 am" from "07:30". */
export function fmtTime(t?: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** "tomorrow (Tue 28 Oct)", "today (…)" or "on Tue 4 Nov". */
function whenLabel(day: string): string {
  const d = new Date(day + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  if (day === todayISO()) return `today (${d})`
  if (day === addDays(todayISO(), 1)) return `tomorrow (${d})`
  return `on ${d}`
}

const firstName = (p?: Profile) => p?.name.split(' ')[0] ?? 'there'

export function tradeReminder(b: Booking, day: string): string {
  return `Hi ${firstName(b.trade)}, a reminder from ${BRAND.name}: you're booked ${whenLabel(day)}${b.time ? ` from ${fmtTime(b.time)}` : ''} for ${b.title} at ${b.address} (${b.job}). Let us know straight away if anything changes.`
}

export function clientReminder(b: Booking, day: string): string {
  return `Hi ${firstName(b.client)}, a reminder from ${BRAND.name}: our team is booked at ${b.address} ${whenLabel(day)}${b.time ? ` from ${fmtTime(b.time)}` : ''} for ${b.title.toLowerCase()}. Please make sure we can get in, and reply to this text if the day doesn't suit.`
}

/** The text-log event that records a reminder, so the queue knows it went. */
export const reminderEvent = (b: Booking, day: string, who: 'trade' | 'client') => `Booking reminder · ${b.kind} ${b.id} · ${day} · ${who}`

/** Every booked start on the day the person can manage, earliest first. */
export function useBookings(day: string): Booking[] {
  const { data, can } = useStore()
  const lk = useLookup()
  return useMemo(() => {
    const where = (propertyId: string) => {
      const p = lk.property(propertyId)
      return p ? [p.address, p.suburb].filter(Boolean).join(', ') : ''
    }
    const out: Booking[] = []
    if (can('canManageProjects'))
      for (const p of data.projects) {
        if (p.status !== 'approved' && p.status !== 'in_progress') continue
        for (const t of p.tasks)
          if (t.startDate === day && t.status !== 'done')
            out.push({
              kind: 'task',
              id: t.id,
              title: t.title,
              job: p.title,
              href: `#/admin/projects/${p.id}/schedule`,
              time: t.startTime,
              address: where(p.propertyId),
              trade: lk.user(t.assigneeId),
              client: t.clientVisible ? lk.user(p.clientId) : undefined,
            })
      }
    if (can('canDispatchJobs'))
      for (const r of data.requests)
        if (r.scheduledDate === day && r.status !== 'completed')
          out.push({
            kind: 'request',
            id: r.id,
            title: r.title,
            job: `Job #${r.number}`,
            href: '#/admin/dispatch',
            address: where(r.propertyId),
            trade: lk.user(r.assignedProviderId),
            client: lk.user(r.clientId),
          })
    return out.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title))
  }, [data, can, lk, day])
}

/**
 * Reminders for the day's bookings: one tap opens the text to the trade or the client in Messages,
 * and the queue shows which have gone (from the text log, so everyone in the office sees it).
 */
export function BookingReminders() {
  const { data } = useStore()
  const lk = useLookup()
  const tomorrow = addDays(todayISO(), 1)
  const [day, setDay] = useState(tomorrow)
  const bookings = useBookings(day)
  const sentBy = useMemo(() => {
    const m = new Map<string, TextLogEntry>()
    for (const t of data.texts) if (t.event.startsWith('Booking reminder · ') && !m.has(t.event)) m.set(t.event, t)
    return m
  }, [data.texts])
  const toSend = bookings.reduce(
    (n, b) => n + (b.trade?.phone && !sentBy.has(reminderEvent(b, day, 'trade')) ? 1 : 0) + (b.client?.phone && !sentBy.has(reminderEvent(b, day, 'client')) ? 1 : 0),
    0,
  )

  const recipient = (b: Booking, who: 'trade' | 'client') => {
    const p = who === 'trade' ? b.trade : b.client
    if (!p) return <span className={cx('text-xs', who === 'trade' ? 'font-semibold text-red-700' : 'text-slate-400')}>{who === 'trade' ? 'No trade booked' : 'Not on their schedule'}</span>
    const sent = sentBy.get(reminderEvent(b, day, who))
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-700">{p.name}</span>
        {sent ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <Check size={13} aria-hidden="true" /> Texted {new Date(sent.openedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
            {sent.openedBy && sent.openedBy !== p.id ? ` by ${lk.user(sent.openedBy)?.name.split(' ')[0] ?? 'office'}` : ''}
          </span>
        ) : !p.phone ? (
          <span className="text-xs text-slate-400">No mobile on file</span>
        ) : null}
        <TextButton
          phone={p.phone}
          label={sent ? 'Text again' : `Text ${who}`}
          className={sent ? 'btn-ghost py-1 text-xs' : 'btn-accent py-1 text-xs'}
          event={reminderEvent(b, day, who)}
          message={who === 'trade' ? tradeReminder(b, day) : clientReminder(b, day)}
        />
      </div>
    )
  }

  return (
    <section aria-label="Booking reminders">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <BellRing size={17} aria-hidden="true" /> Booking reminders
          {toSend > 0 && <span className="num rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{toSend} to send</span>}
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {[
            [todayISO(), 'Today'],
            [tomorrow, 'Tomorrow'],
          ].map(([d, label]) => (
            <button key={d} type="button" className={cx('rounded-full px-3 py-1 font-semibold', day === d ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setDay(d)}>
              {label}
            </button>
          ))}
          <input type="date" className="input num w-40 py-1" aria-label="Bookings on" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </div>
      </div>
      {bookings.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-slate-500">Nothing booked {whenLabel(day)}.</p>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {bookings.map((b) => (
            <li key={`${b.kind}-${b.id}`} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {b.time && <span className="num mr-2 text-slate-500">{fmtTime(b.time)}</span>}
                  {b.title}
                </p>
                <p className="truncate text-xs text-slate-500">
                  <a className="font-semibold text-slate-700 hover:text-slate-900" href={b.href}>{b.job}</a> · {b.address || 'No address'}
                </p>
                {!b.trade && (
                  <a href={b.href} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline">
                    <AlertTriangle size={13} aria-hidden="true" /> Book a trade for this
                  </a>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Trade</p>
                {recipient(b, 'trade')}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Client</p>
                {recipient(b, 'client')}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Texts open in Messages from your own number. Trades and clients with a portal login also get a reminder in their portal inbox automatically the afternoon before.
      </p>
    </section>
  )
}
