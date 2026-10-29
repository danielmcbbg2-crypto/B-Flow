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
| `store-assistant` | [`supabase/functions/store-assistant/index.ts`](supabase/functions/store-assistant/index.ts), [`photo.ts`](supabase/functions/store-assistant/photo.ts) and [`images.ts`](supabase/functions/store-assistant/images.ts) (the store's AI product finder and photo maker; optional; add all three files) |
| `supplier-stock` | [`supabase/functions/supplier-stock/index.ts`](supabase/functions/supplier-stock/index.ts), [`stock.ts`](supabase/functions/supplier-stock/stock.ts) and [`web.ts`](supabase/functions/supplier-stock/web.ts) (checks suppliers' stock every 6 hours; turn **Verify JWT** off for this one: it checks logins itself, and the scheduled run needs none) |
| `process-sms-outbox` | [`supabase/functions/process-sms-outbox/index.ts`](supabase/functions/process-sms-outbox/index.ts) (sends queued automatic texts; turn **Verify JWT** off) |

(Developers can use the CLI instead: `supabase link`, then `supabase functions deploy send-sms invite-user store-assistant`, then `supabase functions deploy supplier-stock process-sms-outbox --no-verify-jwt`.)

**AI product finder (optional).** The store's assistant uses Claude, from Anthropic. Create an API key at [console.anthropic.com](https://console.anthropic.com) (Settings → API keys), add some credit and set a monthly spend limit there, then add it under **Edge Functions → Secrets** as `ANTHROPIC_API_KEY`. Each search or draft searches or reads the web and usually costs well under a dollar. Without the key the rest of the store works and the finder shows these steps instead.

**New product photos (optional).** Making new photos from a supplier's uses Google's Gemini image model. Create an API key at [aistudio.google.com](https://aistudio.google.com) (Get API key), turn on billing for it (image generation is paid; each photo costs a few cents), and add it under **Edge Functions → Secrets** as `GEMINI_API_KEY`. `GEMINI_IMAGE_MODEL` optionally picks the model (default `gemini-2.5-flash-image`). Without the key, listings are drafted without new photos and say so.

### 4. Text messages (from your own phone)

Texts to trades, clients and website requests go from **your own mobile number**: wherever the portal texts someone (Admin → **Text messages**, the step after dispatching a job, **Text** on a website request, **Text it** on an invite), it opens Messages on your iPhone (or a Mac signed in to Messages) with the number and text filled in. Check it, tap Send, and the conversation stays in your Messages with replies coming to your phone as usual. Nothing to set up. On a Windows computer, use **Copy text** and send it from your phone. **Using a Mac or iPad?** It can send iMessages on its own, but ordinary SMS (green bubbles, to people without an iPhone) only go through your iPhone: on the iPhone, open Settings → Apps → Messages → **Text Message Forwarding** and switch on the Mac/iPad (same Apple Account; the iPhone needs to be on with signal). Also keep **Send as Text Message** on there. Every text opened (or copied) from the portal is kept in the **Text log** on that page: who opened it, to whom, for what and the text. The portal can't see whether you tapped Send, so your Messages app is the record of what was actually sent. Invite and password texts are logged without their sign-in link, and log entries can't be changed or deleted.

### 4b. Automatic texts with ClickSend (kept secret on the server)

Some texts go out on their own, without anyone tapping Send. **ClickSend** sends them, from your own mobile number, so replies still come to your phone:

- **Booking reminders:** the afternoon before each booking (5 pm in summer, 4 pm in winter, Melbourne time), the trade and the client are texted the time, address and job. This covers project tasks on running projects and scheduled maintenance jobs. It reaches everyone with a mobile on file, including people without a portal login, and each booking is texted once per person. On by default.
- **Office alerts:** a text to your admin phones when a client lodges a request (Admin → Text messages → Office alerts).
- **Website enquiry auto-reply** (off until you switch it on): texts people back straight away when they send a maintenance request from the website, in your own words.

These texts don't appear in your iPhone's Messages. They're listed in the **Automatic text log** (Admin → Text messages) with whether ClickSend accepted them. Booking reminders that went out are ticked off as "Auto-texted" in the booking reminders queue. Texts you write yourself still open in Messages on your phone (section 4).

To connect ClickSend:

1. Sign up at clicksend.com and add credit.
2. In ClickSend, add your mobile as a sender: **Messaging → Sender IDs → Own number** (or **Numbers → Own Numbers**) and verify it with the code they text you.
3. Find your **API username** and **API key** under **Developers → API Credentials**.
4. In Supabase, open **Edge Functions → Secrets** and add `CLICKSEND_USERNAME`, `CLICKSEND_API_KEY`, and `CLICKSEND_FROM` (your verified mobile, e.g. `0412 345 678` or `+61412345678`). Never paste these into a chat or an email.
5. Deploy the server functions `send-sms` and `process-sms-outbox` (the second with JWT verification off, since the database calls it and it only sends texts already queued).

Until the ClickSend secrets are set, automatic texts are logged as "Queued" and not sent. Texts queued by the database (booking reminders, auto-replies) are marked held, so old ones never go out later by surprise. Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`) or any other provider (`SMS_WEBHOOK_URL`, which receives `POST { to, message, event }`, plus an optional `SMS_WEBHOOK_SECRET`) still work instead; ClickSend is used whenever its secrets are set. Switch booking reminder texts and the auto-reply on or off under **Admin → Text messages → Automatic texts**, where you also add the admin mobiles that get office alerts.

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
- **Clients without a login:** Admin → Accounts → Invite account → fill in their details (email optional) → **Add without login**. Nothing is sent to them; they show as "No login". You can record their properties, projects and jobs straight away: Admin → Projects → **New project** (or Quotes → **New quote**; you can also add a brand-new client and property right in that form), or open their dashboard. When they need access, open their account, make sure their email is there (save it first), and choose **Create invite link**: once they set a password they see everything already recorded for them.
- **Trades:** when creating or editing a service provider, pick their primary trade from the list, or choose **+ Add a custom trade…** and type it (e.g. Tiling, Roofing). Custom trades you’ve used appear in the list for the next account.
- **Service providers without a login:** add them the same way. They can be assigned jobs and projects straight away (shown as "(no login)"); the job details go to their mobile by SMS if that's switched on, and their work orders wait in their inbox until you invite them. Accounts without a login can be suspended, and go back to "No login" when reactivated.
- **New projects:** Admin → Projects → **New project** (or Quotes → **New quote**): pick the client (or add one without a login), their property (or add one), and set the title, status, budget, quote and trade. Assigned trades get a work-order message; a project created as "Quote issued" tells the client their quote is ready.
- **The store:** anyone can browse at *your-site*/#/store (linked from the homepage), and clients and service providers also have a **Store** tab in their portal with their order history. Orders are placed without payment: every admin gets an inbox message, and you confirm availability and delivery, then send an invoice. Service providers with a login see and pay the trade price where you've set one.
- **Products:** Admin → **Store** → **Add product**: title, category, price, optional trade price, description and photos, plus office-only supplier, cost (with your margin) and notes that customers never see. Drafts are only visible to admins; publish when ready, or archive to hide.
- **Orders:** Admin → Store → Orders → **Open**: move the order through New → Confirmed → Paid → Fulfilled (or Cancelled) and keep office notes, which customers never see. Customers see the status in their portal. What was ordered and its price can't be changed after it's placed; cancel and ask them to order again instead.
- **Add a product from a supplier link:** Admin → Store → **AI product finder** → paste the link to a product on a supplier's website and click **Create listing**. In about a minute it opens a draft in the product editor:
  - a listing written in your words (title, description, specs, brand, suggested price);
  - two new photos of the product, a studio shot and one in a room, made by Gemini from the supplier's photos. It keeps the product's look but uses its own background, angle, lighting and setting. Untick **Make new photos with AI** to skip them;
  - the supplier's stock right now.

  Check that the photos match the real product before publishing. New photos lower the risk of reusing the supplier's pictures, but the product's design and brand names are still the maker's, so make sure the supplier is happy for you to resell and advertise it.
- **Price structure:** every product with supplier details is priced automatically at three margins on the selling price, rounded up to the dollar:
  - **public** (anyone not signed in): 30%;
  - **signed-in clients:** 25%;
  - **trades:** 17%.

  A 30% margin means the price is the cost ÷ 0.70, so a $700 cost gives $1,000 public, $934 for clients and $844 for trades. Prices are based on the **Cost** you enter for the product, or, if that's empty, the supplier's price as read from their page. They follow automatically whenever the cost or the supplier's price changes, and store managers get an inbox message when a supplier's price goes up or down. Change the margins under Admin → Store → Products → **Change margins**; every automatically priced product is re-priced straight away. To set a product's prices yourself, untick **Price automatically from the cost** in the product editor. Every price change is saved in the product's **Price history**: when, why, the cost it was based on, the three prices, and who changed it. Checkout charges each person their own price (the database decides, not the browser).
- **Product options (variants):** a product can offer up to 3 options, such as **Size** (600 / 750 / 900 mm) or **Colour** (White / Oak), with up to 30 choices each. Add them under **Options** in the product editor. Customers pick one choice of each in the shop. The price updates as they choose, and the product card shows "From" the cheapest price.
  - On an automatically priced product, enter what each choice **costs you extra**. It's added at each tier's margin, rounded up to the dollar, and the editor shows what it adds for the public, clients and trades. For example, $140 extra adds $200 / $187 / $169.
  - On a product priced by hand, enter the **extra price**; it's the same for everyone.
  - Untick **Available** to show a choice that can't be picked for now.
  - The same product with different choices is a separate line in the cart, and every order shows what was chosen, e.g. "Size: 900 mm · Colour: Oak".
  - The **Price history** records option changes too: a changed extra cost or price, a new choice, or a removed one. Under each entry it lists the choices that changed, with what they add for the public, clients and trades and their extra cost.
  - The database checks every option was chosen from available choices and works out the price itself. Your extra costs, and what clients and trades pay, stay hidden like the prices themselves.
- **Supplier stock tracking:** every product with a supplier link has its supplier page checked every 6 hours. The check reads the stock (in stock, running low, out of stock, and how many where the page says) and the supplier's price, from the page's product data or wording. If a page doesn't say plainly, Claude reads it, only when the page has changed. When the supplier runs out, the listing switches to **Out of stock** (or **To order**, chosen per product) and store managers get an inbox message. When it's back, the listing switches back, unless you'd changed it yourself, and they're told again. They're also told when stock runs low (3 or fewer). The product editor shows the last reading, with **Check now**, a switch to stop tracking a product, and what to show when they run out. The product list shows each supplier's stock too.
- **AI product finder:** Admin → Store → **AI product finder**: describe what you're after (e.g. "matte black basin mixers") and it searches the web for products sold in Australia, with photos from each supplier's page, links and prices (usually well under a minute; it shows what it's searching for as it goes, and **Stop** ends it). Click a photo for a larger preview. **Draft listing** reads the supplier's page and writes a listing in its own words, which opens in the product editor as a draft with the supplier link and anything to double-check. Nothing is published until you do it, so check prices, specs and photo rights with the supplier first.
- **Website maintenance requests:** people without an account use **Request maintenance** on the home page (the hero button, the button in the "Something need fixing?" section, or any service tile). A pop-up asks them to pick **one** of your services, add **at least one photo** (up to 6), say what needs doing and how soon, and leave their name and a phone number or email; no sign-up needed. Each request lands in Admin → **Enquiries** and in the inbox of admins who can dispatch jobs or manage projects ("Urgent request" when they say it's urgent). Open one to see the photos (click for full size), call or email them, keep notes, move it from New to Contacted to Won or Not going ahead, and **Add as client** to set them up as a client without a login (it links to an existing client instead when their email or phone is already on file). **Delete (spam)** removes the request and its photos. The form has a hidden spam trap, and each person or connection can only send a few an hour.
- **Quotes dashboard:** Admin → **Quotes** shows open quote value, what you've won and your win rate over the last 90 days, and the average quote. The pipeline has four columns: **Requested** (not priced yet), **Being priced**, **Issued** (waiting on the client, with how long ago it was sent) and **Answered** (won or declined in the last 30 days). **Needs a follow-up** lists issued quotes with no answer after 5 days, and quotes that are about to expire or have expired. One tap texts (from your phone) or emails the client a ready-made follow-up, and **Done** hides the quote for 5 days. The database records when each quote was issued and answered. On a quote's Quote tab, **Add lines from…** starts it from a saved template or a past quote, and **Save as template** keeps it for next time. Templates can be renamed or deleted under Quotes → Templates.
- **Projects dashboard:** Admin → **Projects** shows active projects, their contract value, payment stages **ready to claim** (their milestone is done), projects behind schedule, and expenses awaiting approval. Each project row shows progress, the next or overdue milestone, contract, margin and what's been paid. Completed, declined and cancelled jobs are under **Closed**.
- **Project workspace:** **Manage** on a project opens its own page (link: `#/admin/projects/<id>`), with progress, tasks done, open defects, contract, margin and paid at the top, and these tabs as well as the money tabs below:
  - **Schedule:** the job as tasks in stages (e.g. Rough-in, Fit-off), each with a trade, dates and arrival time, on a timeline with today marked and overdue tasks in red. If a trade is already booked elsewhere (on any project) at the same time, you'll see a warning. **Push unfinished tasks back** shifts everything not yet done by however many days the job has slipped. Untick **Client** to keep a task off the client's schedule. Save with **Save project**.
  - **Site diary:** a daily log (weather, who was on site, work done, issues, photos). Tick **Share with the client** for entries they should see. Trades add entries from their portal too; only the office decides what the client sees. Saved as you add them.
  - **Defects:** the punch list. Add what's wrong, where, photos, the trade to fix it and a fix-by date. Trades mark items fixed (with photos and notes); the office checks and closes them, or reopens them. The client sees the list and can raise defects. The database numbers each one and records who raised, fixed and closed it, and when.
  - **Documents:** upload plans, permits, certificates, warranties and contracts (up to 25 MB each) and choose who can see each one: office only, the client, trades, or both. Files are kept private; links to open them last a few minutes.
- **What trades and clients see of a project:** each project they're on has its own page (**Open project** on their Projects page).
  - **Trades** see their bookings (with the time and address) and tap **Start** and **Done** as they go, leave notes for the office, add to the **site diary** with photos, mark the **defects** given to them fixed (**I've fixed this**, with what they did and photos), and open documents shared with trades. Their Overview lists their upcoming project bookings. The project's own trade sees the whole schedule, every defect and the access code. A trade booked only for some tasks sees just those, the defects given to them, and the project's name and address, never its quote, budget or costs.
  - **Clients** see the tasks you've left on their schedule, with what's coming up next, diary entries you've shared with them, every defect (and can report one with photos), and documents shared with them. Diary entries from trades stay private until the office shares them.
- **Trades' calendar:** a trade's Calendar shows only their own maintenance orders and project bookings, plus other trades' bookings on projects they work on (dashed, so they know who else is on site). Nothing from other jobs is shown. They can move only their own: drag it to another day, or click it and pick a day (a booking keeps its length). The office gets an inbox message whenever a trade moves something ("Booking moved" / "Job moved"). Other trades' bookings and anything else stay with the office.
- **Booking reminders:** the Command centre and the Projects dashboard list tomorrow's bookings (switch to **Today** or pick any date). Bookings are project tasks on running projects that aren't done yet, and maintenance jobs with a scheduled date. Each booking shows its time, job and address, and flags a task with **no trade booked**. **Text trade** and **Text client** open Messages on your phone with a reminder ready (time, address, job), sent from your own number. Once a text is opened it's ticked off ("Texted 4:12 pm by Daniel") for everyone in the office, and the count of reminders still to send goes down. The client only hears about tasks shown on their schedule. Trades and clients with a portal login also get a reminder in their portal inbox automatically every afternoon (5 pm in summer, 4 pm in winter, Melbourne time) for the next day's bookings, once per booking. The automatic run needs the `pg_cron` extension, which the update's SQL switches on; check it under **Integrations → Cron** (job `booking-reminders`).
- **Quotes and running a project:** click a quote on the Quotes board, or open a project's workspace. The editor has tabs:
  - **Quote:** price the job line by line in sections (e.g. Demolition, Plumbing, Tiling): description, type (labour, materials, subcontract, hire), quantity, unit and rate, all ex GST. The total with GST becomes the quote amount. Add what's included, what isn't and how long the quote is valid, then **Issue quote to client**. The client sees the breakdown only once it's issued. After they accept, the quote is locked and changes go through variations. A quote can still be a single amount: leave the lines empty and enter it on the Overview tab.
  - **Variations:** price a change (ex GST, negative for a credit). When you save, the client gets a message and can approve or decline it under Projects. If they tell you by phone, use **Client approved** / **Declined** to record it; the database records who decided. A decided variation can't be changed, so add a new one instead. Approved variations add to the contract total.
  - **Payments:** set the schedule: a deposit, progress claims tied to milestones, and the balance at completion (as a % of the quote, a fixed amount, or whatever's left of the contract). **Raise claim** adds a draft invoice for that stage in Finance, ready to issue in QuickBooks (needs "Manage invoices"). The client sees each stage and whether it's upcoming, invoiced or paid.
  - **Costs & margin** (office only): log costs such as materials, subcontractors, hire and permits (ex GST). Approved trade expenses count automatically. You see the contract value, costs to date, margin and how much has been claimed and paid.
- **Open a client's or service provider's dashboard:** Admin → Accounts → click their name or **Open dashboard**. You see their portal as they do and can work in it: lodge a request, ask for or answer a quote, add a property, update a job, acknowledge a work order or submit an expense. Nothing you do there is recorded as them: jobs, quotes and expenses show "Lodged by" / "Added by" your name (clients and trades see "Next Phase Maintenance"), answered quotes and acknowledged work orders say who did it, and notes and office messages read "Your name for Their name", including a note on the job when you change its status or add photos. Property changes, milestone ticks and calendar moves aren't recorded against anyone, wherever they're made. An orange bar across the top shows whose dashboard you're in; **Back to accounts** (or your browser's Back button) returns you to your own portal. Your own permissions apply there, so some buttons may be missing if your admin account lacks them.
- **Deleting accounts:** a client with jobs, projects or invoices can't be deleted, and neither can an admin recorded as doing something for someone else (lodging a job, quote request or expense in their dashboard, accepting or rejecting a quote, including in Quotes or Projects, or acknowledging a work order), since that would erase the record. Suspend them instead. Deleting a service provider keeps their jobs and expenses, with the jobs unassigned.

## How the data is protected

The rules live in the database (row-level security), so they apply even if someone bypasses the app:

- **Clients** see only their own properties, requests, projects, invoices and inbox. They can lodge requests, ask for quotes, accept or decline a quote, and approve or decline a proposed variation, but can't change prices or job details. They see a quote's line items only once it's issued, and never the project's costs or margin.
- **Service providers** see only the jobs and projects assigned to them, plus the related property and client. They can update status, notes, schedule dates, completion photos and milestones, and submit expenses. They can't change anything else or approve their own expenses, and don't see quotes, variations, payments or costs.
- **Admins** see everything. Finance requires the "Manage invoices" permission, and accounts require "Edit accounts & permissions". Working in someone else's dashboard uses the admin's own permissions ("Dispatch & assign jobs" to lodge or update jobs, "Manage projects & quotes" for quotes, milestones and expenses). The database records the signed-in admin as the person who created each job, quote and expense, last accepted or rejected each quote, and acknowledged each work order. The app can't change that, and an account with such records can't be deleted.
- **Project workspace:** trades see only the tasks they're booked for, the diary of projects they work on (and can add to it), defects given to them (which they can only mark fixed), and documents shared with trades. They don't see the project's money. Clients see their schedule, diary entries shared with them, all their defects (and can raise new ones), and documents shared with them. Project files are in a private bucket that only the office can upload to.
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
