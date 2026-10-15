import { useMemo, useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx, toISODate, todayISO } from '../lib/utils'

export interface CalEvent {
  id: string
  date: string
  title: string
  kind: 'request' | 'milestone'
  done?: boolean
  urgent?: boolean
  subtitle?: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Background, left edge and text colour of an event chip. Strike-through for done items is added by the caller. */
function chipTone(ev: CalEvent) {
  const bg = ev.kind === 'milestone' ? 'bg-white ring-1 ring-inset ring-slate-200' : ev.urgent ? 'bg-accent-soft' : 'bg-slate-100'
  const edge = ev.done
    ? 'border-slate-300 text-slate-600'
    : ev.kind === 'milestone'
      ? 'border-slate-400 text-slate-700'
      : ev.urgent
        ? 'border-accent text-slate-900'
        : 'border-slate-900 text-slate-900'
  return cx('border-l-[3px] text-left font-medium', bg, edge)
}

const DONE = 'line-through decoration-slate-400'

/**
 * Month calendar. Events can be dragged to a new day; `onMove` writes the new
 * date back to the source request or milestone, so the calendar and the works
 * records stay in sync both ways.
 */
export function Calendar({
  events,
  onMove,
  onOpen,
}: {
  events: CalEvent[]
  onMove?: (ev: CalEvent, date: string) => void
  onOpen?: (ev: CalEvent) => void
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [dragOver, setDragOver] = useState<string | null>(null)

  const days = useMemo(() => {
    const first = new Date(cursor)
    const offset = (first.getDay() + 6) % 7 // Monday-first
    const start = new Date(first)
    start.setDate(first.getDate() - offset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cursor])

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e])
    return m
  }, [events])

  // Phones get a list of the month's days that have something on, instead of the 7-column grid.
  const agenda = useMemo(() => {
    const month = toISODate(cursor).slice(0, 7)
    return [...byDate.entries()].filter(([iso]) => iso.startsWith(month)).sort(([a], [b]) => a.localeCompare(b))
  }, [byDate, cursor])

  const today = todayISO()
  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))

  const onDrop = (e: DragEvent, date: string) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const ev = events.find((x) => x.id === id)
    if (ev && ev.date !== date) onMove?.(ev, date)
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-bold">{cursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</h2>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2 py-1.5" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs"
            onClick={() => {
              const d = new Date()
              setCursor(new Date(d.getFullYear(), d.getMonth(), 1))
            }}
          >
            Today
          </button>
          <button className="btn-ghost px-2 py-1.5" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="sm:hidden">
        {agenda.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing scheduled this month.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {agenda.map(([iso, list]) => (
              <li key={iso} className="flex gap-3 px-4 py-3">
                <p className="w-[4.75rem] shrink-0 pt-1.5">
                  <span className={cx('num whitespace-nowrap text-sm font-semibold', iso === today ? 'bg-slate-900 px-1 text-white' : 'text-slate-900')}>
                    {new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')}
                  </span>
                </p>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {list.map((ev) => (
                    <button key={ev.id} onClick={() => onOpen?.(ev)} className={cx('block w-full px-2.5 py-2 text-sm leading-snug', chipTone(ev))}>
                      <span className={cx(ev.done && DONE)}>{ev.title}</span>
                      {ev.subtitle && <span className="mt-0.5 block text-xs font-normal text-slate-500">{ev.subtitle}</span>}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const iso = toISODate(d)
              const inMonth = d.getMonth() === cursor.getMonth()
              const list = byDate.get(iso) ?? []
              return (
                <div
                  key={iso}
                  onDragOver={(e) => {
                    if (!onMove) return
                    e.preventDefault()
                    setDragOver(iso)
                  }}
                  onDragLeave={() => setDragOver((v) => (v === iso ? null : v))}
                  onDrop={(e) => onDrop(e, iso)}
                  className={cx(
                    'min-h-[104px] border-b border-r border-slate-100 p-1.5',
                    !inMonth && 'bg-slate-50/70',
                    dragOver === iso && 'bg-accent-soft ring-2 ring-inset ring-accent',
                  )}
                >
                  <div
                    className={cx(
                      'num mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs',
                      iso === today ? 'bg-slate-900 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-500',
                    )}
                  >
                    {d.getDate()}
                  </div>
                  <div className="space-y-1">
                    {list.map((ev) => (
                      <button
                        key={ev.id}
                        draggable={!!onMove}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', ev.id)}
                        onClick={() => onOpen?.(ev)}
                        title={ev.subtitle ? `${ev.title} — ${ev.subtitle}` : ev.title}
                        className={cx(
                          'block w-full truncate px-1.5 py-1 text-[11px] leading-tight',
                          chipTone(ev),
                          ev.done && DONE,
                          onMove && 'cursor-grab active:cursor-grabbing',
                        )}
                      >
                        {ev.title}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-slate-900" />Maintenance visit</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-accent" />Urgent visit</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-slate-400" />Project milestone</span>
        {onMove && (
          // Native drag and drop needs a mouse, and the phone agenda has no grid to drop onto.
          <span className="ml-auto max-sm:hidden [@media(pointer:coarse)]:hidden">Drag an item to reschedule. The linked work order or milestone updates too.</span>
        )}
      </div>
    </div>
  )
}
