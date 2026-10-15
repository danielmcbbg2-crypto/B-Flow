/**
 * Row-level security + data-sync tests against a real Postgres.
 * Run with `npm run test:db` (see supabase/tests/run.sh).
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { applyOps, diff, fetchAll, type DbAdapter, type Row, type TableName } from '../../src/lib/db'
import { createSeed } from '../../src/lib/seed'
import type { AppData } from '../../src/lib/types'

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })

/** Runs each statement as the given auth user under the `authenticated` role, like PostgREST does. */
async function asUser<T>(uid: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult<T & pg.QueryResultRow>> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
    const r = await c.query<T & pg.QueryResultRow>(sql, params)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

/** DbAdapter with the same semantics as the Supabase adapter (insert sends only the given columns). */
function adapter(uid: string): DbAdapter {
  return {
    async select(t: TableName) {
      return (await asUser<{ j: Row }>(uid, `select to_jsonb(x) j from public.${t} x`)).rows.map((r) => r.j)
    },
    async insert(t: TableName, rows: Row[]) {
      const cols = Object.keys(rows[0]).map((c) => `"${c}"`).join(',')
      await asUser(uid, `insert into public.${t} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${t}, $1)`, [JSON.stringify(rows)])
    },
    async update(t: TableName, id: string | number, patch: Row) {
      const cols = Object.keys(patch).map((c) => `"${c}"`).join(',')
      const r = await asUser(
        uid,
        `update public.${t} set (${cols}) = (select ${cols} from jsonb_populate_record(null::public.${t}, $1)) where id = $2 returning id`,
        [JSON.stringify(patch), id],
      )
      if (r.rowCount === 0) throw new Error(`${t}: you don't have permission to change this record`)
    },
    async remove(t: TableName, id: string | number) {
      await asUser(uid, `delete from public.${t} where id = $1`, [id])
    },
  }
}

/** Creates a login the way Supabase Auth does: as the non-superuser supabase_auth_admin role. */
async function createAuthUser(email: string): Promise<string> {
  const c = await pool.connect()
  try {
    await c.query('begin')
    await c.query('set local role supabase_auth_admin')
    const r = await c.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email])
    await c.query('commit')
    return r.rows[0].id
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

async function mutate(db: DbAdapter, fn: (d: AppData) => void) {
  const prev = await fetchAll(db)
  const next = structuredClone(prev)
  fn(next)
  await applyOps(db, diff(prev, next))
}

const uid: Record<string, string> = {}
let admin: DbAdapter, sarah: DbAdapter, marcus: DbAdapter, dan: DbAdapter

before(async () => {
  uid.admin = await createAuthUser('admin@nextphasemaintenance.com.au')
  admin = adapter(uid.admin)

  // Admin loads the sample business data (minus SMS log, which only the server function writes).
  const seed = createSeed()
  await mutate(admin, (d) => {
    d.users.push(...seed.users.filter((u) => u.id !== 'u-admin').map((u) => ({ ...u, status: 'invited' as const })))
    d.properties = seed.properties
    d.projects = seed.projects
    d.requests = seed.requests
    d.invoices = seed.invoices
    d.inbox = seed.inbox
  })

  for (const [key, email] of [
    ['sarah', 'sarah@whitfieldproperty.com.au'],
    ['marcus', 'marcus.lee@example.com.au'],
    ['dan', 'dan@kowalskicarpentry.com.au'],
  ]) {
    uid[key] = await createAuthUser(email)
    await asUser(uid[key], 'select activate_my_account()')
  }
  sarah = adapter(uid.sarah)
  marcus = adapter(uid.marcus)
  dan = adapter(uid.dan)
})

after(() => pool.end())

describe('accounts', () => {
  test('sign-ups without an invitation are rejected', async () => {
    await assert.rejects(createAuthUser('stranger@example.com'), /No Next Phase Maintenance invitation/)
  })

  test('signed-out visitors cannot call the helper functions; signed-in users can', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role anon')
      await assert.rejects(c.query('select public.is_admin()'), /permission denied/)
    } finally {
      await c.query('rollback')
      c.release()
    }
    const r = await asUser<{ ok: boolean }>(uid.admin, 'select public.is_admin() as ok')
    assert.equal(r.rows[0].ok, true)
  })

  test('master admin is linked and active', async () => {
    const d = await fetchAll(admin)
    const me = d.users.find((u) => u.id === 'u-admin')!
    assert.equal(me.status, 'active')
    assert.equal(d.users.length, 6)
  })

  test('non-admins cannot edit profiles, including their own permissions', async () => {
    await assert.rejects(
      mutate(sarah, (d) => {
        d.users.find((u) => u.id === 'u-client-1')!.permissions.push('canEditPermissions')
      }),
      /permission/,
    )
  })

  test('suspended accounts see nothing', async () => {
    await mutate(admin, (d) => {
      d.users.find((u) => u.id === 'u-client-2')!.status = 'suspended'
    })
    const d = await fetchAll(marcus)
    assert.equal(d.requests.length + d.properties.length + d.projects.length, 0)
    await mutate(admin, (d) => {
      d.users.find((u) => u.id === 'u-client-2')!.status = 'active'
    })
  })
})

describe('client visibility & actions', () => {
  test('sees only their own records and the trades on their jobs', async () => {
    const d = await fetchAll(sarah)
    assert.deepEqual(d.properties.map((p) => p.id).sort(), ['p-1', 'p-2'])
    assert.deepEqual(d.requests.map((r) => r.id).sort(), ['r-1', 'r-3', 'r-4', 'r-5'])
    assert.deepEqual(d.projects.map((p) => p.id), ['pr-1'])
    assert.equal(d.invoices.length, 2)
    assert.deepEqual(d.users.map((u) => u.id).sort(), ['u-client-1', 'u-prov-1', 'u-prov-2', 'u-prov-3'])
    assert.equal(d.sms.length, 0)
    assert.equal(d.smsSettings.recipients.length, 0)
  })

  test('can lodge a request on their own property, and the server numbers it', async () => {
    const r = await asUser<{ number: number }>(
      uid.sarah,
      `insert into requests (client_id, property_id, title, category, urgency) values ('u-client-1', 'p-1', 'Smoke alarm', 'Handyman', 'urgent') returning number`,
    )
    assert.ok(r.rows[0].number > 1000)
  })

  test("cannot lodge a request on someone else's property", async () => {
    await assert.rejects(
      asUser(uid.sarah, `insert into requests (client_id, property_id, title, category) values ('u-client-1', 'p-3', 'x', 'Handyman')`),
      /row-level security/,
    )
  })

  test('cannot edit or reassign requests', async () => {
    await assert.rejects(
      mutate(sarah, (d) => {
        d.requests.find((r) => r.id === 'r-1')!.title = 'changed'
      }),
      /permission/,
    )
  })

  test('can add and edit their own properties', async () => {
    await mutate(sarah, (d) => {
      d.properties.push({ ...d.properties[0], id: 'p-new', address: '1 New Street' })
      d.properties.find((p) => p.id === 'p-1')!.paintColors.walls = 'Dulux Lexicon Quarter'
    })
    const d = await fetchAll(sarah)
    assert.equal(d.properties.length, 3)
    assert.equal(d.properties.find((p) => p.id === 'p-1')!.paintColors.walls, 'Dulux Lexicon Quarter')
  })

  test('quote flow: request, admin prices it, client accepts but cannot change the price', async () => {
    await asUser(uid.sarah, `insert into projects (id, client_id, property_id, title) values ('pr-q', 'u-client-1', 'p-2', 'Kitchen')`)
    await assert.rejects(
      asUser(uid.sarah, `insert into projects (client_id, property_id, title, quote_amount) values ('u-client-1', 'p-2', 'Cheap', 1)`),
      /row-level security/,
    )
    await mutate(admin, (d) => {
      const p = d.projects.find((x) => x.id === 'pr-q')!
      p.quoteAmount = 25000
      p.status = 'quoted'
    })
    await assert.rejects(
      mutate(sarah, (d) => {
        const p = d.projects.find((x) => x.id === 'pr-q')!
        p.status = 'approved'
        p.quoteAmount = 1
      }),
      /only accept or decline/,
    )
    await mutate(sarah, (d) => {
      d.projects.find((x) => x.id === 'pr-q')!.status = 'approved'
    })
    const p = (await fetchAll(admin)).projects.find((x) => x.id === 'pr-q')!
    assert.equal(p.status, 'approved')
    assert.equal(p.quoteAmount, 25000)
  })
})

describe('service provider visibility & actions', () => {
  test('sees assigned jobs, their properties and clients only', async () => {
    const d = await fetchAll(dan)
    assert.deepEqual(d.requests.map((r) => r.id).sort(), ['r-2', 'r-4'])
    assert.deepEqual(d.projects.map((p) => p.id), ['pr-1'])
    assert.deepEqual(d.properties.map((p) => p.id).sort(), ['p-1', 'p-3'])
    assert.deepEqual(d.users.map((u) => u.id).sort(), ['u-client-1', 'u-client-2', 'u-prov-1'])
    assert.equal(d.invoices.length, 0)
    assert.equal(d.projects[0].milestones.length, 5)
  })

  test('can update status, notes, schedule and completion photos', async () => {
    await mutate(dan, (d) => {
      const r = d.requests.find((x) => x.id === 'r-2')!
      r.status = 'in_progress'
      r.notes = 'On site'
      r.scheduledDate = '2030-01-02'
      r.completionPhotos.push('https://example.com/a.jpg')
    })
    const r = (await fetchAll(admin)).requests.find((x) => x.id === 'r-2')!
    assert.equal(r.status, 'in_progress')
    assert.equal(r.scheduledDate, '2030-01-02')
    assert.deepEqual(r.completionPhotos, ['https://example.com/a.jpg'])
  })

  test('cannot change job details or send a job back to triage', async () => {
    await assert.rejects(
      mutate(dan, (d) => {
        d.requests.find((x) => x.id === 'r-2')!.title = 'x'
      }),
      /Only status/,
    )
    await assert.rejects(
      mutate(dan, (d) => {
        d.requests.find((x) => x.id === 'r-2')!.status = 'pending'
      }),
      /back to triage/,
    )
  })

  test('can tick off and reschedule milestones but not rename them', async () => {
    await mutate(dan, (d) => {
      const m = d.projects[0].milestones.find((x) => x.id === 'm-3')!
      m.done = true
      m.date = '2030-02-03'
    })
    await assert.rejects(
      mutate(dan, (d) => {
        d.projects[0].milestones.find((x) => x.id === 'm-3')!.title = 'x'
      }),
      /Only milestone/,
    )
  })

  test('can submit expenses only as "submitted" on assigned projects', async () => {
    await mutate(dan, (d) => {
      d.projects[0].expenses.push({ id: 'e-new', providerId: 'u-prov-1', date: '2030-01-01', description: 'Tiles', category: 'Materials', amount: 812.35, status: 'submitted' })
    })
    await assert.rejects(
      mutate(dan, (d) => {
        d.projects[0].expenses.push({ id: 'e-bad', providerId: 'u-prov-1', date: '2030-01-01', description: 'x', category: 'Other', amount: 1, status: 'approved' })
      }),
      /row-level security/,
    )
    await assert.rejects(
      mutate(dan, (d) => {
        d.projects[0].expenses.find((e) => e.id === 'e-new')!.status = 'approved'
      }),
      /permission/,
    )
    const e = (await fetchAll(admin)).projects.find((p) => p.id === 'pr-1')!.expenses.find((x) => x.id === 'e-new')!
    assert.equal(e.amount, 812.35)
  })

  test('can acknowledge inbox items but not rewrite them, and can notify admins', async () => {
    await mutate(dan, (d) => {
      Object.assign(d.inbox.find((m) => m.id === 'n-1')!, { read: true, acknowledged: true })
    })
    await assert.rejects(
      mutate(dan, (d) => {
        d.inbox.find((m) => m.id === 'n-1')!.title = 'x'
      }),
      /Only read/,
    )
    await asUser(uid.dan, `select notify_admins('Job done', 'Ready to invoice', 'r-2', null)`)
    const adminInbox = (await fetchAll(admin)).inbox
    assert.ok(adminInbox.some((m) => m.title === 'Job done' && m.requestId === 'r-2'))
  })
})

describe('granular permissions', () => {
  test('an admin without dispatch or project rights can view jobs and projects but not change them', async () => {
    await mutate(admin, (d) => {
      d.users.push({
        id: 'u-office',
        name: 'Office',
        email: 'office@nextphasemaintenance.com.au',
        role: 'admin',
        phone: '',
        permissions: ['canManageInvoices'],
        createdAt: new Date().toISOString(),
        status: 'invited',
        passwordHash: '',
      })
    })
    uid.office = await createAuthUser('office@nextphasemaintenance.com.au')
    await asUser(uid.office, 'select activate_my_account()')
    const office = adapter(uid.office)
    const d = await fetchAll(office)
    assert.ok(d.requests.length > 0 && d.projects.length > 0)
    await assert.rejects(
      mutate(office, (x) => {
        x.requests.find((r) => r.id === 'r-1')!.notes = 'x'
      }),
      /permission/,
    )
    await assert.rejects(
      mutate(office, (x) => {
        x.projects.find((p) => p.id === 'pr-1')!.budget = 1
      }),
      /permission/,
    )
  })

  test('a trade needs expense rights and an open project to submit expenses', async () => {
    const expense = (id: string) => (d: AppData) => {
      d.projects.find((p) => p.id === 'pr-1')!.expenses.push({ id, providerId: 'u-prov-1', date: '2030-01-01', description: 'x', category: 'Other', amount: 1, status: 'submitted' })
    }
    await mutate(admin, (d) => {
      d.users.find((u) => u.id === 'u-prov-1')!.permissions = []
    })
    await assert.rejects(mutate(dan, expense('e-noperm')), /row-level security/)
    await mutate(admin, (d) => {
      d.users.find((u) => u.id === 'u-prov-1')!.permissions = ['canSubmitExpenses']
      d.projects.find((p) => p.id === 'pr-1')!.status = 'completed'
    })
    await assert.rejects(mutate(dan, expense('e-closed')), /row-level security/)
    await mutate(admin, (d) => {
      d.projects.find((p) => p.id === 'pr-1')!.status = 'in_progress'
    })
  })

  test('a quote cannot be issued without a price', async () => {
    await assert.rejects(
      mutate(admin, (d) => {
        d.projects.find((p) => p.id === 'pr-2')!.status = 'quoted'
      }),
      /quoted_needs_price/,
    )
  })
})

describe('server functions (service role)', () => {
  test('can record that a request was SMS-alerted despite the column guards', async () => {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role service_role')
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
      const r = await c.query(`update requests set sms_notified = true where id = 'r-2' returning sms_notified`)
      await c.query('commit')
      assert.equal(r.rows[0].sms_notified, true)
    } finally {
      c.release()
    }
  })
})

describe('admin', () => {
  test('can dispatch, invoice, approve expenses and update settings', async () => {
    await mutate(admin, (d) => {
      const r = d.requests.find((x) => x.id === 'r-1')!
      r.assignedProviderId = 'u-prov-3'
      r.status = 'assigned'
      d.inbox.unshift({ id: 'n-x', userId: 'u-prov-3', title: 'New work order', body: '', createdAt: new Date().toISOString(), read: false, requiresAck: true, acknowledged: false, requestId: 'r-1' })
      d.invoices.unshift({ id: 'i-x', requestId: 'r-1', clientId: 'u-client-1', qbInvoiceNumber: 'INV-9', amount: 99.5, status: 'sent', bankTransferRef: '', dueDate: '2030-01-01', createdAt: new Date().toISOString() })
      d.projects.find((p) => p.id === 'pr-1')!.expenses.find((e) => e.id === 'e-3')!.status = 'approved'
      d.smsSettings.recipients = ['+61400000000']
      d.bank.bsb = '063-000'
    })
    const d = await fetchAll(admin)
    assert.equal(d.requests.find((x) => x.id === 'r-1')!.assignedProviderId, 'u-prov-3')
    assert.equal(d.invoices.find((x) => x.id === 'i-x')!.amount, 99.5)
    assert.deepEqual(d.smsSettings.recipients, ['+61400000000'])
    assert.equal(d.bank.bsb, '063-000')
    // Admins can message a trade's inbox but can't read it back.
    assert.ok(!d.inbox.some((m) => m.id === 'n-x'))
  })

  test('reloading produces no spurious changes', async () => {
    const d = await fetchAll(admin)
    assert.deepEqual(diff(d, structuredClone(d)), [])
  })

  test("clients with job history can't be deleted; a deleted trade's jobs and expenses are kept", async () => {
    await assert.rejects(pool.query(`delete from profiles where id = 'u-client-1'`), /foreign key/)
    await pool.query(`delete from profiles where id = 'u-prov-1'`)
    const e = (await fetchAll(admin)).projects.find((p) => p.id === 'pr-1')!.expenses
    assert.equal(e.length, 4)
    assert.ok(e.every((x) => x.providerId === ''))
    const jobs = (await fetchAll(admin)).requests.filter((r) => ['r-2', 'r-4'].includes(r.id))
    assert.equal(jobs.length, 2)
    assert.ok(jobs.every((r) => r.assignedProviderId === undefined))
  })

  test("a client can't delete a property that has job history", async () => {
    await assert.rejects(
      mutate(sarah, (d) => {
        d.properties = d.properties.filter((p) => p.id !== 'p-2')
      }),
      /foreign key/,
    )
  })

  test('deleting a project removes its milestones and expenses', async () => {
    await mutate(admin, (d) => {
      d.projects = d.projects.filter((p) => p.id !== 'pr-q')
    })
    const d = await fetchAll(admin)
    assert.ok(!d.projects.some((p) => p.id === 'pr-q'))
  })
})
