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
    // Admins can message a trade's inbox and read it back (they can open the trade's dashboard).
    assert.ok(d.inbox.some((m) => m.id === 'n-x'))
  })

  test('reloading produces no spurious changes', async () => {
    const d = await fetchAll(admin)
    assert.deepEqual(diff(d, structuredClone(d)), [])
  })

  test("clients with job history can't be deleted; a deleted trade's jobs and expenses are kept", async () => {
    await assert.rejects(pool.query(`delete from profiles where id = 'u-client-1'`), /jobs or invoices on record/)
    // Jobs alone are enough: deleting would otherwise erase them along with the client.
    assert.equal((await pool.query(`select count(*)::int n from invoices where client_id = 'u-client-2'`)).rows[0].n, 0)
    await assert.rejects(asUser(uid.admin, `delete from profiles where id = 'u-client-2'`), /jobs or invoices on record/)
    assert.equal((await pool.query(`select count(*)::int n from projects where client_id = 'u-client-2'`)).rows[0].n > 0, true)
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

describe('admins acting in a client or trade dashboard', () => {
  test('records who really created a job, quote or expense, and it cannot be changed', async () => {
    // A client lodging their own request is recorded as them, whatever the app sends.
    const own = await asUser<{ created_by: string }>(
      uid.sarah,
      `insert into requests (client_id, property_id, title, category, created_by) values ('u-client-1', 'p-1', 'Gutter', 'Handyman', 'u-admin') returning created_by`,
    )
    assert.equal(own.rows[0].created_by, 'u-client-1')
    // An admin lodging one from the client's dashboard is recorded as the admin.
    const forClient = await asUser<{ id: string; created_by: string }>(
      uid.admin,
      `insert into requests (client_id, property_id, title, category, created_by) values ('u-client-1', 'p-1', 'Leaking tap', 'Plumbing', 'u-client-1') returning id, created_by`,
    )
    assert.equal(forClient.rows[0].created_by, 'u-admin')
    const quote = await asUser<{ created_by: string }>(uid.admin, `insert into projects (client_id, property_id, title) values ('u-client-1', 'p-1', 'Deck') returning created_by`)
    assert.equal(quote.rows[0].created_by, 'u-admin')
    const expense = await asUser<{ created_by: string }>(
      uid.admin,
      `insert into project_expenses (project_id, provider_id, date, description, category, amount) values ('pr-1', 'u-prov-3', '2030-01-02', 'Glue', 'Materials', 12) returning created_by`,
    )
    assert.equal(expense.rows[0].created_by, 'u-admin')
    // Nobody signed in through the app can rewrite it afterwards.
    const later = await asUser<{ created_by: string }>(
      uid.admin,
      `update requests set created_by = 'u-client-1', title = 'Leaking tap (kitchen)' where id = $1 returning created_by`,
      [forClient.rows[0].id],
    )
    assert.equal(later.rows[0].created_by, 'u-admin')
  })

  test('the synced app data carries who created each record', async () => {
    const d = await fetchAll(admin)
    assert.ok(d.requests.some((r) => r.title === 'Leaking tap (kitchen)' && r.createdBy === 'u-admin'))
    assert.ok(d.requests.some((r) => r.title === 'Gutter' && r.createdBy === 'u-client-1'))
  })

  test("admins can read and acknowledge a trade's inbox; other people still cannot", async () => {
    const msgs = await asUser<{ id: string }>(uid.admin, `select id from inbox where user_id = 'u-prov-3'`)
    assert.ok(msgs.rows.length > 0)
    const ack = await asUser<{ acknowledged_by: string }>(
      uid.admin,
      `update inbox set acknowledged = true, read = true where id = $1 returning acknowledged_by`,
      [msgs.rows[0].id],
    )
    assert.equal(ack.rowCount, 1)
    // Recorded as the admin, not the trade, and the app can't say otherwise.
    assert.equal(ack.rows[0].acknowledged_by, 'u-admin')
    await assert.rejects(asUser(uid.admin, `update inbox set acknowledged_by = 'u-prov-3' where id = $1`, [msgs.rows[0].id]), /Only read and acknowledged/)
    const d = await fetchAll(admin)
    assert.equal(d.inbox.find((m) => m.id === msgs.rows[0].id)?.acknowledgedBy, 'u-admin')
    await assert.rejects(asUser(uid.admin, `update inbox set title = 'x' where id = $1`, [msgs.rows[0].id]), /Only read and acknowledged/)
    const other = await asUser(uid.sarah, `select id from inbox where user_id = 'u-prov-3'`)
    assert.equal(other.rowCount, 0)
  })

  test('records who last accepted or rejected a quote, and clears it when the quote is issued again', async () => {
    type Q = { id: string; status: string; quote_decided_by: string | null; quote_decision: string | null }
    const quoted = `insert into projects (client_id, property_id, title, status, quote_amount, quote_decided_by, quote_decision)
      values ('u-client-1', 'p-1', $1, 'quoted', 5000, 'u-client-1', 'approved') returning id, status, quote_decided_by, quote_decision`
    const set = (who: string, id: string, sql: string) =>
      asUser<Q>(who, `update projects set ${sql} where id = $1 returning id, status, quote_decided_by, quote_decision`, [id]).then((r) => r.rows[0])
    const a = (await asUser<Q>(uid.admin, quoted, ['Fence'])).rows[0]
    assert.deepEqual([a.quote_decided_by, a.quote_decision], [null, null])
    // The client answers their own quote, and can't write the record themselves.
    await assert.rejects(set(uid.sarah, a.id, `quote_decided_by = 'u-admin'`), /accept or decline/)
    await assert.rejects(set(uid.sarah, a.id, `quote_decision = 'rejected'`), /accept or decline/)
    const mine = await set(uid.sarah, a.id, `status = 'approved'`)
    assert.deepEqual([mine.quote_decided_by, mine.quote_decision], ['u-client-1', 'approved'])
    // Carrying on with the project keeps it, and so does moving it back to approved.
    const started = await set(uid.admin, a.id, `status = 'in_progress', quote_decided_by = null, quote_decision = null`)
    assert.deepEqual([started.quote_decided_by, started.quote_decision], ['u-client-1', 'approved'])
    const back = await set(uid.admin, a.id, `status = 'approved'`)
    assert.deepEqual([back.quote_decided_by, back.quote_decision], ['u-client-1', 'approved'])
    // An admin answers one from the client's dashboard.
    const b = (await asUser<Q>(uid.admin, quoted, ['Pergola'])).rows[0]
    const declined = await set(uid.admin, b.id, `status = 'rejected'`)
    assert.deepEqual([declined.quote_decided_by, declined.quote_decision], ['u-admin', 'rejected'])
    // The office re-issues a revised quote: nobody has answered that one yet.
    const reissued = await set(uid.admin, b.id, `status = 'quoted', quote_amount = 4500`)
    assert.deepEqual([reissued.quote_decided_by, reissued.quote_decision], [null, null])
    // The client accepts it, then the office cancels the job: the record follows whoever did each.
    assert.equal((await set(uid.sarah, b.id, `status = 'approved'`)).quote_decided_by, 'u-client-1')
    const cancelled = await set(uid.admin, b.id, `status = 'rejected'`)
    assert.deepEqual([cancelled.quote_decided_by, cancelled.quote_decision], ['u-admin', 'rejected'])
    // Reopening a rejected job, or moving a quote straight into work after a phone call, counts as
    // accepting it, by whoever did it.
    const c = (await asUser<Q>(uid.admin, quoted, ['Shed'])).rows[0]
    const phoned = await set(uid.admin, c.id, `status = 'in_progress'`)
    assert.deepEqual([phoned.quote_decided_by, phoned.quote_decision], ['u-admin', 'approved'])
    const d = await fetchAll(admin)
    const p = d.projects.find((x) => x.id === b.id)
    assert.deepEqual([p?.quoteDecidedBy, p?.quoteDecision], ['u-admin', 'rejected'])
    const reopened = await set(uid.admin, b.id, `status = 'in_progress'`)
    assert.deepEqual([reopened.quote_decided_by, reopened.quote_decision], ['u-admin', 'approved'])
  })

  test("an admin who did work for other people can't be deleted; other accounts delete as before", async () => {
    // The office admin acknowledges a trade's work order from the trade's dashboard.
    const msg = await asUser<{ id: string }>(uid.admin, `insert into inbox (user_id, title, body, requires_ack) values ('u-prov-3', 'WO', 'x', true) returning id`)
    await asUser(uid.office, `update inbox set acknowledged = true where id = $1`, [msg.rows[0].id])
    await assert.rejects(asUser(uid.admin, `delete from profiles where id = 'u-office'`), (e: Error & { code?: string }) => {
      assert.equal(e.code, '23503')
      assert.match(e.message, /done work for other people on record/)
      return true
    })
    // Nor through the server (service role).
    await assert.rejects(pool.query(`delete from profiles where id = 'u-office'`), /done work for other people/)
    assert.equal((await pool.query(`select acknowledged_by from inbox where id = $1`, [msg.rows[0].id])).rows[0].acknowledged_by, 'u-office')
    // Accounts with only their own records still delete (like the trade deleted earlier), and so does a new admin.
    await mutate(admin, (d) => {
      d.users.push({ id: 'u-temp', name: 'Temp', email: 'temp@example.com', role: 'admin', phone: '', permissions: [], createdAt: new Date().toISOString(), status: 'invited', passwordHash: '' })
    })
    const del = await asUser(uid.admin, `delete from profiles where id = 'u-temp'`)
    assert.equal(del.rowCount, 1)
  })
})
