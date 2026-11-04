// The shop's terms, in one place: what the policy pages and product pages say. Only set what the
// business has decided; until then the pages say to ask. Kept free of browser APIs: the app and
// scripts/prerender.ts both read it, so the live and pre-built pages say the same thing.
import { BRAND } from './brand'

export const STORE_POLICY = {
  /** Days to return an unused item in its original packaging for change of mind; null: no standing offer (customers are asked to talk to us first). */
  changeOfMindDays: null as number | null,
  /**
   * True once confirmed that plumbing installs are done by a plumber licensed or registered with Victoria's Building and
   * Plumbing Commission (the law requires it for plumbing work); product pages then say so.
   */
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
        { title: 'Pickup', paragraphs: ["Choose pickup at checkout and we'll contact you to arrange a time once your order is ready."] },
        {
          title: 'Delivery in Melbourne',
          paragraphs: [
            "We deliver across Melbourne. Delivery costs depend on the size of the order and where it's going, so we confirm the cost with you before you pay.",
            'Please check your order when it arrives and let us know straight away about anything damaged in transit, with a photo if you can.',
          ],
        },
        {
          title: 'Supply and install',
          paragraphs: [
            "Most products can be supplied and installed by our team. Mention it in your order notes, or ask for an install quote from the product page, and we'll quote the job before any work starts.",
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
          title: 'Change of mind',
          paragraphs: [
            STORE_POLICY.changeOfMindDays
              ? `You can return an unused item in its original packaging within ${STORE_POLICY.changeOfMindDays} days of delivery or pickup for a change of mind. Return transport is at your cost. Items ordered in specially for you, and items that have been installed, can't be returned for a change of mind. This doesn't affect your rights for faulty items above.`
              : "Changed your mind? Contact us before returning anything and we'll tell you what's possible for that item. This doesn't affect your rights for faulty items above.",
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
