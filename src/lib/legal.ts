// The website's legal pages — Privacy Policy and Terms of Use — in one place, so the live app and
// scripts/prerender.ts say exactly the same thing. Kept free of browser and build-tool APIs so both
// can import it. The wording is written for Next Phase Maintenance (a Melbourne, Victoria property
// maintenance and renovation business) and should be reviewed by a lawyer before being relied on.
import { BRAND } from './brand'

export const LEGAL = {
  /** Shown on both pages. Update whenever the wording changes. */
  effectiveDate: '5 November 2026',
  /** Australian state/territory whose law governs the terms, and whose courts hear disputes. */
  jurisdiction: 'Victoria',
  /** Optional postal address for privacy requests; leave blank to show only email. */
  postalAddress: '',
}

/** The business as it refers to itself in the legal pages. */
export const ENTITY = `${BRAND.name} (ABN ${BRAND.abn})`

/** Inline tokens usable in any paragraph below. Both the app and the prerender turn these into links. */
export const LEGAL_LINKS: Record<string, { href: string; label: string }> = {
  email: { href: `mailto:${BRAND.email}`, label: BRAND.email },
  phone: { href: `tel:${BRAND.phone.replace(/\s/g, '')}`, label: BRAND.phone },
  privacy: { href: '/privacy', label: 'Privacy Policy' },
  terms: { href: '/terms', label: 'Terms of Use' },
  returns: { href: '/store/returns', label: 'Returns, refunds and warranty' },
  delivery: { href: '/store/delivery', label: 'Delivery and pickup' },
  oaic: { href: 'https://www.oaic.gov.au', label: 'oaic.gov.au' },
}

/** The two legal pages, at /privacy and /terms. */
export const LEGAL_PAGES = [
  {
    slug: 'privacy',
    name: 'Privacy Policy',
    title: 'Privacy Policy',
    description: `How ${BRAND.name} collects, uses, stores and shares your personal information, and your rights under the Australian Privacy Principles.`,
  },
  {
    slug: 'terms',
    name: 'Terms of Use',
    title: 'Terms of Use',
    description: `The terms for using the ${BRAND.name} website, client and trade portals, and online shop in Melbourne, Victoria.`,
  },
] as const

export type LegalSlug = (typeof LEGAL_PAGES)[number]['slug']
export const isLegalPage = (s: string | undefined): s is LegalSlug => LEGAL_PAGES.some((p) => p.slug === s)

export interface LegalSection {
  title: string
  paragraphs: string[]
}

/** What each legal page says. In the paragraphs, {email}, {phone}, {privacy}, {terms}, {returns}, {delivery} and {oaic} become links. */
export function legalSections(slug: LegalSlug): LegalSection[] {
  return slug === 'privacy' ? privacy() : terms()
}

function privacy(): LegalSection[] {
  return [
    {
      title: 'About this policy',
      paragraphs: [
        `${ENTITY} ("we", "us" or "our") respects your privacy. This policy explains what personal information we collect, why, how we handle it, and your rights. It covers our website, our client and service-provider portals, our online shop, and our dealings with you by email, SMS and in person.`,
        'We handle personal information in accordance with the Privacy Act 1988 (Cth) and the Australian Privacy Principles (APPs). By using our website or services, you agree to this policy.',
        `This policy is effective from ${LEGAL.effectiveDate}.`,
      ],
    },
    {
      title: 'The information we collect',
      paragraphs: [
        'Contact and identity details: your name, email address, phone number, and the business or company you represent.',
        'Property and job details: the address where work is to be done, access instructions, and details you give us about your property — for example paint colours, finishes, cladding, skirting and floor plans — along with photos of the property and of the work, whether you send them to us or our team takes them on site.',
        'Quote, project and order details: your maintenance requests, quote requests, the quotes and variations you accept or decline, your store orders, and any notes you add.',
        'Account details: if you are given a portal login, your sign-in email and authentication details (we never see your password; it is held by our authentication provider).',
        'Payment details: we invoice through our accounting provider and are paid by bank transfer or the invoice’s secure pay link. We do not collect or store your full card details on our systems.',
        'Website usage: when you visit our website we may collect standard technical information such as your browser and device type, and which pages you view, through cookies and analytics (see “Cookies and website analytics” below).',
      ],
    },
    {
      title: 'How we collect it',
      paragraphs: [
        'We collect most information directly from you — when you send an enquiry or request, place an order, request or accept a quote, use a portal, or contact us.',
        'We also collect information when our team attends your property (for example site notes and photos), from people acting on your behalf, and automatically when you use our website.',
        'If you give us personal information about another person (for example a tenant or an occupant of a property), you confirm you are entitled to do so and that they are aware of this policy.',
      ],
    },
    {
      title: 'Why we use it',
      paragraphs: [
        'We use your information to respond to enquiries; prepare and send quotes; schedule, carry out and manage maintenance and renovation work; supply, deliver and install store products; invoice you and take payment; and keep you updated about your job, booking, quote or order by email and SMS.',
        'We also use it to run, secure and improve our website and systems, to prevent fraud and misuse, and to meet our legal, tax and record-keeping obligations.',
        'Where we send you SMS or email about a job, quote or order, these relate to work you have asked us to do or are doing with us. We do not send marketing messages without your consent, and any such message would include a way to opt out.',
      ],
    },
    {
      title: 'When we share it',
      paragraphs: [
        'We do not sell your personal information. We share it only as needed to provide our services and run our business:',
        'With our team, and with the tradespeople, subcontractors and delivery providers carrying out or delivering your job — and only the details they need for it.',
        'With the service providers that run our systems on our behalf: our website and database hosting providers, our SMS provider, our accounting and invoicing provider, website analytics, and the artificial-intelligence tools we use to help draft quotes, product descriptions and draft replies. These providers may only use the information to provide their service to us.',
        'With others where you ask us to, where the law requires or permits it, or if our business (or part of it) is sold or transferred.',
      ],
    },
    {
      title: 'Storage, security and overseas handling',
      paragraphs: [
        'We take reasonable steps to protect your information: data is sent over encrypted (HTTPS) connections, access to our systems is restricted to our team through invite-only accounts, administrator accounts require two-step sign-in, and sensitive credentials we hold are encrypted. No system can be guaranteed completely secure, but we work to protect your information and to respond promptly if a problem arises.',
        'Some of our service providers store or process information outside Australia. Where that happens, we take reasonable steps to ensure the information is handled consistently with the Australian Privacy Principles.',
        'We keep personal information only for as long as we need it for the purposes above or to meet our legal obligations (for example, tax and business records are generally kept for at least five years), after which we take reasonable steps to delete or de-identify it.',
      ],
    },
    {
      title: 'Cookies and website analytics',
      paragraphs: [
        'Our website uses cookies and similar technology to make it work and to understand how it is used — for example which pages are viewed and when an item is added to the cart. Where enabled, we use Google Analytics for this; it uses cookies and does not tell us who you are.',
        'You can block or delete cookies in your browser settings, though some parts of the site may not work as well without them.',
      ],
    },
    {
      title: 'Accessing or correcting your information',
      paragraphs: [
        'You can ask to see the personal information we hold about you, or to correct it, by emailing {email}. We will respond within a reasonable time and may need to verify your identity first. If we cannot give access or make a correction, we will explain why.',
      ],
    },
    {
      title: 'Complaints',
      paragraphs: [
        'If you have a concern about how we have handled your personal information, please contact us first at {email} so we can try to resolve it.',
        'If you are not satisfied with our response, you can contact the Office of the Australian Information Commissioner at {oaic}.',
      ],
    },
    {
      title: 'Changes to this policy',
      paragraphs: [
        'We may update this policy from time to time. The current version is always available on our website, with the effective date shown above. Significant changes will be reflected here, and continued use of our website or services means you accept the updated policy.',
      ],
    },
    {
      title: 'Contact us',
      paragraphs: [
        `For any privacy question or request, contact ${ENTITY}:`,
        `Email {email}${BRAND.phone ? ', phone {phone}' : ''}.${LEGAL.postalAddress ? ` Post: ${LEGAL.postalAddress}.` : ''}`,
        `Based in ${BRAND.city}.`,
      ],
    },
  ]
}

function terms(): LegalSection[] {
  return [
    {
      title: 'About these terms',
      paragraphs: [
        `These Terms of Use are an agreement between you and ${ENTITY} ("we", "us" or "our"). They apply to your use of our website, our client and service-provider portals, and our online shop (together, the "site").`,
        'By using the site you agree to these terms and to our {privacy}. If you do not agree, please do not use the site.',
        `These terms are effective from ${LEGAL.effectiveDate}. Nothing in them excludes, restricts or modifies any right or remedy you have under the Australian Consumer Law or any other law that cannot be excluded.`,
      ],
    },
    {
      title: 'Using the site',
      paragraphs: [
        'You must be at least 18 years old and able to form a binding contract to use the site, and you must use it only for lawful purposes.',
        'You agree not to misuse the site — for example, do not attempt to gain unauthorised access to it or to any account or system, interfere with or overload it, scrape or copy it beyond normal use, upload malicious code, or upload content that is unlawful, infringes someone else’s rights, or that you do not have the right to share.',
      ],
    },
    {
      title: 'Accounts and security',
      paragraphs: [
        'Access to the client and service-provider portals is by invitation only. If you are given a login, you are responsible for keeping your sign-in details secret and for activity that happens under your account. Administrator accounts must use two-step sign-in.',
        'Tell us straight away at {email} if you think your account has been accessed without your permission. We may suspend or remove access to an account that is misused or that breaches these terms.',
      ],
    },
    {
      title: 'Content and details you provide',
      paragraphs: [
        'When you give us photos, notes, property details or other information, you give us permission to use them to provide our services to you — to prepare quotes, carry out work, fulfil orders and keep records. You confirm you are entitled to share them and that they are not unlawful or infringing.',
      ],
    },
    {
      title: 'The online shop',
      paragraphs: [
        'We try to make product information, images and prices accurate, but errors and changes can occur. Placing an order is an offer to buy; a contract is formed only when we accept your order. Before you pay, we confirm availability, any delivery cost and the final price.',
        'Payment is by invoice. Prices are in Australian dollars and include GST unless stated otherwise. Title to goods passes to you only when they are paid for in full. Delivery, pickup and returns are covered by our {delivery} and {returns} pages.',
        'Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law, including a right to a repair, replacement or refund for a major failure. See {returns} for details.',
      ],
    },
    {
      title: 'Quotes, deposits and work',
      paragraphs: [
        'A quote is valid until the date shown on it and may be withdrawn or revised before you accept it. Accepting a quote — in your portal or through the secure quote link we send you — forms a contract for that work on the terms set out in the quote.',
        `A deposit may be payable when you accept a quote. Where Victoria’s Domestic Building Contracts Act 1995 applies, the deposit is capped (generally 10% of the contract price under $20,000, or 5% from $20,000). Changes to the work ("variations") must be agreed before they are carried out and may change the price.`,
        'Licensed trades are used where the law requires it (for example plumbing, electrical and gas work). Completed work is covered by the applicable statutory warranties and consumer guarantees.',
      ],
    },
    {
      title: 'Invoices and payment',
      paragraphs: [
        'We issue invoices through our accounting provider, payable by the date shown on the invoice. If an invoice is not paid on time we may pause further work and recover reasonable costs of collection, without affecting your rights under the Australian Consumer Law.',
      ],
    },
    {
      title: 'Intellectual property',
      paragraphs: [
        'The site, and its content and branding, belong to us or our licensors and are protected by law. You may use the site for its intended purpose, but you may not copy, reproduce or reuse its content without our permission. This does not affect your own data, quotes and invoices, which remain available to you.',
      ],
    },
    {
      title: 'Third-party links and services',
      paragraphs: [
        'The site may link to or rely on third-party websites and services (for example payment and mapping providers). We are not responsible for those third parties or their content, and your use of them is subject to their own terms.',
      ],
    },
    {
      title: 'Availability, disclaimers and liability',
      paragraphs: [
        'We work to keep the site accurate and available, but we provide it "as is" and do not guarantee that it will be uninterrupted, error-free or secure, or that information on it is always complete or current.',
        'To the maximum extent permitted by law, we are not liable for any indirect or consequential loss arising from your use of the site. Where our liability cannot be excluded but can be limited, our liability is limited — for goods, to replacing or repairing them or paying the cost of doing so; and for services, to supplying them again or paying the cost of doing so.',
        'Nothing in these terms excludes or limits any consumer guarantee, right or remedy you have under the Australian Consumer Law or other laws that cannot be excluded.',
      ],
    },
    {
      title: 'Your responsibilities',
      paragraphs: [
        'You agree to compensate us for reasonable loss or cost we suffer because you have misused the site, breached these terms, or provided unlawful or infringing content — except to the extent the loss was caused by us.',
      ],
    },
    {
      title: 'Privacy',
      paragraphs: ['We handle personal information in line with our {privacy}, which forms part of these terms.'],
    },
    {
      title: 'Changes to these terms',
      paragraphs: [
        'We may update these terms from time to time. The current version is always on the site, with the effective date shown above. Continued use of the site after a change means you accept the updated terms.',
      ],
    },
    {
      title: 'Governing law',
      paragraphs: [
        `These terms are governed by the laws of ${LEGAL.jurisdiction}, Australia, and you and we submit to the courts of ${LEGAL.jurisdiction} and the courts able to hear appeals from them.`,
      ],
    },
    {
      title: 'Contact us',
      paragraphs: [
        `${ENTITY} — email {email}${BRAND.phone ? ', phone {phone}' : ''}. Based in ${BRAND.city}.`,
      ],
    },
  ]
}
