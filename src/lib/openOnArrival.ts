// "Open this when you get there": one admin page asks another to open a record straight away (an
// install quote from its store order, or the order from its quote). Kept in memory only.
type Kind = 'quote' | 'order'
let pending: { kind: Kind; id: string } | null = null

export function openOnArrival(kind: Kind, id: string) {
  pending = { kind, id }
}

/** The record to open on arriving at this page, once. */
export function takeOpenOnArrival(kind: Kind): string | null {
  if (pending?.kind !== kind) return null
  const id = pending.id
  pending = null
  return id
}
