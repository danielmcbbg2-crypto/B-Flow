// The shop's terms, in one place: what the policy pages and product pages say. Only set what the
// business has decided; until then the pages say to ask. Kept free of browser APIs: the app and
// scripts/prerender.ts both read it, so the live and pre-built pages say the same thing.
import { BRAND } from './brand'

export const STORE_POLICY = {
  /** Change of mind: refunds only while the packaging is unopened and the item unused (none once it's opened). */
  changeOfMindUnopenedOnly: true as const,
  /** Customers are asked to inspect goods and email about damage or missing items within this many hours of receiving them. */
  inspectWithinHours: 24,
  /** Change-of-mind returns are accepted within this many days of receiving the goods (unopened and unused only). */
  changeOfMindDays: 30,
  /** Installs are done by licensed and insured trades (confirmed by the business, Nov 2026); product pages say so. */
  licensedInsuredTrades: true,
  /** Installation is offered in metro Melbourne only. */
  installMelbourneOnly: true,
  /** Melbourne standard delivery starts from this price (inc. GST); the exact cost is confirmed before dispatch. */
  melbourneDeliveryFrom: 40,
  /**
   * Melbourne standard delivery time, in business days. Most products are ordered in from the supplier
   * after the customer buys, so this allows for the supplier's turnaround as well as the delivery.
   */
  melbourneDeliveryDays: '1 to 7',
}

/** How an order gets to the customer. 'delivery' is standard delivery in metro Melbourne. */
export type DeliveryMethod = 'pickup' | 'delivery' | 'same_day' | 'australia'

/** The delivery choices at checkout, in order. Every delivery cost is confirmed by us after the order, before dispatch. */
export const DELIVERY_METHODS: { id: DeliveryMethod; name: string; short: string; detail: string }[] = [
  { id: 'pickup', name: 'Pickup', short: 'Pickup', detail: "Free. We'll contact you to arrange a time." },
  { id: 'delivery', name: 'Melbourne standard delivery', short: 'Melbourne delivery', detail: `Metro Melbourne, ${STORE_POLICY.melbourneDeliveryDays} business days. From $${STORE_POLICY.melbourneDeliveryFrom}; exact cost confirmed before dispatch.` },
  { id: 'same_day', name: 'Melbourne same-day delivery', short: 'Same-day delivery', detail: 'Metro Melbourne only, delivered the day your order is ready. We quote the cost first.' },
  { id: 'australia', name: 'Australia-wide delivery', short: 'Australia-wide delivery', detail: 'Outside Melbourne. We quote the cost to your address.' },
]
export const deliveryName = (d: string) => DELIVERY_METHODS.find((m) => m.id === d)?.name ?? d

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

/** One section of an information page. In the paragraphs, {email} and {phone} stand for the business's email and phone. */
export interface StoreInfoSection {
  title: string
  paragraphs: string[]
}

/** What each information page says. */
export function storeInfoSections(slug: StoreInfoSlug): StoreInfoSection[] {
  switch (slug) {
    case 'delivery':
      return [
        { title: 'Pickup', paragraphs: ["Pickup is free. Choose pickup at checkout and we'll contact you to arrange a time once your order is ready."] },
        {
          title: 'Melbourne standard delivery',
          paragraphs: [
            `We deliver across metro Melbourne in ${STORE_POLICY.melbourneDeliveryDays} business days. Delivery starts from $${STORE_POLICY.melbourneDeliveryFrom} (including GST); the exact cost depends on the size of the order and where it is going.`,
            "Most products are ordered in from our suppliers for you once you've ordered, and that time is included. If something will take longer, we'll tell you before you pay.",
          ],
        },
        {
          title: 'Same-day delivery in Melbourne',
          paragraphs: ["Need it fast? Choose same-day delivery and enter your address, and we'll deliver it the same day your order is ready, in metro Melbourne only. As most products are ordered in for you, we'll confirm when that will be, and the cost, before we dispatch."],
        },
        {
          title: 'Delivery Australia-wide',
          paragraphs: ["We ship anywhere in Australia. Choose Australia-wide delivery and enter your address, and we'll quote the delivery cost to that address."],
        },
        {
          title: 'How delivery costs are confirmed',
          paragraphs: [
            "For every delivery option we work out the cost after you order and send it to you before anything is dispatched. If the delivery cost doesn't suit you, you can switch to pickup or cancel the order for a full refund.",
          ],
        },
        {
          title: 'Check your order when it arrives',
          paragraphs: [
            `Please inspect your order within ${STORE_POLICY.inspectWithinHours} hours of receiving it, and email us at {email} within that time if anything is damaged, missing or not what you ordered, with your order number and photos. This lets us sort it out with the carrier quickly.`,
          ],
        },
        {
          title: 'Supply and install',
          paragraphs: [
            "Most products can be supplied and installed by our team in metro Melbourne. Choose \u201cSupply and install\u201d on the product page or tick \u201cInstall it for me\u201d in your cart, and we'll quote the installation before any work starts. Installs are done by licensed and insured trades. Installation isn't available outside Melbourne.",
          ],
        },
      ]
    case 'returns':
      return [
        {
          title: 'Your rights under the Australian Consumer Law',
          paragraphs: [
            ACL_GUARANTEE,
            "If something you bought from us is faulty, doesn't match its description, or isn't fit for its purpose, contact us at {email} with your order number and, if you can, a photo. We'll arrange a repair, replacement or refund as the law requires. Please don't install an item you can see is damaged.",
          ],
        },
        {
          title: 'Damaged or missing on arrival',
          paragraphs: [
            `Please inspect your goods within ${STORE_POLICY.inspectWithinHours} hours of receiving them, and email us at {email} within that time if anything is damaged, missing or not what you ordered. Include your order number and photos. Reporting it quickly lets us sort it out with the carrier and get a replacement on its way.`,
            'If you find a fault later, still contact us: your rights under the Australian Consumer Law for faulty goods continue after that time.',
          ],
        },
        {
          title: 'Change of mind',
          paragraphs: [
            `Changed your mind? You can return an item within ${STORE_POLICY.changeOfMindDays} days of receiving it, as long as the packaging is unopened and the item is unused. Once the packaging has been opened, we can't offer a refund for a change of mind. Email us at {email} before sending anything back.`,
            'For change-of-mind returns you pay the cost of sending the item back to us. Items that were picked up are returned to our pickup address by appointment: email or call us to book a time.',
            "This doesn't affect your rights for faulty or damaged items above: for those, we cover the cost of the return.",
          ],
        },
        {
          title: 'Manufacturer warranties',
          paragraphs: [
            "Many products come with a manufacturer's warranty, shown on the product page (for example, 5 years on a shower screen). These warranties are in addition to your rights under the Australian Consumer Law, not instead of them. To make a claim, contact us and we'll help you with it.",
          ],
        },
      ]
    case 'privacy':
      return [
        {
          title: 'What we collect',
          paragraphs: [
            'When you order or send an enquiry we collect your name, email, phone number, your delivery address if you choose delivery, and anything you write in the notes. We use these details to handle your order or enquiry: to confirm availability and costs, invoice you, arrange pickup, delivery or installation, and contact you about it.',
          ],
        },
        {
          title: "Where it's kept and who sees it",
          paragraphs: [
            "Your details are stored securely with our database provider and are seen only by our team, and by the delivery company or trade doing your job when they need them. We don't sell your personal information.",
          ],
        },
        {
          title: 'Website analytics',
          paragraphs: [
            "We may use Google Analytics to understand how people use the site, such as which pages are viewed and when something is added to the cart. It uses cookies and doesn't tell us who you are.",
          ],
        },
        {
          title: 'Seeing or correcting your information',
          paragraphs: [
            'You can ask to see or correct the information we hold about you, or ask a question about privacy, by emailing {email}. We handle personal information in line with the Australian Privacy Principles.',
          ],
        },
      ]
    case 'contact':
      return [
        {
          title: BRAND.name,
          paragraphs: [
            `Questions about a product, an order or an installation? Email {email}${BRAND.phone ? ' or call {phone}' : ''}.`,
            `Hours: ${BRAND.hours.map((h) => `${h.days}, ${h.time}`).join('; ')}.`,
            `Based in ${BRAND.city}. ABN ${BRAND.abn}.`,
          ],
        },
      ]
  }
}
