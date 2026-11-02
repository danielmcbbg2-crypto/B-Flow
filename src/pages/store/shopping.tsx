// What the shop's pages share: who pays which price, the choices on a product, its photo and price
// labels, and the published catalogue.
import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import type { Tone } from '../../components/ui'
import { useStore } from '../../lib/store'
import type { Product, ProductOptionValue, UserAccount } from '../../lib/types'
import { cx, money } from '../../lib/utils'

export const STOCK_TONE: Record<Product['stock'], Tone> = { in_stock: 'green', to_order: 'outline', out_of_stock: 'red' }

export type Choice = Record<string, string>

const tierOf = (p: Product, user: UserAccount | null) =>
  user?.status !== 'active' ? 'public' : user.role === 'provider' && p.tradePrice !== undefined ? 'trade' : user.role === 'client' && p.clientPrice !== undefined ? 'client' : 'public'

/** What an option value adds for this person (their tier's add-on, as place_order works it out). */
export function addOn(v: ProductOptionValue, p: Product, user: UserAccount | null): number {
  const tier = tierOf(p, user)
  return (tier === 'trade' ? v.tradePrice : tier === 'client' ? v.clientPrice : undefined) ?? v.price
}

/**
 * Signed-in service providers pay the trade price and signed-in clients the client price, where one
 * is set; everyone else the public price, plus what the chosen options add (place_order applies the
 * same rule).
 */
export function unitPrice(p: Product, user: UserAccount | null, choice: Choice = {}): number {
  const tier = tierOf(p, user)
  const base = tier === 'trade' ? p.tradePrice! : tier === 'client' ? p.clientPrice! : p.price
  return base + (p.options ?? []).reduce((sum, g) => {
    const v = g.values.find((x) => x.id === choice[g.id])
    return sum + (v ? addOn(v, p, user) : 0)
  }, 0)
}

/** The first available value of each option. */
export const defaultChoice = (p: Product): Choice =>
  Object.fromEntries((p.options ?? []).map((g) => [g.id, (g.values.find((v) => v.available) ?? g.values[0])?.id ?? '']))

/** "Size: 900 mm · Colour: Oak", or null if a choice is missing or no longer offered. */
export function choiceText(p: Product, choice: Choice = {}): string | null {
  const opts = p.options ?? []
  if (Object.keys(choice).some((k) => !opts.some((g) => g.id === k))) return null
  const parts: string[] = []
  for (const g of opts) {
    const v = g.values.find((x) => x.id === choice[g.id])
    if (!v || !v.available) return null
    parts.push(`${g.name}: ${v.label}`)
  }
  return parts.join(' · ')
}

/** Published products: from the signed-in person's data, or loaded for a visitor. */
export function useCatalog() {
  const { data, user, loadCatalog, phase } = useStore()
  const [visitor, setVisitor] = useState<{ products: Product[]; error?: string } | null>(null)
  useEffect(() => {
    if (user || phase !== 'ready') return
    let live = true
    loadCatalog()
      .then((products) => live && setVisitor({ products }))
      .catch((e: Error) => live && setVisitor({ products: [], error: e.message }))
    return () => {
      live = false
    }
  }, [user, phase, loadCatalog])
  if (user) return { products: data.products.filter((p) => p.status === 'published'), loading: false, error: undefined }
  return { products: visitor?.products ?? [], loading: !visitor, error: visitor?.error }
}

export function Price({ p, user, large, choice, from }: { p: Product; user: UserAccount | null; large?: boolean; choice?: Choice; from?: boolean }) {
  const price = unitPrice(p, user, choice)
  const retail = unitPrice(p, null, choice)
  return (
    <span className={cx('num', large ? 'text-2xl font-bold' : 'font-semibold')}>
      {from && <span className="mr-1 text-xs font-normal text-slate-500">From</span>}
      {money(price)}
      {price !== retail && (
        <span className="ml-2 align-middle text-xs font-normal text-slate-500">
          {user?.role === 'provider' ? 'Trade price' : 'Member price'} <span className="line-through">{money(retail)}</span>
        </span>
      )}
    </span>
  )
}

/** The cheapest choice of a product (for "From $…" on the product card). */
export const cheapestChoice = (p: Product, user: UserAccount | null): Choice =>
  Object.fromEntries(
    (p.options ?? []).map((g) => {
      const open = g.values.filter((v) => v.available)
      const best = (open.length ? open : g.values).reduce((a, b) => (addOn(b, p, user) < addOn(a, p, user) ? b : a))
      return [g.id, best.id]
    }),
  )
export const varies = (p: Product) => (p.options ?? []).some((g) => g.values.some((v) => v.price !== g.values[0].price))

/** The photo of the first chosen option that has one (e.g. the colour picked), if any. */
export const choicePhoto = (p: Product, choice: Choice = {}) =>
  (p.options ?? []).map((g) => g.values.find((v) => v.id === choice[g.id])?.image).find(Boolean)

/** A product's photo (its first, or `src`), described for screen readers by its photo description. */
export function ProductImage({ p, className, src, eager }: { p: Product; className?: string; src?: string; eager?: boolean }) {
  const photo = src ?? p.images[0]
  const i = p.images.indexOf(photo ?? '')
  return photo ? (
    <img src={photo} alt={(i >= 0 && p.imageAlt?.[i]) || p.title} className={cx('object-cover', className)} loading={eager ? 'eager' : 'lazy'} decoding="async" />
  ) : (
    <div className={cx('flex items-center justify-center bg-slate-100 text-slate-400', className)} aria-hidden="true">
      <Package size={40} strokeWidth={1.25} />
    </div>
  )
}
