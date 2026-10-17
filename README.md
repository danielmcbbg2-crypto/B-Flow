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
- **Demo mode** — only in local development (`npm run dev`) or a build made with `npm run build:demo`. Everything stays in the current browser and comes with Melbourne sample data, marked by a black "Demo mode" bar in the portals. Sample logins, all with the password `demo1234`: `admin@nextphasemaintenance.com.au` (admin), `sarah@whitfieldproperty.com.au` (client), `dan@kowalskicarpentry.com.au` (trade). Demo builds never contain your real password.

A normal production build (`npm run build`) never contains sample data: if the Supabase settings are missing it shows a "Client portal coming soon" page instead.

## Going live: one-time setup (about 30 minutes)

You need a free [Supabase](https://supabase.com) account. Everything below happens in the Supabase dashboard; no command line is needed.

### 1. Create the project and database

1. In Supabase, click **New project**. Choose the **Sydney** region and save the database password somewhere safe.
2. Open **SQL Editor → New query**. Paste in each file from [`supabase/migrations`](supabase/migrations), oldest first, and click **Run** after each. This creates the tables, the access rules, the photo storage and your master admin profile.

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

Merge the pull request into `main` first. Then host the app on Netlify, Vercel or Cloudflare Pages (all have free plans) by connecting this GitHub repository:

- Build command: `npm run build` · Output folder: `dist` (Netlify reads these from `netlify.toml`; Vercel detects Vite automatically)
- Environment variables, both from Supabase **Project Settings → API**:
  - `VITE_SUPABASE_URL`: the Project URL
  - `VITE_SUPABASE_ANON_KEY`: the `anon` `public` key (safe to publish; the database access rules protect the data)

To use your own address such as `portal.nextphasemaintenance.com.au`, add it as a custom domain in the host's settings and create the DNS record it asks for (usually a `CNAME` for `portal`) wherever your domain's DNS is managed. Your existing website at `www.nextphasemaintenance.com.au` is not affected.

Then, in Supabase **Authentication → URL Configuration**, set **Site URL** to your live address (for example `https://portal.nextphasemaintenance.com.au`) and add it under **Redirect URLs**. Invite and password-reset emails link back there.

### 6. Email delivery

Supabase's built-in email sender only delivers to members of your Supabase team, a few emails an hour. Until you set up your own sender, invite people with **Create invite link** (see Day-to-day) instead of **Email the invite**.

To send invites and password emails automatically, set up a sender, for example [Resend](https://resend.com) (free for up to 3,000 emails a month):

1. In Resend, add the domain `nextphasemaintenance.com.au`. It shows a few DNS records (on `send` and `resend._domainkey`); add them where your domain's DNS is managed, the same way as the `portal` record. They don't touch your website or your existing email.
2. Once Resend shows the domain as verified, create an API key.
3. In Supabase, open **Authentication → Emails → SMTP Settings**, turn on custom SMTP and enter: host `smtp.resend.com`, port `465`, username `resend`, password your API key, sender email e.g. `portal@nextphasemaintenance.com.au`, sender name `Next Phase Maintenance`.

Microsoft 365, Google Workspace or Postmark work the same way with their own SMTP details.

Sign-in links (emailed or copied) last one hour by default. To give people a full day, set **Email OTP Expiration** to `86400` under **Authentication → Sign In / Providers → Email**.

### Day-to-day

- **Invite people:** Admin → Accounts → Invite account → **Create invite link**, then **Text it**, **Email it** or **Copy message** to send it yourself. Or use **Email the invite** once email delivery is set up (step 6). They open the link, press Continue, choose a password and land in their portal. Each link works once; if one expires, open the account and choose **Copy new invite link**.
- **Forgotten passwords:** Admin → Accounts → Edit → **Copy password link** and send it to them. Once email delivery is set up, they can also use Sign in → "Forgot password?", or you can use "Email password link".
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
npm run build      # production build (needs the Supabase settings at build time)
npm run build:demo # demo build with sample data
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
