# B-Flow

Construction management app to optimise day-to-day function — the business operations platform for **Next Phase Maintenance** (Melbourne, VIC · ABN 74 490 530 153).

It combines the public website with three role-based portals:

| Portal | What it does |
| --- | --- |
| **Public homepage** | Services, how it works, Melbourne coverage, contact & hours, top-right **Sign in** |
| **Client** | Maintenance requests with photos (urgent jobs SMS the office), Maintenance Hub (live / completed / schedule), renovation quote requests & project tracking, property registry (paint colours, skirting, cladding, access, floor plan) |
| **Service provider** | Inbox with work-order acknowledgement, live works with status updates & completion photos, project milestones, drag-to-reschedule calendar linked to work orders, budget & expense submission |
| **Admin (ops command centre)** | Triage & dispatch with provider assignment and SMS, quotes & projects (scope, milestones, expense approval), QuickBooks invoice ledger with bank-transfer settlement, SMS gateway settings & logs, invite-only accounts with granular permissions |

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run lint
```

The build uses relative paths and hash routing, so the contents of `dist/` can be hosted on any static host (Netlify, Vercel, GitHub Pages, cPanel, etc.).

## Accounts

- **Master admin:** `admin@nextphasemaintenance.com.au` with the password from the implementation plan. Change it after first sign-in using the key icon in the portal header.
- **Sample data** (password `demo1234`): clients `sarah@whitfieldproperty.com.au` and `marcus.lee@example.com.au`; providers `dan@kowalskicarpentry.com.au`, `priya@brightsparkelectrical.com.au` and `tom@gallagherplumbing.com.au`. Delete these under **Admin → Accounts** before going live.
- New accounts are **invite-only**. An admin creates the invite and shares the code, and the person activates it from **Sign in → I have an invite code**.

## Business details to fill in

Edit `src/lib/brand.ts` for the public phone number (hidden until set), business hours and coverage suburbs.

## Important limitations (read before going live)

This first version follows the plan's **LocalStorage data store**:

1. **Data lives in each browser only.** A request lodged on a client's phone will not appear on the admin's laptop. To share data between users and devices, the store (`src/lib/store.tsx`) needs to move to a backend such as Supabase, Firebase or a custom API. The data model in `src/lib/types.ts` is ready to map onto database tables.
2. **Sign-in runs in the browser.** Passwords are stored as SHA-256 hashes, but anyone with the code or access to the device can get around the checks. Real security needs server-side authentication, which comes with the backend in point 1.
3. **SMS:** browsers usually block direct calls to Twilio or MessageBird (CORS), and the credentials would sit on the device. Use the **Custom webhook** provider and point it at a small server function that holds the credentials. It receives `POST { to, from, message, event }`. Every attempt is recorded in the dispatch log.
4. **Photos** are downscaled and stored in the browser, which holds roughly 5 MB in total. A banner appears if storage fills up.

## Project structure

```
src/
  lib/          types, seed data, store (state + auth + SMS), router, utils, brand
  components/   UI primitives, portal shell, calendar, shared work-order views
  pages/
    PublicHome.tsx
    client/     ClientPortal (request form, hub, projects, properties)
    provider/   ProviderPortal (inbox, hub, projects, calendar, budget)
    admin/      AdminPortal, Dispatch, AdminProjects, Finance, SmsGateway, Accounts
```
