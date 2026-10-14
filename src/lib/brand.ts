import type { Trade } from './types'

export const BRAND = {
  name: 'Next Phase Maintenance',
  short: 'Next Phase',
  abn: '74 490 530 153',
  city: 'Melbourne, VIC',
  /** Public contact number — fill in to show it on the homepage. */
  phone: '',
  email: 'admin@nextphasemaintenance.com.au',
  website: 'www.nextphasemaintenance.com.au',
  hours: [
    { days: 'Mon – Fri', time: '7:00 am – 5:00 pm' },
    { days: 'Saturday', time: 'By appointment' },
    { days: 'Emergency', time: '24 / 7 for active clients' },
  ],
  coverage: [
    { region: 'Inner Melbourne', suburbs: 'CBD · Carlton · Fitzroy · Richmond · South Yarra · Southbank' },
    { region: 'Eastern Suburbs', suburbs: 'Hawthorn · Kew · Camberwell · Box Hill · Doncaster' },
    { region: 'Bayside & South East', suburbs: 'St Kilda · Brighton · Elsternwick · Caulfield · Moorabbin' },
    { region: 'Northern & Western', suburbs: 'Brunswick · Coburg · Essendon · Footscray · Williamstown' },
  ],
}

export const SERVICE_DETAILS: Record<Trade, string> = {
  Carpentry: 'Doors, frames, decking, skirting and architraves, built-ins and structural repairs.',
  Painting: 'Interior and exterior repaints, patch-and-match, colour-matched to your property record.',
  Plastering: 'Crack repair, sheet replacement, cornice and set-and-sand finishing.',
  Handyman: 'Odd jobs, hardware, fixtures, furniture assembly and small repairs.',
  Plumbing: 'Leaks, taps, toilets, hot water and drainage through licensed plumbers.',
  Electrical: 'Lighting, power points, switchboards and fault-finding by licensed electricians.',
  'Emergency Repairs': 'Urgent call-outs for water, electrical, security and make-safe works.',
  'Subscription Maintenance': 'Scheduled inspections, gutter cleans and preventative upkeep on a fixed plan.',
}
