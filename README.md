# B-Flow

Construction management app to optimise day-to-day function — the business operations platform for **Next Phase Maintenance** (Melbourne, VIC · ABN 74 490 530 153).

It combines the public website with three role-based portals:

| Portal | What it does |
| --- | --- |
| **Public homepage** | Services, how it works, Melbourne coverage, contact & hours, top-right **Sign in** |
| **Client** | Maintenance requests with photos (urgent jobs SMS the office), Maintenance Hub (live / completed / schedule), renovation quote requests & project tracking, property registry (paint colours, skirting, cladding, access, floor plan) |
| **Service provider** | Inbox with work-order acknowledgement, live works with status updates & completion photos, project milestones, drag-to-reschedule calendar linked to work orders, budget & expense submission |
| **Admin (ops command centre)** | Triage & dispatch with provider assignment and SMS, quotes & projects (scope, milestones, expense approval), QuickBooks invoice ledger with bank-transfer settlement, SMS gateway settings & logs, invite-only accounts with granular permissions |

## Two modes

- **Live mode (Supabase)** — used when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Everyone shares one database, logins are real Supabase accounts, photos are stored in Supabase Storage, and SMS goes out through a server function that keeps your credentials secret. **Use this for the real business.**
- **Demo mode** — used when those settings are missing. Everything stays in the current browser and comes with Melbourne sample data. A yellow banner in the portals marks demo mode. Sample logins (password `demo1234`): `sarah@whitfieldproperty.com.au` (client), `dan@kowalskicarpentry.com.au` (trade). The admin login is the master account from the implementation plan.

## Going live: one-time setup (about 30 minutes)

You need a free [Supabase](https://supabase.com) account. Everything below happens in the Supabase dashboard; no command line is needed.

### 1. Create the project and database

1. In Supabase, click **New project**. Choose the **Sydney** region and save the database password somewhere safe.
2. Open **SQL Editor → New query**. Paste in the whole of [`supabase/migrations/20261014000000_init.sql`](supabase/migrations/20261014000000_init.sql) and click **Run**. This creates the tables, the access rules, the photo storage and your master admin profile.

### 2. Lock down sign-ups and create your admin login

1. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up". New people can then only join through an invite from the app. (The database blocks uninvited sign-ups as well.)
2. **Authentication → Users → Add user → Create new user**: enter `admin@nextphasemaintenance.com.au`, choose a strong password and tick **Auto Confirm User**. The login links to the admin profile automatically.

### 3. Add the two server functions

In **Edge Functions → Deploy a new function → Via Editor**, create two functions. For each one, use the name shown, replace the editor contents with the file and click **Deploy**:

| Name | File |
| --- | --- |
| `send-sms` | [`supabase/functions/send-sms/index.ts`](supabase/functions/send-sms/index.ts) |
| `invite-user` | [`supabase/functions/invite-user/index.ts`](supabase/functions/invite-user/index.ts) |

(Developers can use the CLI instead: `supabase link`, then `supabase functions deploy send-sms invite-user`.)

### 4. SMS credentials (kept secret on the server)

Under **Edge Functions → Secrets**, add either:

- **Twilio**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` (your Twilio number, e.g. `+61…`), **or**
- **any other SMS provider**: `SMS_WEBHOOK_URL`, which receives `POST { to, message, event }`, plus an optional `SMS_WEBHOOK_SECRET`, sent as the `X-Webhook-Secret` header.

Until one of these is set, messages are recorded in the SMS log as "Queued" rather than sent. Then, in the app, open **Admin → SMS gateway** and add the admin mobile numbers that should receive alerts.

### 5. Put the website online

Host the app on Netlify, Vercel or Cloudflare Pages (all have free plans) by connecting this GitHub repository:

- Build command: `npm run build` · Output folder: `dist`
- Environment variables, both from Supabase **Project Settings → API**:
  - `VITE_SUPABASE_URL`: the Project URL
  - `VITE_SUPABASE_ANON_KEY`: the `anon` `public` key (safe to publish; the database access rules protect the data)

Then, in Supabase **Authentication → URL Configuration**, set **Site URL** to your live address (for example `https://portal.nextphasemaintenance.com.au`) and add it under **Redirect URLs**. Invite and password-reset emails link back there.

### 6. Email delivery

Supabase's built-in email sender only allows a few emails per hour, which is fine for testing but not for business use. Before inviting many people, set up your own email sender under **Authentication → Emails → SMTP Settings**. Any provider works, for example Resend, Postmark or your Microsoft 365 / Google Workspace mailbox.

### Day-to-day

- **Invite people:** Admin → Accounts → Invite account. They receive an email, choose a password and land in their portal.
- **Forgotten passwords:** Sign in → "Forgot password?", or Admin → Accounts → Edit → "Email password link".
- **Change your own password:** the key icon in the portal header.

## How the data is protected

The rules live in the database (row-level security), so they apply even if someone bypasses the app:

- **Clients** see only their own properties, requests, projects, invoices and inbox. They can lodge requests, ask for quotes, and accept or decline a quote, but can't change prices or job details.
- **Service providers** see only the jobs and projects assigned to them, plus the related property and client. They can update status, notes, schedule dates, completion photos and milestones, and submit expenses. They can't change anything else or approve their own expenses.
- **Admins** see everything. Finance requires the "Manage invoices" permission, and accounts require "Edit accounts & permissions".
- **SMS** can only be sent through the server function. Clients can trigger the office alert for their own new request, once. Only admins can text other numbers.

Photo links use long random names that can't be guessed, but anyone who has a link can open it. Avoid photographing anything highly sensitive, such as alarm codes.

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (demo mode unless .env.local is set; see .env.example)
npm run build
npm run lint
npm run test:db    # database access-rule tests; needs a local Postgres, e.g. PGHOST=/tmp PGPORT=5432 PGUSER=postgres
```

Edit `src/lib/brand.ts` for the public phone number (hidden until set), business hours and coverage suburbs.

```
src/
  lib/          types, store (state, auth, sync), db (Supabase table mapping), supabase client, seed data, router, utils, brand
  components/   UI primitives, portal shell, sign-in, calendar, shared work-order views
  pages/        PublicHome, client/, provider/, admin/
supabase/
  migrations/   database schema + access rules
  functions/    send-sms, invite-user (server functions)
  tests/        access-rule tests that run against a real Postgres
```
