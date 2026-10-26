# B-Flow

Construction management app to optimise day-to-day function — the business operations platform for **Next Phase Maintenance** (Melbourne, VIC · ABN 74 490 530 153).

It combines the public website with three role-based portals:

| Portal | What it does |
| --- | --- |
| **Public homepage** | Services, how it works, Melbourne coverage, contact & hours, top-right **Sign in** |
| **Client** | Maintenance requests with photos (urgent jobs SMS the office), Maintenance Hub (live / completed / schedule), renovation quote requests with an itemised breakdown, approving or declining variations, payment schedule and project tracking, property registry (paint colours, skirting, cladding, access, floor plan) |
| **Service provider** | Inbox with work-order acknowledgement, live works with status updates & completion photos, project milestones, drag-to-reschedule calendar linked to work orders, budget & expense submission |
| **Admin (ops command centre)** | Website maintenance requests with photos (follow up, add as a client), triage & dispatch with provider assignment and SMS, quotes & projects (itemised quotes by section with GST, variations, progress-payment schedules raised as invoices, costs and margin against the contract, scope, milestones, expense approval), QuickBooks invoice ledger with bank-transfer settlement, SMS gateway settings & logs, invite-only accounts with granular permissions, online store orders & products with an AI product finder |
| **Store** | Vanities, shower screens, tapware and more, open to anyone from the homepage and in the client and service provider portals. Order now, pay by invoice; service providers see trade prices |

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

1. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up". New people can then only join through an invite from the app. (The database blocks uninvited sign-ups as well: a login is only linked to an account an admin has invited.)
2. **Authentication → Users → Add user → Create new user**: enter `admin@nextphasemaintenance.com.au`, choose a strong password and tick **Auto Confirm User**. The login links to the admin profile automatically.

### 3. Add the server functions

In **Edge Functions → Deploy a new function → Via Editor**, create these functions. For each one, use the name shown, replace the editor contents with the file and click **Deploy**:

| Name | File |
| --- | --- |
| `send-sms` | [`supabase/functions/send-sms/index.ts`](supabase/functions/send-sms/index.ts) |
| `invite-user` | [`supabase/functions/invite-user/index.ts`](supabase/functions/invite-user/index.ts) |
| `store-assistant` | [`supabase/functions/store-assistant/index.ts`](supabase/functions/store-assistant/index.ts) and [`photo.ts`](supabase/functions/store-assistant/photo.ts) (the store's AI product finder; optional; add both files) |

(Developers can use the CLI instead: `supabase link`, then `supabase functions deploy send-sms invite-user store-assistant`.)

**AI product finder (optional).** The store's assistant uses Claude, from Anthropic. Create an API key at [console.anthropic.com](https://console.anthropic.com) (Settings → API keys), add some credit and set a monthly spend limit there, then add it under **Edge Functions → Secrets** as `ANTHROPIC_API_KEY`. Each search or draft searches or reads the web and usually costs well under a dollar. Without the key the rest of the store works and the finder shows these steps instead.

### 4. Text messages (from your own phone)

Texts to trades, clients and website requests go from **your own mobile number**: wherever the portal texts someone (Admin → **Text messages**, the step after dispatching a job, **Text** on a website request, **Text it** on an invite), it opens Messages on your iPhone (or a Mac signed in to Messages) with the number and text filled in. Check it, tap Send, and the conversation stays in your Messages with replies coming to your phone as usual. Nothing to set up. On a Windows computer, use **Copy text** and send it from your phone.

### 4b. Automatic alerts (optional, kept secret on the server)

Automatic alerts (e.g. a text to your admin phones when a client lodges an urgent request) need an SMS provider with its own number, so they don't come from your iPhone. Your portal inbox shows every alert either way.

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

### Updating an existing install

When an update adds files to [`supabase/migrations`](supabase/migrations), run the new ones (oldest first) in **SQL Editor**, then straight away redeploy any changed server functions, all **before** merging the update into `main`. The database changes work with the current website, but the new website needs them; do the SQL and the functions in one sitting, since a changed function (e.g. `invite-user`) may need the new database and the other way round.

### Day-to-day

- **Invite people:** Admin → Accounts → Invite account → **Create invite link**, then **Text it**, **Email it** or **Copy message** to send it yourself. Or use **Email the invite** once email delivery is set up (step 6). They open the link, press Continue, choose a password and land in their portal. Each link works once; if one expires, open the account and choose **Create new invite link**.
- **Forgotten passwords:** Admin → Accounts → Edit → **Create password link** and send it to them. Once email delivery is set up, they can also use Sign in → "Forgot password?", or you can use "Email password link".
- **Change your own password:** the key icon in the portal header.
- **Clients without a login:** Admin → Accounts → Invite account → fill in their details (email optional) → **Add without login**. Nothing is sent to them; they show as "No login". You can record their properties, projects and jobs straight away: Admin → Quotes & projects → **New project** (you can also add a brand-new client and property right in that form), or open their dashboard. When they need access, open their account, make sure their email is there (save it first), and choose **Create invite link**: once they set a password they see everything already recorded for them.
- **Service providers without a login:** add them the same way. They can be assigned jobs and projects straight away (shown as "(no login)"); the job details go to their mobile by SMS if that's switched on, and their work orders wait in their inbox until you invite them. Accounts without a login can be suspended, and go back to "No login" when reactivated.
- **New projects:** Admin → Quotes & projects → **New project**: pick the client (or add one without a login), their property (or add one), and set the title, status, budget, quote and trade. Assigned trades get a work-order message; a project created as "Quote issued" tells the client their quote is ready.
- **The store:** anyone can browse at *your-site*/#/store (linked from the homepage), and clients and service providers also have a **Store** tab in their portal with their order history. Orders are placed without payment: every admin gets an inbox message, and you confirm availability and delivery, then send an invoice. Service providers with a login see and pay the trade price where you've set one.
- **Products:** Admin → **Store** → **Add product**: title, category, price, optional trade price, description and photos, plus office-only supplier, cost (with your margin) and notes that customers never see. Drafts are only visible to admins; publish when ready, or archive to hide.
- **Orders:** Admin → Store → Orders → **Open**: move the order through New → Confirmed → Paid → Fulfilled (or Cancelled) and keep office notes, which customers never see. Customers see the status in their portal. What was ordered and its price can't be changed after it's placed; cancel and ask them to order again instead.
- **AI product finder:** Admin → Store → **AI product finder**: describe what you're after (e.g. "matte black basin mixers") and it searches the web for products sold in Australia, with photos from each supplier's page, links and prices (usually well under a minute; it shows what it's searching for as it goes, and **Stop** ends it). Click a photo for a larger preview. **Draft listing** reads the supplier's page and writes a listing in its own words, which opens in the product editor as a draft with the supplier link and anything to double-check. Nothing is published until you do it, so check prices, specs and photo rights with the supplier first.
- **Website maintenance requests:** people without an account use **Request maintenance** on the home page (the hero button, the button in the "Something need fixing?" section, or any service tile). A pop-up asks them to pick **one** of your services, add **at least one photo** (up to 6), say what needs doing and how soon, and leave their name and a phone number or email; no sign-up needed. Each request lands in Admin → **Enquiries** and in the inbox of admins who can dispatch jobs or manage projects ("Urgent request" when they say it's urgent). Open one to see the photos (click for full size), call or email them, keep notes, move it from New to Contacted to Won or Not going ahead, and **Add as client** to set them up as a client without a login (it links to an existing client instead when their email or phone is already on file). **Delete (spam)** removes the request and its photos. The form has a hidden spam trap, and each person or connection can only send a few an hour.
- **Quotes and running a project:** Admin → Quotes & projects → **Prepare quote** (or **Manage**). The editor has tabs:
  - **Quote:** price the job line by line in sections (e.g. Demolition, Plumbing, Tiling): description, type (labour, materials, subcontract, hire), quantity, unit and rate, all ex GST. The total with GST becomes the quote amount. Add what's included, what isn't and how long the quote is valid, then **Issue quote to client**. The client sees the breakdown only once it's issued. After they accept, the quote is locked and changes go through variations. A quote can still be a single amount: leave the lines empty and enter it on the Overview tab.
  - **Variations:** price a change (ex GST, negative for a credit). When you save, the client gets a message and can approve or decline it under Projects. If they tell you by phone, use **Client approved** / **Declined** to record it; the database records who decided. A decided variation can't be changed, so add a new one instead. Approved variations add to the contract total.
  - **Payments:** set the schedule: a deposit, progress claims tied to milestones, and the balance at completion (as a % of the quote, a fixed amount, or whatever's left of the contract). **Raise claim** adds a draft invoice for that stage in Finance, ready to issue in QuickBooks (needs "Manage invoices"). The client sees each stage and whether it's upcoming, invoiced or paid.
  - **Costs & margin** (office only): log costs such as materials, subcontractors, hire and permits (ex GST). Approved trade expenses count automatically. You see the contract value, costs to date, margin and how much has been claimed and paid.
- **Open a client's or service provider's dashboard:** Admin → Accounts → click their name or **Open dashboard**. You see their portal as they do and can work in it: lodge a request, ask for or answer a quote, add a property, update a job, acknowledge a work order or submit an expense. Nothing you do there is recorded as them: jobs, quotes and expenses show "Lodged by" / "Added by" your name (clients and trades see "Next Phase Maintenance"), answered quotes and acknowledged work orders say who did it, and notes and office messages read "Your name for Their name", including a note on the job when you change its status or add photos. Property changes, milestone ticks and calendar moves aren't recorded against anyone, wherever they're made. An orange bar across the top shows whose dashboard you're in; **Back to accounts** (or your browser's Back button) returns you to your own portal. Your own permissions apply there, so some buttons may be missing if your admin account lacks them.
- **Deleting accounts:** a client with jobs, projects or invoices can't be deleted, and neither can an admin recorded as doing something for someone else (lodging a job, quote request or expense in their dashboard, accepting or rejecting a quote, including in Quotes & projects, or acknowledging a work order), since that would erase the record. Suspend them instead. Deleting a service provider keeps their jobs and expenses, with the jobs unassigned.

## How the data is protected

The rules live in the database (row-level security), so they apply even if someone bypasses the app:

- **Clients** see only their own properties, requests, projects, invoices and inbox. They can lodge requests, ask for quotes, accept or decline a quote, and approve or decline a proposed variation, but can't change prices or job details. They see a quote's line items only once it's issued, and never the project's costs or margin.
- **Service providers** see only the jobs and projects assigned to them, plus the related property and client. They can update status, notes, schedule dates, completion photos and milestones, and submit expenses. They can't change anything else or approve their own expenses, and don't see quotes, variations, payments or costs.
- **Admins** see everything. Finance requires the "Manage invoices" permission, and accounts require "Edit accounts & permissions". Working in someone else's dashboard uses the admin's own permissions ("Dispatch & assign jobs" to lodge or update jobs, "Manage projects & quotes" for quotes, milestones and expenses). The database records the signed-in admin as the person who created each job, quote and expense, last accepted or rejected each quote, and acknowledged each work order. The app can't change that, and an account with such records can't be deleted.
- **Website maintenance requests** can only be sent through the form's database function, which checks them (one of your services, photos that were really uploaded and aren't on another request) and limits each visitor. Visitors' photos go to a private storage bucket they can add to but not read back. Only admins who can dispatch jobs or manage projects can see the requests and photos; they can change an enquiry's status, notes and linked client, but not what the visitor wrote.
- **SMS** can only be sent through the server function. Clients can trigger the office alert for their own new request, once. Only admins can text other numbers.
- **Sign-ups:** a login is only ever linked to an account an admin has invited (through the app's invite), so knowing a client's email isn't enough to claim their account. Once an account has a login, its email can't be changed.
- **Store:** visitors see published products only. Trade prices are visible only to service providers with a login and to admins with "Manage store & orders"; supplier details, costs and office notes on orders only to those admins. Orders are priced by the database from the current catalogue (whatever the browser sends), only published items that aren’t out of stock can be ordered. To stop anyone flooding the order form, a visitor can place 5 orders an hour (per connection and per email) and a signed-in customer 10, with a higher cap on all visitors' orders together; the visitor's internet address is kept for a day for this and can't be read through the app. Customers see only their own orders and can't change them; admins can only change an order's status and notes. The AI product finder can only be used by admins with "Manage store & orders".

Photo links use long random names that can't be guessed, but anyone who has a link can open it. Avoid photographing anything highly sensitive, such as alarm codes.

## Development

```bash
npm install
npm run dev        # http://localhost:5173 (demo mode unless .env.local is set; see .env.example)
npm run build      # production build (needs the Supabase settings at build time)
npm run build:demo # demo build with sample data
npm run lint
npm run test:db    # database access-rule tests; needs a local Postgres, e.g. PGHOST=/tmp PGPORT=5432 PGUSER=postgres
npm run test:unit  # unit tests (e.g. finding a product's photo on a supplier page)
```

Edit `src/lib/brand.ts` for the public phone number (hidden until set), business hours and coverage suburbs.

```
src/
  lib/          types, store (state, auth, sync), db (Supabase table mapping), supabase client, seed data, router, utils, brand
  components/   UI primitives, portal shell, sign-in, calendar, shared work-order views
  pages/        PublicHome, client/, provider/, admin/, store/
supabase/
  migrations/   database schema + access rules
  functions/    send-sms, invite-user, store-assistant (server functions)
  tests/        access-rule tests that run against a real Postgres
```
