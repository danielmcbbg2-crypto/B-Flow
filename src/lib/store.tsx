import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel, Session } from '@supabase/supabase-js'
import type { AppData, InboxMessage, MaintenanceRequest, Permission, Project, Role, UserAccount } from './types'
import { createSeed, DATA_VERSION } from './seed'
import { dispatchSms } from './sms'
import { generateInviteCode, sha256, uid } from './utils'
import { applyOps, diff, emptyData, fetchAll, projectFromRow, requestFromRow, userFromRow } from './db'
import { CLOUD, supabase, supabaseAdapter, uploadPhoto } from './supabase'

const DATA_KEY = 'npm.data.v1'
const SESSION_KEY = 'npm.session.v1'

function loadDemoData(): AppData {
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
    try {
      const ctx = (error as { context?: Response }).context
      const json = ctx ? await ctx.json() : null
      if (json?.error) message = json.error
    } catch {
      /* keep the generic message */
    }
    throw new Error(message)
  }
  return data as T
}

type AuthResult = { error?: string; role?: Role }
type NewRequest = Omit<MaintenanceRequest, 'id' | 'number' | 'createdAt' | 'status' | 'smsNotified' | 'completionPhotos' | 'notes'>
type InboxDraft = Omit<InboxMessage, 'id' | 'createdAt' | 'read' | 'acknowledged'>

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
  logout: () => Promise<void>
  changePassword: (current: string, next: string) => Promise<string | null>
  /** SMS every admin recipient (admin only in cloud mode). */
  notifyAdmins: (message: string, triggerEvent: string) => Promise<void>
  /** SMS one number (admin only in cloud mode). */
  sendSms: (to: string, message: string, triggerEvent: string) => Promise<void>
  submitRequest: (req: NewRequest) => Promise<MaintenanceRequest>
  requestQuote: (q: { clientId: string; propertyId: string; title: string; description: string; budget: number }) => Promise<void>
  assignRequest: (requestId: string, providerId: string, scheduledDate: string, sms: boolean) => Promise<void>
  /** Message one person's inbox (admins). */
  pushInbox: (msg: InboxDraft) => void
  /** Message every admin's inbox (anyone signed in). */
  pushAdminInbox: (title: string, body: string, refs?: { requestId?: string; projectId?: string }) => Promise<void>
  /** Stores a photo and returns the URL (cloud) or the data URL itself (demo). */
  uploadImage: (dataUrl: string) => Promise<string>
  /** Creates an invited account. Demo mode returns the invite code; cloud mode emails an invite link. */
  inviteAccount: (account: UserAccount) => Promise<{ error?: string; code?: string }>
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
    [update, mergeLocal, notifyAdmins, reportError],
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
        await pushAdminInbox(`Quote request P-${project.number}`, q.title, { projectId: project.id })
        await invokeFunction('send-sms', { kind: 'quote_request', projectId: project.id }).catch(reportError)
        return
      }
      const d0 = dataRef.current
      const number = Math.max(200, ...d0.projects.map((p) => p.number)) + 1
      const id = uid('pr')
      update((d) => {
        d.projects.unshift({
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
        })
      })
      const client = d0.users.find((u) => u.id === q.clientId)
      await pushAdminInbox(`Quote request P-${number}`, `${client?.name ?? 'Client'}: ${q.title}`, { projectId: id })
      await notifyAdmins(`NPM quote request P-${number} — ${q.title} (${client?.name ?? 'client'})`, 'Renovation quote request')
    },
    [update, mergeLocal, pushAdminInbox, notifyAdmins, reportError],
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

  // ───────────── accounts & files ─────────────

  const uploadImage = useCallback(async (dataUrl: string) => (supabase ? uploadPhoto(supabase, dataUrl) : dataUrl), [])

  const inviteAccount = useCallback(
    async (account: UserAccount): Promise<{ error?: string; code?: string }> => {
      if (supabase) {
        try {
          await invokeFunction('invite-user', {
            action: 'invite',
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
          return {}
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
      // Demo mode mirrors the database rules: job and invoice history is kept.
      const d0 = dataRef.current
      const hasHistory =
        d0.requests.some((r) => r.clientId === id) || d0.projects.some((p) => p.clientId === id) || d0.invoices.some((i) => i.clientId === id)
      if (hasHistory) return 'This account has jobs or invoices on record, so it can’t be deleted. Suspend it instead.'
      update((d) => {
        d.users = d.users.filter((x) => x.id !== id)
        d.properties = d.properties.filter((p) => p.clientId !== id)
        d.inbox = d.inbox.filter((m) => m.userId !== id)
        for (const r of d.requests) if (r.assignedProviderId === id) r.assignedProviderId = undefined
        for (const p of d.projects) {
          if (p.assignedProviderId === id) p.assignedProviderId = undefined
          for (const e of p.expenses) if (e.providerId === id) e.providerId = ''
        }
      })
      return null
    },
    [update, refresh],
  )

  const resetDemoData = useCallback(() => {
    if (!CLOUD) setData(createSeed())
  }, [setData])

  const value: StoreValue = {
    cloud: CLOUD,
    phase,
    data,
    user,
    syncError,
    authNotice,
    update,
    can,
    login,
    acceptInvite,
    sendPasswordEmail,
    setNewPassword,
    logout,
    changePassword,
    notifyAdmins,
    sendSms,
    submitRequest,
    requestQuote,
    assignRequest,
    pushInbox,
    pushAdminInbox,
    uploadImage,
    inviteAccount,
    deleteAccount,
    resetDemoData,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside StoreProvider')
  return ctx
}

/** Lookup helpers bound to the current data. */
export function useLookup() {
  const { data } = useStore()
  return useMemo(
    () => ({
      user: (id?: string) => data.users.find((u) => u.id === id),
      property: (id?: string) => data.properties.find((p) => p.id === id),
      request: (id?: string) => data.requests.find((r) => r.id === id),
      project: (id?: string) => data.projects.find((p) => p.id === id),
      providers: data.users.filter((u) => u.role === 'provider' && u.status === 'active'),
      clients: data.users.filter((u) => u.role === 'client'),
    }),
    [data],
  )
}
