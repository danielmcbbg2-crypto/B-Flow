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
  /** Public image links (uploaded photos). */
  images: string[]
  status: 'draft' | 'published' | 'archived'
  stock: 'in_stock' | 'to_order' | 'out_of_stock'
  /** Store managers only: where it comes from. */
  source?: ProductSource
  createdBy?: string
  createdAt: string
}

export interface ProductSource {
  supplier: string
  url: string
  /** What it costs the business, inc. GST. */
  cost?: number
  notes: string
}

export interface OrderItem {
  id: string
  productId?: string
  title: string
  sku: string
  unitPrice: number
  qty: number
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
}
