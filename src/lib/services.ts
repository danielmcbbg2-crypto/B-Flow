// The website's service pages (/services/<slug>): what each service covers, written for the people
// searching for it. Each page's "Request" button opens the maintenance request form with the service
// already chosen (its `name`, as in SITE_SERVICES). Kept free of browser APIs: scripts/prerender.mts
// reads it too.
import type { SITE_SERVICES } from './brand'

export interface ServicePage {
  slug: string
  /** As listed on the home page and in the request form. */
  name: (typeof SITE_SERVICES)[number]
  /** The page's heading and search title. */
  title: string
  /** Search result description. */
  description: string
  intro: string
  /** Typical jobs. */
  jobs: string[]
  /** Who it's for and how it works. */
  details: { heading: string; body: string }[]
}

export const SERVICE_PAGES: ServicePage[] = [
  {
    slug: 'plumbing',
    name: 'Plumbing Services',
    title: 'Plumbing services in Melbourne',
    description: 'Leaking taps, blocked drains, toilets, hot water and bathroom plumbing for Melbourne homes, rentals and businesses. Request a plumber online.',
    intro:
      'From a dripping tap to a full bathroom fit-off, our plumbers look after homes, rental properties and commercial sites across Melbourne. Tell us what’s wrong, add a photo, and we’ll book a time.',
    jobs: ['Leaking taps, mixers and showers', 'Blocked sinks, toilets and drains', 'Toilet and cistern repairs and replacements', 'Hot water problems', 'Vanity, basin and tapware installation', 'Bathroom and kitchen fit-offs'],
    details: [
      { heading: 'For homes and rentals', body: 'Homeowners, landlords and property managers use us for the repairs that can’t wait and the upgrades that can. We keep tenants informed and send the office photos when the job’s done.' },
      { heading: 'Fixtures from our shop', body: 'Need a new vanity, toilet or mixer? Choose one from our shop and we can supply and install it in the same visit.' },
    ],
  },
  {
    slug: 'electrical',
    name: 'Electrical Services',
    title: 'Electrical services in Melbourne',
    description: 'Power points, lighting, fault finding, switchboard and appliance work for Melbourne homes and businesses. Request an electrician online.',
    intro:
      'Lights that won’t work, power points that have stopped, or a new fit-out to wire up: our electricians handle residential and commercial electrical work across Melbourne.',
    jobs: ['Fault finding and repairs', 'Power points and switches', 'Lighting, including LED downlights', 'Exhaust fans and appliances', 'Smoke alarms', 'Renovation and fit-out wiring'],
    details: [
      { heading: 'Residential and commercial', body: 'We work in houses, apartments, rentals, offices and shops, and fit around your tenants or trading hours.' },
      { heading: 'Part of bigger jobs', body: 'On renovations our electricians work alongside our plumbers, carpenters and plasterers, so one team runs the whole job.' },
    ],
  },
  {
    slug: 'painting-and-decorating',
    name: 'Painting and Decorating',
    title: 'Painting and decorating in Melbourne',
    description: 'Interior and exterior painting, patch-and-paint repairs and end-of-lease touch-ups for Melbourne homes, rentals and commercial properties.',
    intro: 'A fresh coat makes a property feel new. We paint single rooms, whole homes, rentals between tenants and commercial spaces across Melbourne.',
    jobs: ['Interior walls, ceilings and trims', 'Exterior painting', 'Patch, sand and paint repairs', 'End-of-lease and between-tenant touch-ups', 'Doors, skirting and architraves', 'Commercial repaints'],
    details: [
      { heading: 'Repairs first', body: 'Our plasterers fix cracks, holes and water damage before we paint, so the finish lasts.' },
      { heading: 'Rentals turned around', body: 'Property managers book us between tenancies to get a property ready to lease again quickly.' },
    ],
  },
  {
    slug: 'handyman',
    name: 'Handyman Services',
    title: 'Handyman services in Melbourne',
    description: 'Odd jobs, repairs, assembly, hanging and small fixes around Melbourne homes, rentals and offices. Request a handyman online.',
    intro: 'The list of small jobs that never gets done: doors that stick, things to hang, flat-packs to build. Send us the list and we’ll work through it in one visit.',
    jobs: ['Doors, locks and hinges', 'Hanging pictures, mirrors, shelves and TVs', 'Flat-pack assembly', 'Curtain rods and blinds', 'Minor repairs inside and out', 'Gutter cleaning and small outdoor jobs'],
    details: [
      { heading: 'One visit, many jobs', body: 'Add everything to one request with photos, and we’ll send the right person with the right tools.' },
      { heading: 'Bigger than a handyman job?', body: 'If something needs a licensed trade, we’ll book one of our plumbers or electricians rather than leave you to find one.' },
    ],
  },
  {
    slug: 'carpentry',
    name: 'Carpentry Services',
    title: 'Carpentry services in Melbourne',
    description: 'Doors, decks, framing, shelving, skirting and timber repairs for Melbourne homes and commercial properties. Request a carpenter online.',
    intro: 'From replacing a door to framing a renovation, our carpenters handle timber work of every size across Melbourne.',
    jobs: ['Door hanging and replacement', 'Decks, steps and pergola repairs', 'Framing for renovations', 'Shelving, cabinetry and storage', 'Skirting, architraves and trims', 'Timber rot repairs'],
    details: [
      { heading: 'Renovations', body: 'Our carpenters frame and fit out bathroom, kitchen and laundry renovations, working with our other trades on one schedule.' },
      { heading: 'Repairs that last', body: 'We fix the cause, not just the symptom, whether that’s water damage, movement or wear.' },
    ],
  },
  {
    slug: 'plastering',
    name: 'Plastering Services',
    title: 'Plastering services in Melbourne',
    description: 'Plasterboard repairs, cracks, holes, water damage, cornices and new walls for Melbourne homes and businesses. Request a plasterer online.',
    intro: 'Cracks, holes and water-damaged ceilings repaired so you can’t tell they were there, and new walls and ceilings for renovations.',
    jobs: ['Crack and hole repairs', 'Water-damaged ceilings and walls', 'Cornice repairs and replacement', 'New plasterboard walls and ceilings', 'Patch-ready for painting', 'Renovation plastering'],
    details: [
      { heading: 'Ready to paint', body: 'We finish repairs ready for painting, and our painters can follow straight on.' },
      { heading: 'After a leak', body: 'Once the leak is fixed by our plumbers, we repair the damage it left behind.' },
    ],
  },
  {
    slug: 'emergency-repairs',
    name: 'Emergency Repairs',
    title: 'Emergency repairs in Melbourne',
    description: 'Urgent repairs for burst pipes, leaks, electrical faults, broken locks and storm damage. 24/7 emergency response for active Next Phase Maintenance clients.',
    intro: 'When something can’t wait, such as a burst pipe, a failed power circuit or a door that won’t lock, tell us straight away and mark the request urgent.',
    jobs: ['Burst pipes and major leaks', 'Electrical faults and loss of power', 'Blocked toilets and drains', 'Broken locks, doors and windows', 'Storm and water damage', 'Make-safe work'],
    details: [
      { heading: '24/7 for active clients', body: 'Clients on our maintenance arrangements get 24/7 emergency response. Everyone else: send an urgent request and we’ll get back to you as soon as we can.' },
      { heading: 'Make safe, then fix', body: 'We make the property safe first, then book the repair, and keep you or your property manager updated with photos.' },
    ],
  },
  {
    slug: 'subscription-packages',
    name: 'Subscription Packages',
    title: 'Property maintenance packages in Melbourne',
    description: 'Subscription maintenance packages for Melbourne homes, rentals and businesses: regular upkeep, priority access and one team for every trade.',
    intro: 'Our subscription packages keep a property in good order with regular maintenance and priority access to our trades, for homeowners, landlords and businesses.',
    jobs: ['Regular scheduled maintenance', 'Priority booking for repairs', '24/7 emergency response', 'One team for every trade', 'Your own portal to request jobs and track them', 'Photos and notes on every job'],
    details: [
      { heading: 'Peace of mind', body: 'Problems get caught early, and when something does go wrong you’re at the front of the queue.' },
      { heading: 'For property managers', body: 'Manage several properties from one portal, with every request, visit and invoice in one place.' },
    ],
  },
]

export const servicePath = (s: { slug: string }) => `/services/${s.slug}`
export const serviceByName = (name: string) => SERVICE_PAGES.find((s) => s.name === name)
