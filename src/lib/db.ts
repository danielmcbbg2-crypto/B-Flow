/**
 * Maps the in-memory AppData model to the Supabase tables and back.
 *
 * Pages keep editing an AppData copy (see `update` in store.tsx). In cloud mode
 * the store diffs the before/after copies and turns the difference into
 * insert/update/delete calls, so row-level security on the server decides what
 * each person is actually allowed to change.
 */
import type {
  AppData,
  Expense,
  InboxMessage,
  MaintenanceRequest,
  Milestone,
  Project,
  Property,
  QuickBooksInvoice,
  SmsNotification,
  SmsSettings,
  UserAccount,
} from './types'
import { DATA_VERSION } from './seed'

export type Row = Record<string, unknown>

export const TABLES = [
  'profiles',
  'properties',
  'projects',
  'requests',
  'project_milestones',
  'project_expenses',
  'invoices',
  'inbox',
  'sms_log',
  'settings',
] as const
export type TableName = (typeof TABLES)[number]

export interface DbAdapter {
  select(table: TableName): Promise<Row[]>
  insert(table: TableName, rows: Row[]): Promise<void>
  update(table: TableName, id: string | number, patch: Row): Promise<void>
  remove(table: TableName, id: string | number): Promise<void>
}

export type Op =
  | { kind: 'insert'; table: TableName; rows: Row[] }
  | { kind: 'update'; table: TableName; id: string | number; patch: Row }
  | { kind: 'delete'; table: TableName; id: string | number }

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v)
const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v)
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v))

export const DEFAULT_SMS: SmsSettings = {
  provider: 'server',
  fromNumber: '',
  webhookUrl: '',
  recipients: [],
  notifyOnNewRequest: true,
  notifyOnUrgentOnly: false,
  notifyProviderOnAssign: true,
}

// ───────────── to rows ─────────────

const profileRow = (u: UserAccount): Row => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  company: nul(u.company),
  trade: nul(u.trade),
  permissions: u.permissions,
  status: u.status,
  created_at: u.createdAt,
})

const propertyRow = (p: Property): Row => ({
  id: p.id,
  client_id: p.clientId,
  address: p.address,
  suburb: p.suburb,
  postcode: p.postcode,
  paint_colors: p.paintColors,
  skirt_profile: p.skirtProfile,
  cladding_type: p.claddingType,
  access_code: p.accessCode,
  notes: p.notes,
  floor_plan: nul(p.floorPlan),
})

const requestRow = (r: MaintenanceRequest): Row => ({
  id: r.id,
  number: r.number,
  client_id: r.clientId,
  property_id: r.propertyId,
  title: r.title,
  description: r.description,
  category: r.category,
  urgency: r.urgency,
  photos: r.photos,
  completion_photos: r.completionPhotos,
  status: r.status,
  assigned_provider_id: nul(r.assignedProviderId),
  scheduled_date: nul(r.scheduledDate),
  notes: r.notes,
  sms_notified: r.smsNotified,
  created_at: r.createdAt,
  completed_at: nul(r.completedAt),
})

const projectRow = (p: Project): Row => ({
  id: p.id,
  number: p.number,
  client_id: p.clientId,
  property_id: p.propertyId,
  title: p.title,
  description: p.description,
  type: p.type,
  budget: p.budget,
  quote_amount: nul(p.quoteAmount),
  scope_of_works: p.scopeOfWorks,
  status: p.status,
  assigned_provider_id: nul(p.assignedProviderId),
  created_at: p.createdAt,
})

const milestoneRow = (projectId: string, m: Milestone): Row => ({ id: m.id, project_id: projectId, title: m.title, date: m.date, done: m.done })

const expenseRow = (projectId: string, e: Expense): Row => ({
  id: e.id,
  project_id: projectId,
  provider_id: e.providerId || null,
  date: e.date,
  description: e.description,
  category: e.category,
  amount: e.amount,
  status: e.status,
})

const invoiceRow = (i: QuickBooksInvoice): Row => ({
  id: i.id,
  request_id: nul(i.requestId),
  project_id: nul(i.projectId),
  client_id: i.clientId,
  qb_invoice_number: i.qbInvoiceNumber,
  amount: i.amount,
  status: i.status,
  bank_transfer_ref: i.bankTransferRef,
  paid_date: nul(i.paidDate),
  due_date: i.dueDate,
  created_at: i.createdAt,
})

const inboxRow = (m: InboxMessage): Row => ({
  id: m.id,
  user_id: m.userId,
  title: m.title,
  body: m.body,
  created_at: m.createdAt,
  read: m.read,
  requires_ack: m.requiresAck,
  acknowledged: m.acknowledged,
  request_id: nul(m.requestId),
  project_id: nul(m.projectId),
})

const smsRow = (s: SmsNotification): Row => ({
  id: s.id,
  recipient_phone: s.recipientPhone,
  message: s.message,
  sent_at: s.timestamp,
  status: s.status,
  trigger_event: s.triggerEvent,
  detail: nul(s.detail),
})

const settingsRow = (d: AppData): Row => ({
  id: 1,
  sms: {
    recipients: d.smsSettings.recipients,
    notifyOnNewRequest: d.smsSettings.notifyOnNewRequest,
    notifyOnUrgentOnly: d.smsSettings.notifyOnUrgentOnly,
    notifyProviderOnAssign: d.smsSettings.notifyProviderOnAssign,
  },
  bank: d.bank,
})

interface Spec {
  table: TableName
  rows: (d: AppData) => Row[]
  /** Columns the database generates; never sent on insert or update. */
  readonly?: string[]
}

// Parent tables first: inserts run in this order, deletes in reverse.
const SPECS: Spec[] = [
  { table: 'profiles', rows: (d) => d.users.map(profileRow) },
  { table: 'properties', rows: (d) => d.properties.map(propertyRow) },
  { table: 'projects', rows: (d) => d.projects.map(projectRow), readonly: ['number'] },
  { table: 'requests', rows: (d) => d.requests.map(requestRow), readonly: ['number'] },
  { table: 'project_milestones', rows: (d) => d.projects.flatMap((p) => p.milestones.map((m) => milestoneRow(p.id, m))) },
  { table: 'project_expenses', rows: (d) => d.projects.flatMap((p) => p.expenses.map((e) => expenseRow(p.id, e))) },
  { table: 'invoices', rows: (d) => d.invoices.map(invoiceRow) },
  { table: 'inbox', rows: (d) => d.inbox.map(inboxRow) },
  { table: 'sms_log', rows: (d) => d.sms.map(smsRow) },
  { table: 'settings', rows: (d) => [settingsRow(d)] },
]

const strip = (row: Row, cols: string[] = []) => {
  const out = { ...row }
  for (const c of cols) delete out[c]
  return out
}

/** Computes the database operations that turn `prev` into `next`. */
export function diff(prev: AppData, next: AppData): Op[] {
  const inserts: Op[] = []
  const updates: Op[] = []
  const deletes: Op[] = []
  for (const spec of SPECS) {
    const before = new Map(spec.rows(prev).map((r) => [r.id as string, r]))
    const after = new Map(spec.rows(next).map((r) => [r.id as string, r]))
    const added: Row[] = []
    for (const [id, row] of after) {
      const old = before.get(id)
      if (!old) {
        added.push(strip(row, spec.readonly))
        continue
      }
      const patch: Row = {}
      for (const k of Object.keys(row)) {
        if (spec.readonly?.includes(k)) continue
        if (JSON.stringify(row[k]) !== JSON.stringify(old[k])) patch[k] = row[k]
      }
      if (Object.keys(patch).length) updates.push({ kind: 'update', table: spec.table, id, patch })
    }
    if (added.length) inserts.push({ kind: 'insert', table: spec.table, rows: added })
    for (const id of before.keys()) if (!after.has(id)) deletes.unshift({ kind: 'delete', table: spec.table, id })
  }
  return [...inserts, ...updates, ...deletes]
}

export async function applyOps(db: DbAdapter, ops: Op[]): Promise<void> {
  for (const op of ops) {
    if (op.kind === 'insert') await db.insert(op.table, op.rows)
    else if (op.kind === 'update') await db.update(op.table, op.id, op.patch)
    else await db.remove(op.table, op.id)
  }
}

// ───────────── from rows ─────────────

export const userFromRow = (r: Row): UserAccount => ({
  id: r.id as string,
  name: r.name as string,
  email: r.email as string,
  role: r.role as UserAccount['role'],
  phone: (r.phone as string) ?? '',
  company: opt(r.company as string | null),
  trade: opt(r.trade as string | null),
  permissions: (r.permissions as UserAccount['permissions']) ?? [],
  createdAt: r.created_at as string,
  status: r.status as UserAccount['status'],
  passwordHash: '',
})

const propertyFromRow = (r: Row): Property => ({
  id: r.id as string,
  clientId: r.client_id as string,
  address: r.address as string,
  suburb: r.suburb as string,
  postcode: r.postcode as string,
  paintColors: r.paint_colors as Property['paintColors'],
  skirtProfile: r.skirt_profile as string,
  claddingType: r.cladding_type as string,
  accessCode: r.access_code as string,
  notes: r.notes as string,
  floorPlan: opt(r.floor_plan as string | null),
})

export const requestFromRow = (r: Row): MaintenanceRequest => ({
  id: r.id as string,
  number: num(r.number),
  clientId: r.client_id as string,
  propertyId: r.property_id as string,
  title: r.title as string,
  description: r.description as string,
  category: r.category as MaintenanceRequest['category'],
  urgency: r.urgency as MaintenanceRequest['urgency'],
  photos: (r.photos as string[]) ?? [],
  completionPhotos: (r.completion_photos as string[]) ?? [],
  status: r.status as MaintenanceRequest['status'],
  assignedProviderId: opt(r.assigned_provider_id as string | null),
  scheduledDate: opt(r.scheduled_date as string | null),
  notes: r.notes as string,
  smsNotified: r.sms_notified as boolean,
  createdAt: r.created_at as string,
  completedAt: opt(r.completed_at as string | null),
})

export const projectFromRow = (r: Row, milestones: Row[] = [], expenses: Row[] = []): Project => ({
  id: r.id as string,
  number: num(r.number),
  clientId: r.client_id as string,
  propertyId: r.property_id as string,
  title: r.title as string,
  description: r.description as string,
  type: r.type as Project['type'],
  budget: num(r.budget),
  quoteAmount: r.quote_amount === null || r.quote_amount === undefined ? undefined : num(r.quote_amount),
  scopeOfWorks: r.scope_of_works as string,
  status: r.status as Project['status'],
  assignedProviderId: opt(r.assigned_provider_id as string | null),
  createdAt: r.created_at as string,
  milestones: milestones
    .map((m) => ({ id: m.id as string, title: m.title as string, date: m.date as string, done: m.done as boolean }))
    .sort((a, b) => a.date.localeCompare(b.date)),
  expenses: expenses
    .map((e) => ({
      id: e.id as string,
      providerId: (e.provider_id as string | null) ?? '',
      date: e.date as string,
      description: e.description as string,
      category: e.category as Expense['category'],
      amount: num(e.amount),
      status: e.status as Expense['status'],
    }))
    .sort((a, b) => a.date.localeCompare(b.date)),
})

const invoiceFromRow = (r: Row): QuickBooksInvoice => ({
  id: r.id as string,
  requestId: opt(r.request_id as string | null),
  projectId: opt(r.project_id as string | null),
  clientId: r.client_id as string,
  qbInvoiceNumber: r.qb_invoice_number as string,
  amount: num(r.amount),
  status: r.status as QuickBooksInvoice['status'],
  bankTransferRef: r.bank_transfer_ref as string,
  paidDate: opt(r.paid_date as string | null),
  dueDate: r.due_date as string,
  createdAt: r.created_at as string,
})

const inboxFromRow = (r: Row): InboxMessage => ({
  id: r.id as string,
  userId: r.user_id as string,
  title: r.title as string,
  body: r.body as string,
  createdAt: r.created_at as string,
  read: r.read as boolean,
  requiresAck: r.requires_ack as boolean,
  acknowledged: r.acknowledged as boolean,
  requestId: opt(r.request_id as string | null),
  projectId: opt(r.project_id as string | null),
})

const smsFromRow = (r: Row): SmsNotification => ({
  id: r.id as string,
  recipientPhone: r.recipient_phone as string,
  message: r.message as string,
  timestamp: r.sent_at as string,
  status: r.status as SmsNotification['status'],
  triggerEvent: r.trigger_event as string,
  detail: opt(r.detail as string | null),
})

const newestFirst = (k: string) => (a: Row, b: Row) => String(b[k]).localeCompare(String(a[k]))

/** Loads everything the signed-in person is allowed to see. */
export async function fetchAll(db: DbAdapter): Promise<AppData> {
  const [profiles, properties, projects, requests, milestones, expenses, invoices, inbox, sms, settings] = await Promise.all(
    TABLES.map((t) => db.select(t)),
  )
  const byProject = (rows: Row[]) => {
    const m = new Map<string, Row[]>()
    for (const r of rows) m.set(r.project_id as string, [...(m.get(r.project_id as string) ?? []), r])
    return m
  }
  const ms = byProject(milestones)
  const ex = byProject(expenses)
  const s = settings[0] as { sms?: Partial<SmsSettings>; bank?: AppData['bank'] } | undefined
  return {
    version: DATA_VERSION,
    users: profiles.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(userFromRow),
    properties: properties.sort((a, b) => String(a.address).localeCompare(String(b.address))).map(propertyFromRow),
    requests: requests.sort(newestFirst('created_at')).map(requestFromRow),
    projects: projects.sort(newestFirst('created_at')).map((p) => projectFromRow(p, ms.get(p.id as string), ex.get(p.id as string))),
    invoices: invoices.sort(newestFirst('created_at')).map(invoiceFromRow),
    sms: sms.sort(newestFirst('sent_at')).map(smsFromRow),
    inbox: inbox.sort(newestFirst('created_at')).map(inboxFromRow),
    smsSettings: { ...DEFAULT_SMS, ...(s?.sms ?? {}) },
    bank: s?.bank ?? { accountName: 'Next Phase Maintenance', bsb: '', accountNumber: '' },
  }
}

export function emptyData(): AppData {
  return {
    version: DATA_VERSION,
    users: [],
    properties: [],
    requests: [],
    projects: [],
    invoices: [],
    sms: [],
    inbox: [],
    smsSettings: DEFAULT_SMS,
    bank: { accountName: 'Next Phase Maintenance', bsb: '', accountNumber: '' },
  }
}
