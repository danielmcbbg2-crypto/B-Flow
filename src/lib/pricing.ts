import type { Pricing, Product } from './types'

/**
 * The store's price structure, as the database applies it (price_at_margin, auto_price_for): a price
 * at a margin on the selling price (30% margin = cost ÷ 0.70), rounded up to the dollar so the margin
 * is never below target.
 */
export function priceAtMargin(cost: number | undefined, margin: number): number | undefined {
  if (cost === undefined || !(cost > 0) || !(margin >= 0) || margin >= 100) return undefined
  return Math.ceil(Math.round((cost / (1 - margin / 100)) * 10000) / 10000)
}

/** What a product's prices are based on: the cost entered, or else the supplier's price. */
export const costBasis = (p: Pick<Product, 'source'>) => p.source?.cost ?? p.source?.supplierStock?.price

/** The three automatic prices, or undefined when the product isn't automatically priced. */
export function autoPrices(p: Pick<Product, 'source'>, pricing: Pricing) {
  if (!p.source || p.source.autoPrice === false) return undefined
  const basis = costBasis(p)
  const price = priceAtMargin(basis, pricing.public)
  if (price === undefined) return undefined
  return { basis: basis!, price, clientPrice: priceAtMargin(basis, pricing.client)!, tradePrice: priceAtMargin(basis, pricing.trade)! }
}

/** The margin a price makes on a cost, in % (one decimal). */
export const marginOf = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0)

/**
 * What an option value adds at a margin, from its extra cost (option_add_on in the database):
 * rounded up to the dollar, 0 when it costs nothing extra.
 */
export const optionAddOn = (cost: number | undefined, margin: number) => (cost !== undefined && cost > 0 ? (priceAtMargin(cost, margin) ?? 0) : 0)

/** The options' add-ons for each tier from their extra costs (automatically priced products). */
export function autoOptions(options: Product['options'], costs: Record<string, number>, pricing: Pricing): Product['options'] {
  return options.map((g) => ({
    ...g,
    values: g.values.map((v) => ({
      ...v,
      price: optionAddOn(costs[v.id], pricing.public),
      clientPrice: optionAddOn(costs[v.id], pricing.client),
      tradePrice: optionAddOn(costs[v.id], pricing.trade),
    })),
  }))
}

/** Priced by hand: each value adds the same for everyone. */
export const manualOptions = (options: Product['options']): Product['options'] =>
  options.map((g) => ({ ...g, values: g.values.map((v) => ({ ...v, clientPrice: v.price, tradePrice: v.price })) }))
