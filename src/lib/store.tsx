import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import type {
  AppData,
  DraftListing,
  FoundProduct,
  InboxMessage,
  Lead,
  MaintenanceRequest,
  Permission,
  Product,
  Project,
  ProjectStatus,
  Property,
  Role,
  StoreOrder,
  SupplierStock,
  UserAccount,
} from './types'
import { BRAND, SITE_SERVICES } from './brand'
import { blankCommercials } from './quote'
import { createSeed, DATA_VERSION } from './seed'
import { dispatchSms } from './sms'
import { generateInviteCode, money, sha256, uid } from './utils'
import { applyOps, diff, emptyData, fetchAll, productsFromRows, profileRow, projectFromRow, propertyRow, requestFromRow, userFromRow } from './db'
import { ANON_KEY, CLOUD, DEMO, DEMO_BUILD, FUNCTIONS_URL, supabase, supabaseAdapter, uploadLeadPhoto, uploadPhoto } from './supabase'

const DATA_KEY = 'npm.data.v1'
const SESSION_KEY = 'npm.session.v1'
const ACTING_KEY = 'npm.actingAs.v1'

/**
 * In a dashboard an admin has opened for a client or trade, an action that person's own permission
 * would allow needs this admin permission instead (the same rule the database applies to admins).
 */
const ACTING_PERMISSION: Partial<Record<Permission, Permission>> = {
  canSubmitRequests: 'canDispatchJobs',
  canSubmitExpenses: 'canManageProjects',
}
const alwaysAllowed = () => true

function loadDemoData(): AppData {
  if (!DEMO_BUILD) return emptyData()
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed.version === DATA_VERSION) return parsed
    }
  } catch {
    /* fall through to seed */
  }
  return createSeed()
}

function loadDemoSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

/** Where Supabase email links (invites, password resets) send people back to. */
const appUrl = () => window.location.origin + window.location.pathname

async function invokeFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    let code: string | undefined
    try {
      const ctx = (error as { context?: Response }).context
      const json = ctx ? await ctx.json() : null
      if (json?.error) message = json.error
      code = json?.code
    } catch {
      /* keep the generic message */
    }
    // `code` lets the screen react to a known case (e.g. the AI assistant isn't set up yet).
    throw Object.assign(new Error(message), { code })
  }
  return data as T
}

/**
 * Calls a server function that answers as lines of JSON while it works (the AI product finder):
 * progress lines go to `onProgress`, and the last line is the result or the error.
 */
async function streamFunction<T>(name: string, body: Record<string, unknown>, onProgress?: (text: string) => void, signal?: AbortSignal): Promise<T> {
  const { data: auth } = await supabase!.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${auth.session?.access_token ?? ANON_KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => null)
    throw Object.assign(new Error(json?.error ?? `The request failed (${res.status}). Try again.`), { code: json?.code })
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim()
      buffer = buffer.slice(end + 1)
      if (!line) continue // keep-alive
      const msg = JSON.parse(line) as { type: string; text?: string; data?: T; error?: string; code?: string }
      if (msg.type === 'progress' && msg.text) onProgress?.(msg.text)
      else if (msg.type === 'result') return msg.data as T
      else if (msg.type === 'error') throw Object.assign(new Error(msg.error ?? 'Something went wrong.'), { code: msg.code })
    }
  }
  throw new Error('The assistant stopped before it finished. Try again.')
}

/** Waits like a slow server call would, for demo mode; rejects if `signal` is aborted. */
function demoWait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(t)
      reject(new DOMException('Stopped', 'AbortError'))
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', stop)
      resolve()
    }, ms)
    if (signal?.aborted) stop()
    else signal?.addEventListener('abort', stop, { once: true })
  })
}

/** A plain picture for demo results (live mode shows the supplier's photo). */
const demoPhoto = (label: string, hue: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue},25%,92%)"/><rect x="120" y="70" width="160" height="160" rx="12" fill="hsl(${hue},25%,70%)"/><text x="200" y="275" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#334155">${label}</text></svg>`,
  )}`

type AuthResult = { error?: string; role?: Role }
type NewRequest = Omit<MaintenanceRequest, 'id' | 'number' | 'createdAt' | 'status' | 'smsNotified' | 'completionPhotos' | 'notes'>
type InboxDraft = Omit<InboxMessage, 'id' | 'createdAt' | 'read' | 'acknowledged'>

/** A store order as the checkout sends it; prices are worked out by the database. */
export interface OrderInput {
  items: { productId: string; qty: number }[]
  name: string
  email: string
  phone: string
  delivery: StoreOrder['delivery']
  address: string
  notes: string
}

/** An enquiry from the website's quote form. */
export type LeadInput = Pick<Lead, 'name' | 'email' | 'phone' | 'company' | 'suburb' | 'urgency' | 'contactBy' | 'message'> & {
  /** One of the services on the website. */
  service: string
  /** Photos of the job, as image data URLs. */
  photos: string[]
}

/** A project an admin sets up, optionally with a new client (added without a login) and property. */
export interface NewProject {
  newClient?: UserAccount
  newProperty?: Property
  project: Pick<
    Project,
    'clientId' | 'propertyId' | 'title' | 'description' | 'type' | 'budget' | 'quoteAmount' | 'scopeOfWorks' | 'status' | 'assignedProviderId'
  >
}

/**
 * - `loading`: checking the session or loading data (cloud mode)
 * - `set-password`: arrived from an invite or reset email and must choose a password
 * - `ready`: normal operation (signed in or not)
 */
export type Phase = 'loading' | 'set-password' | 'ready'

interface StoreValue {
  /** True when connected to Supabase; false in single-browser demo mode. */
  cloud: boolean
  phase: Phase
  data: AppData
  user: UserAccount | null
  /** Problem saving or loading, shown as a banner. */
  syncError: string | null
  /** Message for the signed-out home page, e.g. after a suspended account is signed out. */
  authNotice: string | null
  /**
   * Who is really signed in. The same as `user`, except inside a dashboard an admin has opened for
   * someone else: there `user` is that client or trade and `actor` is the admin. Name `actor` in
   * anything that records who did something.
   */
  actor: UserAccount | null
  /** The client or trade whose dashboard the signed-in admin has open, if any. */
  actingAs: UserAccount | null
  /** Admins: open a client's or trade's dashboard, or leave it. */
  startActingAs: (id: string) => void
  stopActingAs: () => void
  /**
   * For actions in a client or trade portal that their owner may always take: true for the owner, and
   * in a dashboard an admin has opened, whether the admin holds the permission the database requires
   * of admins for it.
   */
  canAct: (adminPermission: Permission) => boolean
  /** Apply a mutation to a copy of the data and save it. Keep side effects out of `fn`. */
  update: (fn: (draft: AppData) => void) => void
  can: (p: Permission) => boolean
  login: (email: string, password: string) => Promise<AuthResult>
  /** Demo mode: activate an invite with its code. */
  acceptInvite: (email: string, code: string, password: string) => Promise<AuthResult>
  /** Cloud mode: email a password reset / setup link. */
  sendPasswordEmail: (email: string) => Promise<string | null>
  /** Cloud mode: finish an invite or reset by choosing a password. */
  setNewPassword: (password: string) => Promise<AuthResult>
  /** Cloud mode: sign in with a link made by "Create invite link" / "Create password link"; returns an error or null. */
  acceptLink: (tokenHash: string, type: string) => Promise<string | null>
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<string | null>
  /** SMS every admin recipient (admin only in cloud mode). */
  notifyAdmins: (message: string, triggerEvent: string) => Promise<void>
  /** SMS one number (admin only in cloud mode). */
  sendSms: (to: string, message: string, triggerEvent: string) => Promise<void>
  submitRequest: (req: NewRequest) => Promise<MaintenanceRequest>
  requestQuote: (q: { clientId: string; propertyId: string; title: string; description: string; budget: number }) => Promise<void>
  assignRequest: (requestId: string, providerId: string, scheduledDate: string, sms: boolean) => Promise<void>
  /** Published products for the public shop (visitors aren't signed in, so they don't have `data`). */
  loadCatalog: () => Promise<Product[]>
  /** Places a store order for anyone; throws with a message the customer can act on. */
  placeOrder: (o: OrderInput) => Promise<{ number: number; total: number }>
  /** Anyone, signed in or not: send a maintenance request (with photos) to the office. */
  submitLead: (l: LeadInput) => Promise<{ number: number }>
  leadPhotoUrls: (paths: string[]) => Promise<string[]>
  /** Stores a project document's file (live: the private project-docs bucket; demo: in the browser). */
  uploadProjectFile: (projectId: string, file: File) => Promise<{ path: string; sizeBytes: number; contentType: string }>
  /** A link to open a project document (live: a short-lived signed link). */
  projectFileUrl: (path: string) => Promise<string>
  /** Removes a project document and its file. */
  deleteProjectDocument: (projectId: string, documentId: string) => void
  /** Records that a text was opened in Messages on this device (who and when are set by the database). */
  logText: (to: string, message: string, event: string) => void
  deleteLead: (id: string) => void
  /**
   * Store managers: the AI assistant searches the web for products (sample results in demo mode).
   * `onProgress` hears what it's doing as it goes; aborting `signal` stops it.
   */
  findProducts: (query: string, onProgress?: (text: string) => void, signal?: AbortSignal) => Promise<{ products: FoundProduct[]; note: string }>
  /** Store managers: the AI assistant drafts a listing from a found product, for review. */
  draftListing: (product: FoundProduct, instructions?: string, onProgress?: (text: string) => void, signal?: AbortSignal) => Promise<DraftListing>
  /** New photos of the product on a supplier page, made by AI from the supplier's photos (store managers). */
  recreatePhotos: (url: string, title: string, onProgress?: (text: string) => void, signal?: AbortSignal) => Promise<{ images: string[]; references: string[] }>
  /**
   * What a supplier's page says about stock now. With a product id, the reading is saved (and the
   * listing switched if it ran out or came back); with a link, it's only read.
   */
  checkSupplierStock: (target: { productId: string } | { url: string }) => Promise<SupplierStock>
  /** Admins: create a project, with its client and property if they're new. Throws with a message if it can't be saved. */
  createProject: (p: NewProject) => Promise<Project>
  /** Message one person's inbox (admins). */
  pushInbox: (msg: InboxDraft) => void
  /** Message every admin's inbox (anyone signed in). */
  pushAdminInbox: (title: string, body: string, refs?: { requestId?: string; projectId?: string }) => Promise<void>
  /** Stores a photo and returns the URL (cloud) or the data URL itself (demo). */
  uploadImage: (dataUrl: string) => Promise<string>
  /**
   * Creates an invited account. Demo mode returns the invite code; cloud mode emails an invite
   * link, or with delivery 'link' returns it for the admin to send.
   */
  inviteAccount: (account: UserAccount, delivery?: 'email' | 'link') => Promise<{ error?: string; code?: string; link?: string }>
  /** Cloud mode: a fresh sign-in link for an existing account (new invite link, or password link). */
  getSignInLink: (profileId: string) => Promise<{ error?: string; link?: string }>
  deleteAccount: (id: string) => Promise<string | null>
  resetDemoData: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<AppData>(() => (CLOUD ? emptyData() : loadDemoData()))
  const [demoSessionId, setDemoSessionId] = useState<string | null>(() => (CLOUD ? null : loadDemoSession()))
  const [cloudProfile, setCloudProfile] = useState<UserAccount | null>(null)
  const [phase, setPhase] = useState<Phase>(CLOUD ? 'loading' : 'ready')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  // Kept for this tab only, so a reload stays in the dashboard but a new tab starts as the admin.
  const [actingAsId, setActingAsId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTING_KEY)
    } catch {
      return null
    }
  })

  const dataRef = useRef(data)
  const setData = useCallback((d: AppData) => {
    dataRef.current = d
    setDataState(d)
  }, [])

  // ───────────── demo-mode persistence ─────────────

  useEffect(() => {
    if (CLOUD) return
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data))
      setSyncError(null)
    } catch {
      setSyncError('Browser storage is full — recent changes (often photos) could not be saved. Remove some photos and try again.')
    }
  }, [data])

  useEffect(() => {
    if (CLOUD) return
    try {
      if (demoSessionId) localStorage.setItem(SESSION_KEY, demoSessionId)
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      /* session simply won't persist */
    }
  }, [demoSessionId])

  useEffect(() => {
    try {
      if (actingAsId) sessionStorage.setItem(ACTING_KEY, actingAsId)
      else sessionStorage.removeItem(ACTING_KEY)
    } catch {
      /* the dashboard simply won't survive a reload */
    }
  }, [actingAsId])

  // ───────────── cloud sync ─────────────

  const db = useMemo(() => (supabase ? supabaseAdapter(supabase) : null), [])
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const localVersion = useRef(0)
  const refreshWanted = useRef(false)
  const signedInAs = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!db || !signedInAs.current) return
    if (pending.current > 0) {
      refreshWanted.current = true
      return
    }
    const startedAt = localVersion.current
    try {
      const fresh = await fetchAll(db)
      // Drop the result if the person changed something while it was loading; another refresh follows the save.
      if (startedAt !== localVersion.current || pending.current > 0) {
        refreshWanted.current = true
        return
      }
      setData(fresh)
    } catch (e) {
      setSyncError(`Couldn't load the latest data: ${(e as Error).message}`)
    }
  }, [db, setData])

  const enqueueSave = useCallback(
    (prev: AppData, next: AppData) => {
      if (!db) return
      const ops = diff(prev, next)
      if (ops.length === 0) return
      pending.current++
      queue.current = queue.current
        .then(() => applyOps(db, ops))
        .then(() => setSyncError(null))
        .catch((e: Error) => {
          setSyncError(`Not saved — ${e.message}`)
          refreshWanted.current = true
        })
        .finally(() => {
          pending.current--
          if (pending.current === 0 && refreshWanted.current) {
            refreshWanted.current = false
            void refresh()
          }
        })
    },
    [db, refresh],
  )

  const update = useCallback(
    (fn: (draft: AppData) => void) => {
      const prev = dataRef.current
      const next = structuredClone(prev)
      fn(next)
      localVersion.current++
      setData(next)
      if (CLOUD) enqueueSave(prev, next)
    },
    [setData, enqueueSave],
  )

  /** Adds rows the server already created (e.g. a just-inserted request) without re-saving them. */
  const mergeLocal = useCallback(
    (fn: (draft: AppData) => void) => {
      const next = structuredClone(dataRef.current)
      fn(next)
      localVersion.current++
      setData(next)
    },
    [setData],
  )

  // ───────────── cloud auth ─────────────

  const recovering = useRef(false)
  const loadSession = useRef<(session: Session | null) => Promise<void>>(async () => {})

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let channel: RealtimeChannel | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const teardown = () => {
      if (channel) void client.removeChannel(channel)
      channel = null
      signedInAs.current = null
    }

    const load = async (session: Session | null) => {
      if (!session) {
        recovering.current = false
        teardown()
        setCloudProfile(null)
        setData(emptyData())
        setPhase('ready')
        return
      }
      if (signedInAs.current === session.user.id && !recovering.current) {
        setPhase('ready')
        return
      }
      setPhase('loading')
      const { data: rows, error } = await client.from('profiles').select('*').eq('auth_id', session.user.id)
      const row = rows?.[0]
      if (error || !row || row.status === 'suspended') {
        setAuthNotice(
          error
            ? `Couldn't load your account: ${error.message}`
            : !row
              ? "This login isn't linked to a Next Phase Maintenance account."
              : 'This account is suspended. Contact Next Phase Maintenance.',
        )
        await client.auth.signOut()
        return
      }
      const profile = userFromRow(row)
      setCloudProfile(profile)
      if (profile.status === 'invited' || recovering.current) {
        setPhase('set-password')
        return
      }
      teardown()
      signedInAs.current = session.user.id
      setAuthNotice(null)
      await refresh()
      channel = client
        .channel('npm-db')
        .on('postgres_changes', { event: '*', schema: 'public' }, () => {
          clearTimeout(timer)
          timer = setTimeout(() => void refresh(), 400)
        })
        .subscribe()
      setPhase('ready')
    }

    loadSession.current = load
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') recovering.current = true
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return
      // Supabase advises against awaiting its own calls inside this callback.
      setTimeout(() => void load(session), 0)
    })
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
      teardown()
    }
  }, [refresh, setData])

  // ───────────── identity ─────────────

  const user = useMemo(() => {
    if (CLOUD) {
      if (phase !== 'ready' || !cloudProfile) return null
      return data.users.find((u) => u.id === cloudProfile.id) ?? cloudProfile
    }
    const u = data.users.find((x) => x.id === demoSessionId)
    return u && u.status === 'active' ? u : null
  }, [data.users, demoSessionId, cloudProfile, phase])

  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user])

  const actingAs = useMemo(
    () => (user?.role === 'admin' && actingAsId ? data.users.find((u) => u.id === actingAsId && u.role !== 'admin') ?? null : null),
    [user, actingAsId, data.users],
  )
  const startActingAs = useCallback((id: string) => setActingAsId(id), [])
  const stopActingAs = useCallback(() => setActingAsId(null), [])

  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (supabase) {
      const { data: res, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) return { error: error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message }
      const { data: rows } = await supabase.from('profiles').select('role,status').eq('auth_id', res.user.id)
      const row = rows?.[0]
      if (!row) return { error: "This login isn't linked to a Next Phase Maintenance account." }
      if (row.status === 'suspended') return { error: 'This account is suspended. Contact Next Phase Maintenance.' }
      // The auth listener now loads the data; hold portal routes until it's ready.
      setPhase('loading')
      return { role: row.role as Role }
    }
    const u = dataRef.current.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u) return { error: 'No account found for that email. Accounts are invite-only.' }
    if (u.status === 'invited') return { error: 'This account has a pending invite. Use “I have an invite code” to set your password.' }
    if (u.status === 'suspended') return { error: 'This account is suspended. Contact Next Phase Maintenance.' }
    if ((await sha256(password)) !== u.passwordHash) return { error: 'Incorrect password.' }
    setDemoSessionId(u.id)
    return { role: u.role }
  }, [])

  const acceptInvite = useCallback(
    async (email: string, code: string, password: string): Promise<AuthResult> => {
      const u = dataRef.current.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
      if (!u || u.status !== 'invited' || !u.inviteCode) return { error: 'No pending invite for that email.' }
      if (u.inviteCode.toUpperCase() !== code.trim().toUpperCase()) return { error: 'Invite code does not match.' }
      if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
      const hash = await sha256(password)
      update((d) => {
        const target = d.users.find((x) => x.id === u.id)!
        target.passwordHash = hash
        target.status = 'active'
        delete target.inviteCode
      })
      setDemoSessionId(u.id)
      return { role: u.role }
    },
    [update],
  )

  const sendPasswordEmail = useCallback(async (email: string) => {
    if (!supabase) return 'Not available in demo mode.'
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() })
    return error ? error.message : null
  }, [])

  const acceptLink = useCallback(async (tokenHash: string, type: string) => {
    if (!supabase) return 'Not available in demo mode.'
    if (!tokenHash || (type !== 'invite' && type !== 'recovery')) return 'This link is not valid.'
    setAuthNotice(null)
    // Every link an admin sends ends at "Choose your password", whichever kind of token it carries.
    recovering.current = true
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return null
    recovering.current = false
    return error.status === 403 || error.code === 'otp_expired'
      ? 'This link has expired or has already been used. Ask Next Phase Maintenance for a new one.'
      : "Couldn't check your link. Check your connection and press Continue again."
  }, [])

  const setNewPassword = useCallback(
    async (password: string): Promise<AuthResult> => {
      if (!supabase) return { error: 'Not available in demo mode.' }
      if (password.length < 8) return { error: 'Password must be at least 8 characters.' }
      const { data: s } = await supabase.auth.getSession()
      if (!s.session) return { error: 'Your link has expired. Ask for a new one from Sign in → Forgot password.' }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) return { error: error.message }
      const { error: rpcError } = await supabase.rpc('activate_my_account')
      if (rpcError) return { error: rpcError.message }
      recovering.current = false
      signedInAs.current = null
      // Run the normal signed-in load now that the account is active.
      await loadSession.current(s.session)
      return { role: cloudProfile?.role }
    },
    [cloudProfile],
  )

  const logout = useCallback(async () => {
    setActingAsId(null)
    if (supabase) {
      await supabase.auth.signOut()
      return
    }
    setDemoSessionId(null)
  }, [])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (next.length < 8) return 'New password must be at least 8 characters.'
      if (supabase) {
        if (!user) return 'Not signed in.'
        const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: current })
        if (authError) return 'Current password is incorrect.'
        const { error } = await supabase.auth.updateUser({ password: next })
        return error ? error.message : null
      }
      const u = dataRef.current.users.find((x) => x.id === demoSessionId)
      if (!u) return 'Not signed in.'
      if ((await sha256(current)) !== u.passwordHash) return 'Current password is incorrect.'
      const hash = await sha256(next)
      update((d) => {
        d.users.find((x) => x.id === u.id)!.passwordHash = hash
      })
      return null
    },
    [demoSessionId, update, user],
  )

  // ───────────── SMS ─────────────

  const reportError = useCallback((e: unknown) => setSyncError((e as Error).message), [])

  const sendSms = useCallback(
    async (to: string, message: string, triggerEvent: string) => {
      if (supabase) {
        await invokeFunction('send-sms', { kind: 'direct', to, message, event: triggerEvent }).catch(reportError)
        return
      }
      const entry = await dispatchSms(dataRef.current.smsSettings, to, message, triggerEvent)
      update((d) => {
        d.sms.unshift(entry)
      })
    },
    [update, reportError],
  )

  const notifyAdmins = useCallback(
    async (message: string, triggerEvent: string) => {
      if (supabase) {
        await invokeFunction('send-sms', { kind: 'admins', message, event: triggerEvent }).catch(reportError)
        return
      }
      const recipients = dataRef.current.smsSettings.recipients.filter(Boolean)
      if (recipients.length === 0) {
        await sendSms('(no admin numbers set)', message, triggerEvent)
        return
      }
      await Promise.all(recipients.map((r) => sendSms(r, message, triggerEvent)))
    },
    [sendSms, reportError],
  )

  // ───────────── inbox ─────────────

  const pushInbox = useCallback(
    (msg: InboxDraft) => {
      update((d) => {
        d.inbox.unshift({ ...msg, id: uid('n'), createdAt: new Date().toISOString(), read: false, acknowledged: false })
      })
    },
    [update],
  )

  const pushAdminInbox = useCallback(
    async (title: string, body: string, refs: { requestId?: string; projectId?: string } = {}) => {
      if (supabase) {
        const { error } = await supabase.rpc('notify_admins', {
          p_title: title,
          p_body: body,
          p_request_id: refs.requestId ?? null,
          p_project_id: refs.projectId ?? null,
        })
        if (error) setSyncError(error.message)
        return
      }
      update((d) => {
        for (const a of d.users.filter((u) => u.role === 'admin' && u.status === 'active')) {
          d.inbox.unshift({ id: uid('n'), userId: a.id, title, body, createdAt: new Date().toISOString(), read: false, requiresAck: false, acknowledged: false, ...refs })
        }
      })
    },
    [update],
  )

  // ───────────── workflows ─────────────

  const submitRequest = useCallback(
    async (input: NewRequest): Promise<MaintenanceRequest> => {
      if (supabase) {
        const { data: row, error } = await supabase
          .from('requests')
          .insert({
            client_id: input.clientId,
            property_id: input.propertyId,
            title: input.title,
            description: input.description,
            category: input.category,
            urgency: input.urgency,
            photos: input.photos,
          })
          .select()
          .single()
        if (error) throw new Error(error.message)
        const req = requestFromRow(row)
        mergeLocal((d) => {
          d.requests.unshift(req)
        })
        // The server decides whether to SMS based on the admin's trigger settings.
        await invokeFunction('send-sms', { kind: 'new_request', requestId: req.id }).catch(reportError)
        return req
      }
      const d0 = dataRef.current
      const number = Math.max(1000, ...d0.requests.map((r) => r.number)) + 1
      const settings = d0.smsSettings
      const shouldSms = settings.notifyOnNewRequest && (!settings.notifyOnUrgentOnly || input.urgency === 'urgent')
      const req: MaintenanceRequest = {
        ...input,
        id: uid('r'),
        number,
        createdAt: new Date().toISOString(),
        status: 'pending',
        smsNotified: shouldSms,
        completionPhotos: [],
        notes: '',
        createdBy: user?.id,
      }
      update((d) => {
        d.requests.unshift(req)
      })
      if (shouldSms) {
        const prop = d0.properties.find((p) => p.id === input.propertyId)
        const where = prop ? ` · ${prop.address}, ${prop.suburb}` : ''
        await notifyAdmins(`NPM #${number}${input.urgency === 'urgent' ? ' URGENT' : ''} — ${input.title}${where} (${input.category})`, 'New maintenance request')
      }
      return req
    },
    [update, mergeLocal, notifyAdmins, reportError, user],
  )

  /** The client's name, or "Admin for Client" when an admin did it from the client's dashboard. */
  const requester = useCallback(
    (clientId: string) => {
      const client = dataRef.current.users.find((u) => u.id === clientId)
      const name = client?.name ?? 'Client'
      return user && user.id !== clientId ? `${user.name} for ${name}` : name
    },
    [user],
  )

  const requestQuote = useCallback(
    async (q: { clientId: string; propertyId: string; title: string; description: string; budget: number }) => {
      if (supabase) {
        const { data: row, error } = await supabase
          .from('projects')
          .insert({ client_id: q.clientId, property_id: q.propertyId, title: q.title, description: q.description, budget: q.budget })
          .select()
          .single()
        if (error) throw new Error(error.message)
        const project: Project = projectFromRow(row)
        mergeLocal((d) => {
          d.projects.unshift(project)
        })
        await pushAdminInbox(`Quote request P-${project.number}`, `${requester(q.clientId)}: ${q.title}`, { projectId: project.id })
        await invokeFunction('send-sms', { kind: 'quote_request', projectId: project.id }).catch(reportError)
        return
      }
      const d0 = dataRef.current
      const number = Math.max(200, ...d0.projects.map((p) => p.number)) + 1
      const id = uid('pr')
      update((d) => {
        d.projects.unshift({
          ...blankCommercials(),
          id,
          number,
          clientId: q.clientId,
          propertyId: q.propertyId,
          title: q.title,
          description: q.description,
          type: 'renovation',
          budget: q.budget,
          scopeOfWorks: '',
          status: 'quote_requested',
          milestones: [],
          expenses: [],
          createdAt: new Date().toISOString(),
          createdBy: user?.id,
        })
      })
      await pushAdminInbox(`Quote request P-${number}`, `${requester(q.clientId)}: ${q.title}`, { projectId: id })
      await notifyAdmins(`NPM quote request P-${number} — ${q.title} (${requester(q.clientId)})`, 'Renovation quote request')
    },
    [update, mergeLocal, pushAdminInbox, notifyAdmins, reportError, requester, user],
  )

  const assignRequest = useCallback(
    async (requestId: string, providerId: string, scheduledDate: string, sms: boolean) => {
      const d0 = dataRef.current
      const req = d0.requests.find((r) => r.id === requestId)
      const provider = d0.users.find((u) => u.id === providerId)
      if (!req || !provider) return
      const prop = d0.properties.find((p) => p.id === req.propertyId)
      const where = prop ? `${prop.address}, ${prop.suburb}` : ''
      update((d) => {
        const r = d.requests.find((x) => x.id === requestId)!
        r.assignedProviderId = providerId
        r.scheduledDate = scheduledDate || undefined
        if (r.status === 'pending') r.status = 'assigned'
        d.inbox.unshift({
          id: uid('n'),
          userId: providerId,
          title: `New work order #${req.number}`,
          body: `${req.title} — ${where}${scheduledDate ? `. Scheduled ${scheduledDate}` : ''}. Please acknowledge.`,
          createdAt: new Date().toISOString(),
          read: false,
          requiresAck: true,
          acknowledged: false,
          requestId,
        })
      })
      if (sms && provider.phone) {
        await sendSms(
          provider.phone,
          `Next Phase Maintenance: work order #${req.number} assigned — ${req.title}, ${where}${scheduledDate ? ` on ${scheduledDate}` : ''}.`,
          'Provider assignment',
        )
      }
    },
    [update, sendSms],
  )

  const createProject = useCallback(
    async ({ newClient, newProperty, project: p }: NewProject): Promise<Project> => {
      // A client or property already saved by an earlier attempt (that failed later on) isn't added again.
      const d0 = dataRef.current
      const client = newClient && !d0.users.some((u) => u.id === newClient.id) ? newClient : undefined
      const property = newProperty && !d0.properties.some((x) => x.id === newProperty.id) ? newProperty : undefined
      const owner = property?.clientId ?? d0.properties.find((x) => x.id === p.propertyId)?.clientId
      if (owner !== p.clientId) throw new Error('That property belongs to another client. Choose one of theirs or add a new one.')
      const notify = (saved: Project) => {
        if (saved.assignedProviderId) {
          pushInbox({ userId: saved.assignedProviderId, title: `Assigned to project P-${saved.number}`, body: saved.title, requiresAck: true, projectId: saved.id })
        }
        if (saved.status === 'quoted') {
          pushInbox({
            userId: saved.clientId,
            title: `Quote ready: ${saved.title}`,
            body: `Quoted at ${money(saved.quoteAmount ?? 0)}. Review it under Projects.`,
            requiresAck: false,
            projectId: saved.id,
          })
        }
      }
      if (supabase) {
        // Saved one at a time, straight away, so the project can refer to them and any error is shown.
        if (client) {
          const { error } = await supabase.from('profiles').insert(profileRow(client))
          if (error) throw new Error(error.code === '23505' ? 'Another account already uses this email.' : error.message)
          mergeLocal((d) => {
            d.users.push(client)
          })
        }
        if (property) {
          const { error } = await supabase.from('properties').insert(propertyRow(property))
          if (error) throw new Error(error.message)
          mergeLocal((d) => {
            d.properties.push(property)
          })
        }
        const { data: row, error } = await supabase
          .from('projects')
          .insert({
            client_id: p.clientId,
            property_id: p.propertyId,
            title: p.title,
            description: p.description,
            type: p.type,
            budget: p.budget,
            quote_amount: p.quoteAmount ?? null,
            scope_of_works: p.scopeOfWorks,
            status: p.status,
            assigned_provider_id: p.assignedProviderId ?? null,
          })
          .select()
          .single()
        if (error) throw new Error(error.message)
        const saved = projectFromRow(row)
        mergeLocal((d) => {
          d.projects.unshift(saved)
        })
        notify(saved)
        return saved
      }
      const saved: Project = {
        ...p,
        id: uid('pr'),
        number: Math.max(200, ...d0.projects.map((x) => x.number)) + 1,
        ...blankCommercials(),
        milestones: [],
        expenses: [],
        createdAt: new Date().toISOString(),
        createdBy: user?.id,
      }
      update((d) => {
        if (client) d.users.push(client)
        if (property) d.properties.push(property)
        d.projects.unshift(saved)
      })
      notify(saved)
      return saved
    },
    [update, mergeLocal, pushInbox, user],
  )

  // ───────────── store ─────────────

  const loadCatalog = useCallback(async (): Promise<Product[]> => {
    if (supabase) {
      const rows = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('products').select('*').eq('status', 'published').order('id').range(from, from + 999)
        if (error) throw new Error(error.message)
        rows.push(...(data ?? []))
        if (!data || data.length < 1000) return productsFromRows(rows)
      }
    }
    return dataRef.current.products.filter((p) => p.status === 'published')
  }, [])

  const placeOrder = useCallback(
    async (o: OrderInput): Promise<{ number: number; total: number }> => {
      if (supabase) {
        const { data: res, error } = await supabase.rpc('place_order', {
          p_items: o.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
          p_name: o.name,
          p_email: o.email,
          p_phone: o.phone,
          p_delivery: o.delivery,
          p_address: o.address,
          p_notes: o.notes,
        })
        if (error) throw new Error(error.message)
        if (user) await refresh()
        const r = res as { number: number; total: number | string }
        return { number: r.number, total: Number(r.total) }
      }
      // Demo mode follows the same rules as the database.
      const d0 = dataRef.current
      if (!o.name.trim()) throw new Error('Enter your name')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email.trim())) throw new Error('Enter a valid email address')
      if (o.phone.replace(/\D/g, '').length < 8) throw new Error('Enter a phone number we can reach you on')
      if (o.delivery === 'delivery' && !o.address.trim()) throw new Error('Enter the delivery address')
      if (o.items.length === 0) throw new Error('Your cart is empty')
      if (o.items.length > 30) throw new Error('Up to 30 different products per order. Please split it into two orders.')
      const trade = user?.role === 'provider' && user.status === 'active'
      const unavailable = o.items
        .map((i) => ({ i, p: d0.products.find((p) => p.id === i.productId) }))
        .filter(({ p }) => !p || p.status !== 'published' || p.stock === 'out_of_stock')
      if (unavailable.length) throw new Error(`No longer available: ${unavailable.map(({ p }) => p?.title ?? 'an item').join(', ')}`)
      const items = o.items.map((i) => {
        const p = d0.products.find((x) => x.id === i.productId)!
        return { id: uid('oi'), productId: p.id, title: p.title, sku: p.sku, unitPrice: trade && p.tradePrice !== undefined ? p.tradePrice : p.price, qty: i.qty }
      })
      const total = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
      const number = Math.max(5000, ...d0.orders.map((x) => x.number)) + 1
      update((d) => {
        d.orders.unshift({
          id: uid('o'),
          number,
          customerId: user?.id,
          name: o.name.trim(),
          email: o.email.trim(),
          phone: o.phone.trim(),
          delivery: o.delivery,
          address: o.address.trim(),
          notes: o.notes.trim(),
          trade,
          total,
          status: 'new',
          adminNotes: '',
          createdAt: new Date().toISOString(),
          items,
        })
        for (const a of d.users.filter((u) => u.role === 'admin' && u.status === 'active')) {
          d.inbox.unshift({
            id: uid('n'),
            userId: a.id,
            title: `New store order #${number}`,
            body: `${o.name.trim()}${trade ? ' (trade)' : ''} — ${items.reduce((s, i) => s + i.qty, 0)} item(s), ${money(total)}, ${o.delivery}`,
            createdAt: new Date().toISOString(),
            read: false,
            requiresAck: false,
            acknowledged: false,
          })
        }
      })
      return { number, total }
    },
    [update, refresh, user],
  )

  const submitLead = useCallback(
    async (l: LeadInput): Promise<{ number: number }> => {
      const email = l.email.trim()
      const phone = l.phone.trim()
      // Checked here too so a visitor's photos aren't uploaded for a request that would be refused.
      if (!(SITE_SERVICES as readonly string[]).includes(l.service)) throw new Error('Choose the service you need')
      if (l.photos.length === 0) throw new Error('Add at least one photo of the job')
      if (l.photos.length > 6) throw new Error('Up to 6 photos, please')
      if (!l.message.trim()) throw new Error('Tell us what needs doing')
      if (!l.name.trim()) throw new Error('Enter your name')
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address')
      if (phone && phone.replace(/\D/g, '').length < 8) throw new Error('Enter a valid phone number')
      if (!email && !phone) throw new Error('Leave a phone number or email so we can reply')
      if (supabase) {
        const client = supabase
        const photos = await Promise.all(l.photos.map((p) => uploadLeadPhoto(client, p)))
        const { data: res, error } = await client.rpc('submit_lead', {
          p_name: l.name,
          p_email: email,
          p_phone: phone,
          p_suburb: l.suburb,
          p_service: l.service,
          p_urgency: l.urgency,
          p_contact_by: l.contactBy,
          p_message: l.message,
          p_photos: photos,
          p_company: l.company,
        })
        if (error) throw new Error(error.message)
        return { number: (res as { number: number }).number }
      }
      // Demo mode follows the same rules as the database; photos stay in this browser.
      const contactBy = l.contactBy === 'phone' ? (phone ? 'phone' : 'email') : email ? 'email' : 'phone'
      const number = Math.max(3000, ...dataRef.current.leads.map((x) => x.number)) + 1
      update((d) => {
        d.leads.unshift({
          id: uid('l'),
          number,
          name: l.name.trim(),
          email,
          phone,
          company: l.company.trim(),
          suburb: l.suburb.trim(),
          services: [l.service],
          urgency: l.urgency,
          contactBy,
          message: l.message.trim(),
          photos: l.photos,
          status: 'new',
          notes: '',
          createdAt: new Date().toISOString(),
        })
        const office = d.users.filter((u) => u.role === 'admin' && u.status === 'active' && (u.permissions.includes('canManageProjects') || u.permissions.includes('canDispatchJobs')))
        for (const a of office) {
          d.inbox.unshift({
            id: uid('n'),
            userId: a.id,
            title: `${l.urgency === 'urgent' ? 'Urgent request' : 'New maintenance request'} #${number}: ${l.name.trim()}`,
            body: [l.service, l.suburb.trim(), `${l.photos.length} photo${l.photos.length > 1 ? 's' : ''}`, contactBy === 'phone' ? `call ${phone}` : `email ${email}`].filter(Boolean).join(' · '),
            createdAt: new Date().toISOString(),
            read: false,
            requiresAck: false,
            acknowledged: false,
          })
        }
      })
      return { number }
    },
    [update],
  )

  const logText = useCallback(
    (to: string, message: string, event: string) => {
      update((d) => {
        d.texts.unshift({ id: uid('t'), to: to.trim().slice(0, 40), message: message.slice(0, 2000), event: event.slice(0, 120), openedBy: user?.id, openedAt: new Date().toISOString() })
      })
    },
    [update, user],
  )

  const uploadProjectFile = useCallback(async (projectId: string, file: File) => {
    if (file.size > 25 * 1024 * 1024) throw new Error('Files can be up to 25 MB.')
    if (supabase) {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file'
      const path = `${projectId}/${crypto.randomUUID()}/${safe}`
      const { error } = await supabase.storage.from('project-docs').upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (error) throw new Error(`Upload failed: ${error.message}`)
      return { path, sizeBytes: file.size, contentType: file.type }
    }
    // Demo mode keeps the file in this browser, so only small ones fit.
    if (file.size > 1.5 * 1024 * 1024) throw new Error('In demo mode files can be up to 1.5 MB.')
    const path = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    return { path, sizeBytes: file.size, contentType: file.type }
  }, [])

  const projectFileUrl = useCallback(async (path: string) => {
    if (!supabase || path.startsWith('data:')) return path
    const { data: link, error } = await supabase.storage.from('project-docs').createSignedUrl(path, 600)
    if (error || !link) throw new Error(error?.message ?? 'Could not open the file')
    return link.signedUrl
  }, [])

  const deleteProjectDocument = useCallback(
    (projectId: string, documentId: string) => {
      const doc = dataRef.current.projects.find((p) => p.id === projectId)?.documents.find((x) => x.id === documentId)
      update((d) => {
        const p = d.projects.find((x) => x.id === projectId)
        if (p) p.documents = p.documents.filter((x) => x.id !== documentId)
      })
      if (supabase && doc && !doc.path.startsWith('data:')) void supabase.storage.from('project-docs').remove([doc.path])
    },
    [update],
  )

  /** Viewable links for a request's photos (live: short-lived signed links; demo: the images themselves). */
  const leadPhotoUrls = useCallback(async (paths: string[]): Promise<string[]> => {
    if (!supabase || paths.length === 0) return paths
    const { data, error } = await supabase.storage.from('lead-photos').createSignedUrls(paths, 3600)
    if (error) throw new Error(error.message)
    return data.map((x) => x.signedUrl ?? '')
  }, [])

  /** Removes a request (e.g. spam) and, live, its photos. */
  const deleteLead = useCallback(
    (id: string) => {
      const photos = dataRef.current.leads.find((l) => l.id === id)?.photos ?? []
      update((d) => {
        d.leads = d.leads.filter((l) => l.id !== id)
      })
      if (supabase && photos.length) void supabase.storage.from('lead-photos').remove(photos)
    },
    [update],
  )

  const findProducts = useCallback(async (query: string, onProgress?: (text: string) => void, signal?: AbortSignal) => {
    if (supabase) return streamFunction<{ products: FoundProduct[]; note: string }>('store-assistant', { action: 'find', query }, onProgress, signal)
    const q = query.trim() || 'bathroom products'
    onProgress?.(`Searching: ${q}`)
    await demoWait(500, signal)
    onProgress?.('Found 3. Getting photos…')
    await demoWait(300, signal)
    const sample = (n: number, brand: string, price: string, hue: number): FoundProduct => ({
      name: `${brand} ${q} (option ${n})`,
      brand,
      supplier: `${brand} Australia`,
      url: `https://example.com/${brand.toLowerCase()}-${n}`,
      price,
      category: 'Other',
      summary: `Sample result for “${q}”. In live mode the assistant searches the web for real products sold in Australia.`,
      image: n === 3 ? '' : demoPhoto(`${brand} (sample)`, hue),
    })
    return {
      products: [sample(1, 'Aqualine', '$449 inc. GST', 200), sample(2, 'Stonebridge', '$689 inc. GST', 30), sample(3, 'Hydro', '', 140)],
      note: 'Demo mode: these are sample results.',
    }
  }, [])

  const draftListing = useCallback(
    async (product: FoundProduct, instructions?: string, onProgress?: (text: string) => void, signal?: AbortSignal): Promise<DraftListing> => {
      if (supabase) {
        return (await streamFunction<{ listing: DraftListing }>('store-assistant', { action: 'draft', product, instructions }, onProgress, signal)).listing
      }
      onProgress?.(`Reading ${product.supplier}…`)
      await demoWait(400, signal)
      return {
        title: product.name || `Sample product from ${product.supplier}`,
        description: `${product.summary || 'A sample description.'}\n\nNext Phase Maintenance can supply and install it.`,
        specs: ['Sample spec: check the supplier page'],
        category: product.category,
        brand: product.brand,
        sku: '',
        suggested_price: product.price.replace(/[^0-9.]/g, ''),
        notes: 'Demo mode: this draft is a sample. In live mode the assistant reads the product page and writes an original description.',
      }
    },
    [],
  )

  const recreatePhotos = useCallback(async (url: string, title: string, onProgress?: (text: string) => void, signal?: AbortSignal) => {
    if (supabase) return streamFunction<{ images: string[]; references: string[] }>('store-assistant', { action: 'images', url, title }, onProgress, signal)
    onProgress?.('Finding the supplier’s photos…')
    await demoWait(300, signal)
    onProgress?.('Creating new photo 1 of 2 (studio shot)…')
    await demoWait(300, signal)
    onProgress?.('Creating new photo 2 of 2 (in a room)…')
    await demoWait(300, signal)
    return { images: [demoPhoto('New studio photo (demo)', 210), demoPhoto('New room photo (demo)', 35)], references: [] }
  }, [])

  const checkSupplierStock = useCallback(
    async (target: { productId: string } | { url: string }): Promise<SupplierStock> => {
      if (supabase) {
        const { data: auth } = await supabase.auth.getSession()
        const res = await fetch(`${FUNCTIONS_URL}/supplier-stock`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${auth.session?.access_token ?? ANON_KEY}` },
          body: JSON.stringify(target),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) throw new Error(json?.error ?? `The stock check failed (${res.status}). Try again.`)
        const r = (json.reading ?? json) as { status: SupplierStock['status']; qty: number | null; price: number | null; note: string }
        const reading: SupplierStock = { status: r.status, qty: r.qty ?? undefined, price: r.price ?? undefined, note: r.note, checkedAt: new Date().toISOString() }
        // The listing may have switched too: reload what the server saved.
        if ('productId' in target) void refresh()
        return reading
      }
      // Demo mode: a sample reading for a saved product; a new link isn't read.
      if (!('productId' in target)) return { status: 'unknown', note: 'Demo mode: the supplier’s page isn’t checked.' }
      const reading: SupplierStock = { status: 'in_stock', qty: 12, note: 'Demo mode: a sample reading. In live mode the supplier’s page is checked.', checkedAt: new Date().toISOString() }
      if ('productId' in target)
        update((d) => {
          const p = d.products.find((x) => x.id === target.productId)
          if (p?.source) p.source.supplierStock = { ...reading, changedAt: p.source.supplierStock?.changedAt }
        })
      return reading
    },
    [update, refresh],
  )

  // ───────────── accounts & files ─────────────

  const uploadImage = useCallback(async (dataUrl: string) => (supabase ? uploadPhoto(supabase, dataUrl) : dataUrl), [])

  const inviteAccount = useCallback(
    async (account: UserAccount, delivery: 'email' | 'link' = 'email'): Promise<{ error?: string; code?: string; link?: string }> => {
      if (supabase) {
        try {
          const res = await invokeFunction<{ link?: string }>('invite-user', {
            action: 'invite',
            delivery,
            redirectTo: appUrl(),
            profile: {
              name: account.name,
              email: account.email,
              role: account.role,
              phone: account.phone,
              company: account.company ?? null,
              trade: account.trade ?? null,
              permissions: account.permissions,
            },
          })
          await refresh()
          return { link: res?.link }
        } catch (e) {
          return { error: (e as Error).message }
        }
      }
      const code = account.inviteCode ?? generateInviteCode()
      update((d) => {
        d.users.push({ ...account, inviteCode: code, status: 'invited', passwordHash: '' })
      })
      return { code }
    },
    [update, refresh],
  )

  const getSignInLink = useCallback(async (profileId: string): Promise<{ error?: string; link?: string }> => {
    if (!supabase) return { error: 'Not available in demo mode.' }
    try {
      const res = await invokeFunction<{ link: string }>('invite-user', { action: 'link', profileId, redirectTo: appUrl() })
      // The first link creates the login, which locks the email address in place.
      await refresh()
      return { link: res.link }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [refresh])

  const deleteAccount = useCallback(
    async (id: string) => {
      if (supabase) {
        try {
          await invokeFunction('invite-user', { action: 'delete', profileId: id })
          await refresh()
          return null
        } catch (e) {
          return (e as Error).message
        }
      }
      // Demo mode mirrors the database rules: job and invoice history is kept, and so is the record
      // of work done for other people (by admins).
      const d0 = dataRef.current
      const hasHistory =
        d0.requests.some((r) => r.clientId === id) || d0.projects.some((p) => p.clientId === id) || d0.invoices.some((i) => i.clientId === id)
      if (hasHistory) return 'This account has jobs or invoices on record, so it can’t be deleted. Suspend it instead.'
      const actedForOthers =
        d0.requests.some((r) => r.createdBy === id && r.clientId !== id) ||
        d0.projects.some((p) => p.clientId !== id && (p.createdBy === id || p.quoteDecidedBy === id)) ||
        d0.projects.some((p) => p.expenses.some((e) => e.createdBy === id && e.providerId !== id)) ||
        d0.inbox.some((m) => m.acknowledgedBy === id && m.userId !== id)
      if (actedForOthers) return 'This account has done work for other people on record, so it can’t be deleted. Suspend it instead.'
      update((d) => {
        d.users = d.users.filter((x) => x.id !== id)
        d.properties = d.properties.filter((p) => p.clientId !== id)
        d.inbox = d.inbox.filter((m) => m.userId !== id)
        for (const r of d.requests) if (r.assignedProviderId === id) r.assignedProviderId = undefined
        for (const p of d.projects) {
          if (p.assignedProviderId === id) p.assignedProviderId = undefined
          for (const e of p.expenses) {
            if (e.providerId === id) e.providerId = ''
            if (e.createdBy === id) e.createdBy = undefined
          }
        }
      })
      return null
    },
    [update, refresh],
  )

  const resetDemoData = useCallback(() => {
    if (DEMO) setData(createSeed())
  }, [setData])

  const value: StoreValue = {
    cloud: CLOUD,
    phase,
    data,
    user,
    actor: user,
    actingAs,
    startActingAs,
    stopActingAs,
    canAct: alwaysAllowed,
    syncError,
    authNotice,
    update,
    can,
    login,
    acceptInvite,
    sendPasswordEmail,
    setNewPassword,
    acceptLink,
    logout,
    changePassword,
    notifyAdmins,
    sendSms,
    submitRequest,
    requestQuote,
    createProject,
    loadCatalog,
    placeOrder,
    submitLead,
    leadPhotoUrls,
    uploadProjectFile,
    projectFileUrl,
    deleteProjectDocument,
    logText,
    deleteLead,
    findProducts,
    draftListing,
    recreatePhotos,
    checkSupplierStock,
    assignRequest,
    pushInbox,
    pushAdminInbox,
    uploadImage,
    inviteAccount,
    getSignInLink,
    deleteAccount,
    resetDemoData,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/**
 * Wraps a client or trade portal that an admin has opened: inside it, `user` is that client or trade
 * (so the portal shows exactly their dashboard) while `actor` stays the admin, who is the one doing
 * and being recorded for everything. Outside an admin's opened dashboard it changes nothing.
 */
export function ActingAsProvider({ children }: { children: ReactNode }) {
  const outer = useStore()
  const { actingAs, user: admin, can: adminCan } = outer
  const value = useMemo<StoreValue>(
    () =>
      actingAs
        ? { ...outer, user: actingAs, actor: admin, can: (p: Permission) => adminCan(ACTING_PERMISSION[p] ?? p), canAct: adminCan }
        : outer,
    [outer, actingAs, admin, adminCan],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/**
 * Added without a login and not invited yet (live mode: no login created; demo mode: no invite code).
 * Live mode only counts a known "no login": if the database doesn't say, the email stays locked.
 */
export function hasNoLogin(u: UserAccount): boolean {
  return u.status === 'invited' && (CLOUD ? u.hasLogin === false : !u.inviteCode)
}

/** Has never had a login, whatever the account's status (e.g. one suspended before it was invited). */
export function lacksLogin(u: UserAccount): boolean {
  return CLOUD ? u.hasLogin === false : !u.passwordHash && !u.inviteCode
}

/** Names who did something: the person themselves, or "Admin for Person" from a dashboard an admin opened. */
export function doneBy(actor: UserAccount | null, user: UserAccount | null): string {
  if (!actor || !user || actor.id === user.id) return user?.name ?? actor?.name ?? ''
  return `${actor.name} for ${user.name}`
}

/**
 * Records who accepted or rejected a quote, as the database does in live mode: accepting is moving an
 * unanswered or rejected quote on, rejecting is moving anything to rejected; other moves keep the
 * record, and it's cleared when the quote is issued again. Changes `p` in place.
 */
export function stampQuoteDecision(p: Project, before: ProjectStatus, by: string | undefined) {
  if (p.status === 'quote_requested' || p.status === 'quoted') {
    p.quoteDecidedBy = undefined
    p.quoteDecision = undefined
  } else if (p.status !== before && (p.status === 'rejected' || before === 'quote_requested' || before === 'quoted' || before === 'rejected')) {
    p.quoteDecidedBy = by
    p.quoteDecision = p.status === 'rejected' ? 'rejected' : 'approved'
  }
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}

/** Lookup helpers bound to the current data. */
export function useLookup() {
  const { data, actor } = useStore()
  return useMemo(
    () => ({
      user: (id?: string) => data.users.find((u) => u.id === id),
      /**
       * Name for "Lodged by"-style lines. Clients and trades see office staff as the business (live
       * mode can't load admins' accounts for them; demo mode has them all, so this hides them too).
       * Admins see names, including in a dashboard they've opened.
       */
      byName: (id?: string) => {
        const u = data.users.find((x) => x.id === id)
        return u && (actor?.role === 'admin' || u.role !== 'admin') ? u.name : BRAND.name
      },
      property: (id?: string) => data.properties.find((p) => p.id === id),
      request: (id?: string) => data.requests.find((r) => r.id === id),
      project: (id?: string) => data.projects.find((p) => p.id === id),
      // Who admins can assign work to: every trade that isn't suspended, including those without a
      // login yet or with an invite pending (their work waits in their inbox).
      providers: data.users.filter((u) => u.role === 'provider' && u.status !== 'suspended'),
      clients: data.users.filter((u) => u.role === 'client'),
    }),
    [data, actor],
  )
}
