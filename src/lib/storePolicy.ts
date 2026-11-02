// The shop's terms, in one place: what the policy pages and product pages say. Only set what the
// business has decided; until then the pages say to ask.
export const STORE_POLICY = {
  /** Days to return an unused item in its original packaging for change of mind; null: no standing offer (customers are asked to talk to us first). */
  changeOfMindDays: null as number | null,
  /** True once confirmed that plumbing installs are done by a licensed (VBA-registered) plumber; product pages then say so. */
  licensedPlumber: false,
}

/** The wording the Australian Consumer Law prescribes for goods sold to consumers (Competition and Consumer Regulations 2010, reg 90). */
export const ACL_GUARANTEE =
  'Our goods come with guarantees that cannot be excluded under the Australian Consumer Law. You are entitled to a replacement or refund for a major failure and compensation for any other reasonably foreseeable loss or damage. You are also entitled to have the goods repaired or replaced if the goods fail to be of acceptable quality and the failure does not amount to a major failure.'

/** The shop's information pages, at /store/<slug>. */
export const STORE_INFO_PAGES = [
  { slug: 'delivery', name: 'Delivery & pickup', title: 'Delivery and pickup', description: 'How pickup and delivery work for orders from the Next Phase Maintenance shop in Melbourne, and when we confirm costs.' },
  { slug: 'returns', name: 'Returns & warranty', title: 'Returns, refunds and warranty', description: 'Your rights under the Australian Consumer Law, how to return a faulty item, and manufacturer warranties on products from our shop.' },
  { slug: 'privacy', name: 'Privacy', title: 'Privacy', description: 'What personal information the Next Phase Maintenance shop collects when you order, why, and how to see or correct it.' },
  { slug: 'contact', name: 'Contact', title: 'Contact the shop', description: 'Questions about a product, an order or installation? Contact Next Phase Maintenance in Melbourne.' },
] as const

export type StoreInfoSlug = (typeof STORE_INFO_PAGES)[number]['slug']
export const isStoreInfo = (s: string | undefined): s is StoreInfoSlug => STORE_INFO_PAGES.some((p) => p.slug === s)
