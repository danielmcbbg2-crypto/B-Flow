// Supabase Edge Function: invite-only account management (admins with canEditPermissions).
//
//   { action: 'invite', profile: {...}, redirectTo }  creates the profile and emails a
//       Supabase invite link; the person chooses a password when they open it.
//   { action: 'delete', profileId }  removes the login and the profile.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const ROLES = ['admin', 'client', 'provider']
const PERMISSIONS = ['canSubmitRequests', 'canDispatchJobs', 'canManageInvoices', 'canEditPermissions', 'canManageProjects', 'canSubmitExpenses']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(jwt)
  if (!auth.user) return json({ error: 'Not signed in' }, 401)
  const { data: me } = await db.from('profiles').select('id, role, permissions').eq('auth_id', auth.user.id).eq('status', 'active').maybeSingle()
  if (!me || me.role !== 'admin' || !me.permissions.includes('canEditPermissions')) {
    return json({ error: 'You need the “Edit accounts & permissions” permission' }, 403)
  }

  const body = await req.json().catch(() => ({}))

  if (body.action === 'invite') {
    const p = body.profile ?? {}
    const email = String(p.email ?? '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400)
    if (!ROLES.includes(p.role)) return json({ error: 'Invalid role' }, 400)
    const { data: created, error: insertError } = await db
      .from('profiles')
      .insert({
        name: String(p.name ?? '').trim() || email,
        email,
        role: p.role,
        phone: String(p.phone ?? ''),
        company: p.company || null,
        trade: p.trade || null,
        permissions: (Array.isArray(p.permissions) ? p.permissions : []).filter((x: string) => PERMISSIONS.includes(x)),
        status: 'invited',
      })
      .select('id')
      .single()
    if (insertError) {
      return json({ error: insertError.code === '23505' ? 'An account with this email already exists' : insertError.message }, 400)
    }
    const { error: inviteError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: body.redirectTo })
    if (inviteError) {
      await db.from('profiles').delete().eq('id', created.id)
      return json({ error: `Invite email failed: ${inviteError.message}` }, 400)
    }
    return json({ id: created.id })
  }

  if (body.action === 'delete') {
    if (body.profileId === me.id) return json({ error: "You can't delete your own account" }, 400)
    const { data: target } = await db.from('profiles').select('id, auth_id').eq('id', body.profileId).maybeSingle()
    if (!target) return json({ error: 'Account not found' }, 404)
    // Profile first: the database refuses if jobs or invoices still reference this client.
    const { error: profileError } = await db.from('profiles').delete().eq('id', target.id)
    if (profileError) {
      return json(
        { error: profileError.code === '23503' ? 'This account has jobs or invoices on record, so it can’t be deleted. Suspend it instead.' : profileError.message },
        400,
      )
    }
    if (target.auth_id) {
      const { error } = await db.auth.admin.deleteUser(target.auth_id)
      if (error) return json({ error: `Profile removed, but the login could not be deleted: ${error.message}` }, 400)
    }
    return json({ ok: true })
  }

  return json({ error: 'Unknown action' }, 400)
})
