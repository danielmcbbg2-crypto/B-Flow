import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppData, InboxMessage, MaintenanceRequest, Permission, UserAccount } from './types'
import { createSeed, DATA_VERSION } from './seed'
import { dispatchSms } from './sms'
import { sha256, uid } from './utils'

const DATA_KEY = 'npm.data.v1'
const SESSION_KEY = 'npm.session.v1'

function loadData(): AppData {
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

function loadSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

interface StoreValue {
  data: AppData
  user: UserAccount | null
  storageError: string | null
  /** Apply a mutation to a deep copy of the data. Keep side effects out of `fn`. */
  update: (fn: (draft: AppData) => void) => void
  can: (p: Permission) => boolean
  login: (email: string, password: string) => Promise<string | null>
  acceptInvite: (email: string, code: string, password: string) => Promise<string | null>
  logout: () => void
  changePassword: (current: string, next: string) => Promise<string | null>
  /** Send an SMS to every configured admin recipient (plus any extra numbers) and log it. */
  notifyAdmins: (message: string, triggerEvent: string) => Promise<number>
  sendSms: (to: string, message: string, triggerEvent: string) => Promise<void>
  submitRequest: (req: Omit<MaintenanceRequest, 'id' | 'number' | 'createdAt' | 'status' | 'smsNotified' | 'completionPhotos' | 'notes'>) => Promise<MaintenanceRequest>
  assignRequest: (requestId: string, providerId: string, scheduledDate: string, sms: boolean) => Promise<void>
  pushInbox: (msg: Omit<InboxMessage, 'id' | 'createdAt' | 'read' | 'acknowledged'>) => void
  resetDemoData: () => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData)
  const [sessionId, setSessionId] = useState<string | null>(loadSession)
  const [storageError, setStorageError] = useState<string | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  useEffect(() => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data))
      setStorageError(null)
    } catch {
      setStorageError('Browser storage is full — recent changes (often photos) could not be saved. Remove some photos and try again.')
    }
  }, [data])

  useEffect(() => {
    try {
      if (sessionId) localStorage.setItem(SESSION_KEY, sessionId)
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      /* session simply won't persist */
    }
  }, [sessionId])

  const update = useCallback((fn: (draft: AppData) => void) => {
    setData((prev) => {
      const draft = structuredClone(prev)
      fn(draft)
      return draft
    })
  }, [])

  const user = useMemo(() => {
    const u = data.users.find((x) => x.id === sessionId)
    return u && u.status === 'active' ? u : null
  }, [data.users, sessionId])

  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user])

  const login = useCallback(async (email: string, password: string) => {
    const u = dataRef.current.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u) return 'No account found for that email. Accounts are invite-only.'
    if (u.status === 'invited') return 'This account has a pending invite. Use “I have an invite code” to set your password.'
    if (u.status === 'suspended') return 'This account is suspended. Contact Next Phase Maintenance.'
    if ((await sha256(password)) !== u.passwordHash) return 'Incorrect password.'
    setSessionId(u.id)
    return null
  }, [])

  const acceptInvite = useCallback(
    async (email: string, code: string, password: string) => {
      const u = dataRef.current.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
      if (!u || u.status !== 'invited' || !u.inviteCode) return 'No pending invite for that email.'
      if (u.inviteCode.toUpperCase() !== code.trim().toUpperCase()) return 'Invite code does not match.'
      if (password.length < 8) return 'Password must be at least 8 characters.'
      const hash = await sha256(password)
      update((d) => {
        const target = d.users.find((x) => x.id === u.id)!
        target.passwordHash = hash
        target.status = 'active'
        delete target.inviteCode
      })
      setSessionId(u.id)
      return null
    },
    [update],
  )

  const logout = useCallback(() => setSessionId(null), [])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const u = dataRef.current.users.find((x) => x.id === sessionId)
      if (!u) return 'Not signed in.'
      if ((await sha256(current)) !== u.passwordHash) return 'Current password is incorrect.'
      if (next.length < 8) return 'New password must be at least 8 characters.'
      const hash = await sha256(next)
      update((d) => {
        d.users.find((x) => x.id === u.id)!.passwordHash = hash
      })
      return null
    },
    [sessionId, update],
  )

  const sendSms = useCallback(
    async (to: string, message: string, triggerEvent: string) => {
      const entry = await dispatchSms(dataRef.current.smsSettings, to, message, triggerEvent)
      update((d) => {
        d.sms.unshift(entry)
      })
    },
    [update],
  )

  const notifyAdmins = useCallback(
    async (message: string, triggerEvent: string) => {
      const recipients = dataRef.current.smsSettings.recipients.filter(Boolean)
      if (recipients.length === 0) {
        await sendSms('(no admin numbers set)', message, triggerEvent)
        return 0
      }
      await Promise.all(recipients.map((r) => sendSms(r, message, triggerEvent)))
      return recipients.length
    },
    [sendSms],
  )

  const pushInbox = useCallback(
    (msg: Omit<InboxMessage, 'id' | 'createdAt' | 'read' | 'acknowledged'>) => {
      update((d) => {
        d.inbox.unshift({ ...msg, id: uid('n'), createdAt: new Date().toISOString(), read: false, acknowledged: false })
      })
    },
    [update],
  )

  const submitRequest: StoreValue['submitRequest'] = useCallback(
    async (input) => {
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
        await notifyAdmins(
          `NPM #${number}${input.urgency === 'urgent' ? ' URGENT' : ''} — ${input.title}${where} (${input.category})`,
          'New maintenance request',
        )
      }
      return req
    },
    [update, notifyAdmins],
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

  const resetDemoData = useCallback(() => {
    setData(createSeed())
  }, [])

  const value: StoreValue = {
    data,
    user,
    storageError,
    update,
    can,
    login,
    acceptInvite,
    logout,
    changePassword,
    notifyAdmins,
    sendSms,
    submitRequest,
    assignRequest,
    pushInbox,
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
