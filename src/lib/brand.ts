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

/** Wording from nextphasemaintenance.com.au, kept verbatim so the app matches the website. */
export const SITE_COPY = {
  heroTitle: 'Your Trusted Melbourne Maintenance Partner',
  heroSubtitle: 'Expert Maintenance Services for Every Property',
  servicesEyebrow: 'Our Services',
  servicesTitle: 'We Offer Comprehensive Maintenance Solutions for All Property Types',
  servicesIntro:
    'Our subscription-based packages are designed to meet the diverse needs of our clients, ensuring they receive timely and efficient service.',
  residential: {
    title: 'Residential Maintenance',
    body: 'At Next Phase Maintenance, we specialize in comprehensive residential maintenance services. Our skilled team ensures your home is in perfect condition with our subscription-based packages, providing peace of mind and priority access to our services.',
  },
  commercial: {
    title: 'Commercial Maintenance',
    body: 'We cater to businesses with our tailored commercial maintenance solutions. Our reliable tradespeople are ready to handle your property’s needs, ensuring minimal downtime, maximum efficiency.',
  },
  specialized: {
    title: 'Specialized Services',
    body: 'From electrical work to handyman tasks, our diverse team is equipped to take on a variety of maintenance challenges across all property types. Each of our trades professionals brings expertise in their respective fields, making us your one-stop solution for maintenance.',
  },
}

/** Service cards as named on the website (plus the subscription plans its copy describes). */
export const SITE_SERVICES = [
  'Plumbing Services',
  'Electrical Services',
  'Painting and Decorating',
  'Handyman Services',
  'Carpentry Services',
  'Plastering Services',
  'Emergency Repairs',
  'Subscription Packages',
] as const
