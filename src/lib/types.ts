export type Role = 'admin' | 'client' | 'provider'

export type Permission =
  | 'canSubmitRequests'
  | 'canDispatchJobs'
  | 'canManageInvoices'
  | 'canEditPermissions'
  | 'canManageProjects'
  | 'canSubmitExpenses'
  | 'canManageStore'

export const ALL_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: 'canSubmitRequests', label: 'Submit maintenance requests' },
  { key: 'canDispatchJobs', label: 'Dispatch & assign jobs' },
  { key: 'canManageInvoices', label: 'Manage invoices & payments' },
  { key: 'canEditPermissions', label: 'Edit accounts & permissions' },
  { key: 'canManageProjects', label: 'Manage projects & quotes' },
  { key: 'canSubmitExpenses', label: 'Submit project expenses' },
  { key: 'canManageStore', label: 'Manage store & orders' },
]

export const DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['canSubmitRequests', 'canDispatchJobs', 'canManageInvoices', 'canEditPermissions', 'canManageProjects', 'canSubmitExpenses', 'canManageStore'],
  client: ['canSubmitRequests'],
  provider: ['canSubmitExpenses'],
}

export interface UserAccount {
  id: string
  name: string
  /** Empty for a client or trade added without a login and no email yet. */
  email: string
  role: Role
  phone: string
  company?: string
  trade?: string
  permissions: Permission[]
  createdAt: string
  status: 'active' | 'invited' | 'suspended'
  /** SHA-256 hex of password. Empty while an invite is pending. */
  passwordHash: string
  inviteCode?: string
  /** Live mode: whether a login exists yet (it's created by the first invite). */
  hasLogin?: boolean
}

export interface PaintColors {
  walls: string
  trim: string
  ceiling: string
}

export interface Property {
  id: string
  clientId: string
  address: string
  suburb: string
  postcode: string
  paintColors: PaintColors
  skirtProfile: string
  claddingType: string
  accessCode: string
  notes: string
  floorPlan?: string
}

export const TRADES = [
  'Carpentry',
  'Painting',
  'Plastering',
  'Handyman',
  'Plumbing',
  'Electrical',
  'Emergency Repairs',
  'Subscription Maintenance',
] as const
export type Trade = (typeof TRADES)[number]

export type RequestStatus = 'pending' | 'assigned' | 'in_progress' | 'awaiting_parts' | 'completed'

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending triage',
  assigned: 'Assigned',
  in_progress: 'In progress',
  awaiting_parts: 'Awaiting parts',
  completed: 'Completed',
}

export interface MaintenanceRequest {
  id: string
  number: number
  clientId: string
  propertyId: string
  title: string
  description: string
  category: Trade
  urgency: 'urgent' | 'standard'
  photos: string[]
  completionPhotos: string[]
  status: RequestStatus
  assignedProviderId?: string
  scheduledDate?: string
  notes: string
  smsNotified: boolean
  createdAt: string
  completedAt?: string
  /** Who really lodged it (set by the database); differs from the client when an admin did it for them. */
  createdBy?: string
}

export type ProjectStatus = 'quote_requested' | 'quoted' | 'approved' | 'in_progress' | 'completed' | 'rejected'

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  quote_requested: 'Quote requested',
  quoted: 'Quote issued',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  rejected: 'Rejected',
}

export interface Milestone {
  id: string
  title: string
  date: string
  done: boolean
}

export interface Expense {
  id: string
  providerId: string
  date: string
  description: string
  category: 'Materials' | 'Labour' | 'Equipment hire' | 'Subcontractor' | 'Other'
  amount: number
  status: 'submitted' | 'approved' | 'rejected'
  /** Who really added it (set by the database); differs from the trade when an admin did it for them. */
  createdBy?: string
}

export type QuoteItemKind = 'labour' | 'materials' | 'subcontract' | 'hire' | 'other'
export const QUOTE_ITEM_KIND_LABEL: Record<QuoteItemKind, string> = {
  labour: 'Labour',
  materials: 'Materials',
  subcontract: 'Subcontract',
  hire: 'Hire',
  other: 'Other',
}

/** One line of an itemised quote. Rates exclude GST. */
export interface QuoteItem {
  id: string
  /** Stage or trade the line belongs to, e.g. "Demolition" or "Plumbing". */
  section: string
  description: string
  kind: QuoteItemKind
  qty: number
  unit: string
  rate: number
}

export type VariationStatus = 'proposed' | 'approved' | 'rejected'

/** A priced change after the quote (amount excludes GST; negative for a credit). */
export interface Variation {
  id: string
  number: number
  title: string
  description: string
  amount: number
  status: VariationStatus
  createdAt: string
  /** Set by the database: who proposed it and who approved or declined it. */
  createdBy?: string
  decidedBy?: string
  decidedAt?: string
}

/** A progress payment: deposit, stage claim or final balance. Claimed by raising an invoice. */
export interface PaymentStage {
  id: string
  title: string
  /** percent of the quoted total; a fixed amount inc. GST; or the balance of the contract. */
  basis: 'percent' | 'amount' | 'balance'
  value: number
  milestoneId?: string
  invoiceId?: string
}

export const COST_CATEGORIES = ['Materials', 'Labour', 'Subcontractor', 'Equipment hire', 'Permits & fees', 'Waste & disposal', 'Other'] as const

/** A project cost besides trades' expenses (office only). Amount excludes GST. */
export interface ProjectCost {
  id: string
  date: string
  description: string
  category: string
  supplier: string
  amount: number
}

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' }

/** A piece of the schedule: a stage of work booked with a trade for a span of days. */
export interface ProjectTask {
  id: string
  /** Group it belongs to, e.g. "Rough-in" (blank: general). */
  stage: string
  title: string
  startDate: string
  endDate: string
  /** When the trade is booked to arrive on the first day, "07:30" (optional). */
  startTime?: string
  assigneeId?: string
  status: TaskStatus
  notes: string
  /** Shown on the client's schedule. */
  clientVisible: boolean
}

/** A day's entry in the site diary. */
export interface DiaryEntry {
  id: string
  date: string
  weather: string
  /** Who was on site. */
  onSite: string
  workDone: string
  issues: string
  photos: string[]
  /** Only the office decides what the client sees. */
  shareWithClient: boolean
  /** Set by the database. */
  authorId?: string
  createdAt: string
}

export type DefectStatus = 'open' | 'fixed' | 'closed'
export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = { open: 'Open', fixed: 'Fixed, to check', closed: 'Closed' }

/** A snag on the punch list: raised (by the office or the client), fixed by a trade, closed by the office. */
export interface Defect {
  id: string
  /** Numbered per project by the database. */
  number: number
  title: string
  location: string
  description: string
  assigneeId?: string
  dueDate?: string
  status: DefectStatus
  photos: string[]
  fixPhotos: string[]
  fixNotes: string
  /** Set by the database. */
  raisedBy?: string
  raisedAt: string
  fixedBy?: string
  fixedAt?: string
  closedBy?: string
  closedAt?: string
}

export const DOCUMENT_CATEGORIES = ['Plans', 'Permits', 'Certificates', 'Warranties', 'Contracts', 'Photos', 'Other'] as const
export type DocumentShare = 'office' | 'client' | 'trades' | 'everyone'
export const DOCUMENT_SHARE_LABEL: Record<DocumentShare, string> = { office: 'Office only', client: 'Client', trades: 'Trades', everyone: 'Client and trades' }

/** A file kept on the project (plans, permits, certificates…). */
export interface ProjectDocument {
  id: string
  name: string
  category: (typeof DOCUMENT_CATEGORIES)[number]
  /** Where the file is stored (live: the private bucket; demo: the file itself). */
  path: string
  sizeBytes: number
  contentType: string
  share: DocumentShare
  uploadedBy?: string
  uploadedAt: string
}

export interface Project {
  id: string
  number: number
  clientId: string
  propertyId: string
  title: string
  description: string
  type: 'renovation' | 'maintenance_contract'
  budget: number
  quoteAmount?: number
  scopeOfWorks: string
  status: ProjectStatus
  milestones: Milestone[]
  assignedProviderId?: string
  expenses: Expense[]
  createdAt: string
  /** Who really requested it (set by the database); differs from the client when an admin did it for them. */
  createdBy?: string
  /** Who last accepted or declined the quote, and which (set by the database; cleared when it's issued again). */
  quoteDecidedBy?: string
  quoteDecision?: 'approved' | 'rejected'
  /** Itemised quote (empty for a quote given as a single amount). */
  quoteItems: QuoteItem[]
  quoteInclusions: string
  quoteExclusions: string
  quoteValidUntil?: string
  /** Set by the database: when the quote was last issued and when it was answered. */
  quoteIssuedAt?: string
  quoteDecidedAt?: string
  /** When the office last followed up an unanswered quote. */
  quoteFollowedUpAt?: string
  variations: Variation[]
  payments: PaymentStage[]
  /** Office only: not loaded for clients. */
  costs: ProjectCost[]
  tasks: ProjectTask[]
  diary: DiaryEntry[]
  defects: Defect[]
  documents: ProjectDocument[]
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid'

export interface QuickBooksInvoice {
  id: string
  requestId?: string
  projectId?: string
  clientId: string
  qbInvoiceNumber: string
  amount: number
  status: InvoiceStatus
  bankTransferRef: string
  paidDate?: string
  dueDate: string
  createdAt: string
}

export interface SmsNotification {
  id: string
  recipientPhone: string
  message: string
  timestamp: string
  status: 'dispatched' | 'queued' | 'failed'
  triggerEvent: string
  detail?: string
}

export interface SmsSettings {
  /**
   * 'server' = the send-sms Supabase function (live mode, credentials in Supabase secrets).
   * Demo mode can only log or post to a webhook: provider credentials never go in the browser.
   */
  provider: 'webhook' | 'none' | 'server'
  fromNumber: string
  webhookUrl: string
  recipients: string[]
  notifyOnNewRequest: boolean
  notifyOnUrgentOnly: boolean
  notifyProviderOnAssign: boolean
  /** Text trades and clients the afternoon before each booking (sent by ClickSend from the server). */
  bookingReminderTexts: boolean
  /** Text website enquiries back straight away with `autoReplyMessage` ({first_name} is filled in). */
  autoReply: boolean
  autoReplyMessage: string
}

export const DEFAULT_SMS: SmsSettings = {
  provider: 'server',
  fromNumber: '',
  webhookUrl: '',
  recipients: [],
  notifyOnNewRequest: true,
  notifyOnUrgentOnly: false,
  notifyProviderOnAssign: true,
  bookingReminderTexts: true,
  autoReply: false,
  autoReplyMessage: "Hi {first_name}, it's Daniel from Next Phase Maintenance. Thanks for your enquiry, we've got it. If you can, reply with a few photos of the job and we'll come back to you with a quote.",
}

export interface BankDetails {
  accountName: string
  bsb: string
  accountNumber: string
}

export interface InboxMessage {
  id: string
  userId: string
  title: string
  body: string
  createdAt: string
  read: boolean
  requiresAck: boolean
  acknowledged: boolean
  /** Who acknowledged it: the trade, or an admin who did it from the trade's dashboard. */
  acknowledgedBy?: string
  requestId?: string
  projectId?: string
}

export const STORE_CATEGORIES = [
  'Vanities',
  'Shower screens',
  'Tapware',
  'Basins',
  'Toilets',
  'Baths',
  'Mirrors & cabinets',
  'Accessories',
  'Hardware',
  'Other',
] as const

export const STOCK_LABEL: Record<Product['stock'], string> = {
  in_stock: 'In stock',
  to_order: 'Made to order',
  out_of_stock: 'Out of stock',
}

export interface Product {
  id: string
  title: string
  description: string
  category: string
  brand: string
  sku: string
  /** Retail price, inc. GST. */
  price: number
  /** Price for signed-in service providers, when set. Only they and store managers can see it. */
  tradePrice?: number
  /** Price for signed-in clients, when set. Only they and store managers can see it. */
  clientPrice?: number
  /** Public image links (uploaded photos). */
  images: string[]
  /** Choices the customer makes (e.g. Size, Colour): one value of each. */
  options: ProductOption[]
  status: 'draft' | 'published' | 'archived'
  stock: 'in_stock' | 'to_order' | 'out_of_stock'
  /** Store managers only: where it comes from. */
  source?: ProductSource
  createdBy?: string
  createdAt: string
}

/** A choice on a product, e.g. Size, with the values to pick from. */
export interface ProductOption {
  id: string
  name: string
  values: ProductOptionValue[]
}

export interface ProductOptionValue {
  id: string
  label: string
  /** What it adds to the public price (set from its extra cost when the product is priced automatically). */
  price: number
  /** What it adds for signed-in clients and trades (seen by them and store managers only). */
  clientPrice?: number
  tradePrice?: number
  /** Off: shown but can't be chosen. */
  available: boolean
}

export interface ProductSource {
  supplier: string
  url: string
  /** What it costs the business, inc. GST. */
  cost?: number
  /** What each option value costs the business extra (by value id). */
  optionCosts?: Record<string, number>
  notes: string
  /** Set the three prices from the cost (or the supplier's price) at the store's margins (on unless switched off). */
  autoPrice?: boolean
  /** Check the supplier's page for stock every 6 hours (on unless switched off). */
  trackStock?: boolean
  /** What the listing switches to when the supplier runs out. */
  outOfStockAs?: 'out_of_stock' | 'to_order'
  /** The last reading from the supplier's page (recorded by the server only). */
  supplierStock?: SupplierStock
}

export type SupplierStockStatus = 'in_stock' | 'low' | 'out_of_stock' | 'unknown'
export const SUPPLIER_STOCK_LABEL: Record<SupplierStockStatus, string> = { in_stock: 'In stock', low: 'Running low', out_of_stock: 'Out of stock', unknown: 'Not checked yet' }

export interface SupplierStock {
  status: SupplierStockStatus
  qty?: number
  /** The supplier's price as shown on their page. */
  price?: number
  /** How it was read, or why it couldn't be. */
  note: string
  checkedAt?: string
  changedAt?: string
}

export interface OrderItem {
  id: string
  productId?: string
  title: string
  sku: string
  unitPrice: number
  qty: number
  /** The options chosen, e.g. "Size: 900 mm · Colour: Oak". */
  options?: string
}

export type OrderStatus = 'new' | 'confirmed' | 'paid' | 'fulfilled' | 'cancelled'

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'New',
  confirmed: 'Confirmed: awaiting payment',
  paid: 'Paid',
  fulfilled: 'Collected / delivered',
  cancelled: 'Cancelled',
}

export interface StoreOrder {
  id: string
  number: number
  /** The signed-in client or service provider who ordered; empty for a visitor. */
  customerId?: string
  name: string
  email: string
  phone: string
  delivery: 'pickup' | 'delivery'
  address: string
  notes: string
  /** Priced at trade. */
  trade: boolean
  total: number
  status: OrderStatus
  /** Store managers only. */
  adminNotes: string
  createdAt: string
  items: OrderItem[]
}

/** A product the AI assistant found on the web. */
export interface FoundProduct {
  name: string
  brand: string
  supplier: string
  url: string
  /** As shown on the page, e.g. "$1,249 inc. GST"; empty if not shown. */
  price: string
  category: string
  summary: string
  /** The photo on the product page (live mode), for the preview only; empty if none was found. */
  image?: string
}

/** A listing the AI assistant drafted for the admin to review. */
export interface DraftListing {
  title: string
  description: string
  specs: string[]
  category: string
  brand: string
  sku: string
  /** Retail price as shown, e.g. "1249.00"; empty if none. */
  suggested_price: string
  /** Things to check before publishing. */
  notes: string
  /** Photo links found on the page (newer drafts). */
  photos?: string[]
}

export type LeadStatus = 'new' | 'contacted' | 'won' | 'lost'
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', won: 'Won', lost: 'Not going ahead' }
export type LeadUrgency = 'urgent' | 'soon' | 'flexible'
export const LEAD_URGENCY_LABEL: Record<LeadUrgency, string> = { urgent: 'Urgent', soon: 'Within a few weeks', flexible: 'Flexible / planning' }

/** A maintenance request from the website, from someone without an account. */
export interface Lead {
  id: string
  number: number
  name: string
  email: string
  phone: string
  company: string
  suburb: string
  services: string[]
  urgency: LeadUrgency
  contactBy: 'phone' | 'email'
  message: string
  /** Photos of the job: storage paths (live) or images (demo). */
  photos: string[]
  status: LeadStatus
  /** Office notes. */
  notes: string
  /** The client account made from this lead. */
  clientId?: string
  createdAt: string
}

/** A text handed to an admin's phone (opened in Messages); whether it was sent isn't known. */
export interface TextLogEntry {
  id: string
  to: string
  message: string
  event: string
  /** Set by the database: who opened it, and when. */
  openedBy?: string
  openedAt: string
}

/** A standard quote to start new ones from. */
export interface QuoteTemplate {
  id: string
  name: string
  items: Omit<QuoteItem, 'id'>[]
  inclusions: string
  exclusions: string
  createdAt: string
}

export interface AppData {
  version: number
  users: UserAccount[]
  properties: Property[]
  requests: MaintenanceRequest[]
  projects: Project[]
  invoices: QuickBooksInvoice[]
  sms: SmsNotification[]
  smsSettings: SmsSettings
  bank: BankDetails
  inbox: InboxMessage[]
  products: Product[]
  orders: StoreOrder[]
  leads: Lead[]
  texts: TextLogEntry[]
  quoteTemplates: QuoteTemplate[]
  /** The store's margins (store managers). */
  pricing: Pricing
  /** Every change to products' prices (store managers). */
  priceHistory: PriceChange[]
}

/** Margins on the selling price, in %: 30 means price = cost ÷ 0.70. */
export interface Pricing {
  /** Visitors and anyone not signed in. */
  public: number
  /** Signed-in clients. */
  client: number
  /** Signed-in service providers. */
  trade: number
}
export const DEFAULT_PRICING: Pricing = { public: 30, client: 25, trade: 17 }

export interface PriceChange {
  id: string
  productId: string
  at: string
  reason: string
  costBasis?: number
  publicPrice?: number
  clientPrice?: number
  tradePrice?: number
  changedBy?: string
}
