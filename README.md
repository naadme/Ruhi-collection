# Ruhi Womens Clothing
`npm install && npm run dev` (build: `npm run build`)
- Business details, nav, footer, FAQ: `src/data/site.js` (phone/email/address are editable placeholders — set your real ones)
- Products, reviews, categories: `src/data/products.js`; all photography: `src/data/images.js` (every photo is a real client image in `/public/images/products`)
- Routes: `/`, `/shop`, `/collections`, `/product/:id`, `/about`, `/contact`, `/cart`, `/account`, `/policies/:slug`

---

## Contents

- [Environment variables](#environment-variables)
- [Supabase](#supabase)
  - [Google sign-in](#google-sign-in)
- [Payments — Razorpay (TEST mode first)](#payments--razorpay-test-mode-first)
  - [1. Get TEST keys](#1-get-test-keys)
  - [2. Public key for the browser](#2-public-key-for-the-browser)
  - [3. Server secrets](#3-server-secrets)
  - [4. Apply the migration](#4-apply-the-migration)
  - [5. Deploy the Edge Functions](#5-deploy-the-edge-functions)
  - [6. Create the webhook](#6-create-the-webhook)
  - [7. Test it](#7-test-it)
  - [TEST → LIVE switch](#test--live-switch)
- [How a paid order works](#how-a-paid-order-works)
- [Security notes](#security-notes)
- [Order IDs](#order-ids)
- [Product IDs](#product-ids)
- [Behaviour worth knowing](#behaviour-worth-knowing)
- [Testing](#testing)

---

## Environment variables

Copy `.env.example` to `.env`. **`.env` is gitignored — never commit it.**

Only variables prefixed with `VITE_` are inlined into the browser bundle. Anything
without that prefix is never read by Vite, so a secret *cannot* leak by accident
as long as you never add a `VITE_` prefix to it.

| Variable | Lives in | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env` | Supabase project URL (Project Settings → API) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `.env` | Supabase publishable/anon key (safe to ship) |
| `VITE_RAZORPAY_KEY_ID` | `.env` | Razorpay **Key Id** (`rzp_test_…`). Identifies the account; cannot authorise anything on its own. **Empty ⇒ the "Online payment" option is hidden and checkout cannot accept an order.** |
| `RAZORPAY_KEY_ID` | Supabase secret | Same Key Id, read server-side by the Edge Functions |
| `RAZORPAY_KEY_SECRET` | Supabase secret | The Razorpay **Key Secret**. Never in `.env`, never `VITE_*`, never in this repo |
| `RAZORPAY_WEBHOOK_SECRET` | Supabase secret | Signing secret from Razorpay Dashboard → Settings → Webhooks |
| `RESEND_API_KEY` | Supabase secret | Resend API key, read by the mail module every order email and the contact form go through. Never in `.env`, never `VITE_*`, never in this repo |
| `RESEND_FROM` | Supabase secret | Resend **From** address. **Set** to `Ruhi Collection <orders@ruhi-collections.com>` — `ruhi-collections.com` is verified at Resend. Without it the mail falls back to `onboarding@resend.dev`, which may only reach the Resend account's own address |
| `ORDER_NOTIFICATIONS_SECRET` | Supabase secret | Shared secret between the database and the `order-notifications` Edge Function. The database holds the same value in its own vault |
| `OWNER_EMAIL` | Supabase secret (optional) | Where the new-order notification goes. Unset ⇒ `ruhicollections2026@gmail.com` |
| `RAZORPAY_WEBHOOK_SECRET` | Supabase secret | The secret Razorpay signs webhook events with. **Set.** It must be the same value as the webhook's secret in the Razorpay dashboard |
| `GOOGLE_CLIENT_ID` | Supabase secret | Google OAuth client id for the order sheet (Google Cloud → APIs & Services → Credentials → Web application). Unset ⇒ the sheet panel explains the setup instead of connecting |
| `GOOGLE_CLIENT_SECRET` | Supabase secret | The matching OAuth client secret |
| `GOOGLE_TOKEN_KEY` | Supabase secret | A long random string of this project's own: the owner's Google tokens are stored AES-256-GCM encrypted with it, in `google_sheets_connections` (RLS on, no policy — only the service role reads it) |
| `GOOGLE_ADMIN_URL` | Supabase secret (optional) | The storefront URL Google sends the owner back to. Unset ⇒ `https://www.ruhi-collections.com` |
| `GOOGLE_SHEETS_SYNC_SECRET` | Supabase secret + Vercel env | Shared secret between Vercel's daily job and the `google-sheets-sync` Edge Function |
| `SUPABASE_FUNCTIONS_URL` | Vercel env | `https://<ref>.supabase.co` — where the daily job posts to |

The first three are the only ones the frontend can ever see. The rest are
read inside Edge Functions through `supabase secrets set`.

---

## Supabase

The site talks to Supabase for: products, newsletter sign-ups, contact messages,
accounts, orders and the admin dashboard. Connection is configured through the
`VITE_*` variables above.

Migrations live in `supabase/migrations/`. Apply them to the linked project with:

```bash
npx supabase db push --linked --yes
```

**Apply `20261001090000_womens_client_catalogue.sql` too** (paste it into the SQL editor, or
push it with the command above). It swaps the old demo rows for the client's real catalogue:
42 women's products across the three folders in `public/images/products/` — Tops & Shirts,
Co-ord Sets and Dresses — each row carrying its own photo gallery. Until it has run, the
storefront ignores whatever the `products` table holds and serves that bundled catalogue
instead, so the demo catalogue can never appear on the site; the dashboard, however, only
lists what is actually in the table.

**Apply `20261016103000_product_colour_and_trousers_category.sql` too** (same command). It adds
the `colour` column to `products` — backfilled only from titles that already end in a colour word
the storefront recognises, so no row is grouped differently and no title, id, URL, image, price or
order reference changes — and relaxes the `type` check to include **Trousers & Pants**
(`trousers`). Until it has run, saving a product from the admin panel fails (the panel writes the
`colour` column) and `trousers` rows are rejected by the database. The file documents its own
revert.

Row Level Security is on for every table. Highlights:

- `newsletter_subscribers` / `contact_messages` — INSERT-only for anonymous visitors, no SELECT.
- `products` — anyone can read active products, only the admin can write.
- `orders` / `order_items` — no client-side `INSERT`/`UPDATE`/`DELETE` at all. Orders are created
  only through the `create_order()` function, and a customer can only ever `SELECT` their own.
- `admins` — the allowlist. `is_admin()` is a `SECURITY DEFINER` helper; admin rights are decided
  by the database, not by anything the browser sends.
- `product_managers` — the restricted allowlist for catalogue collaborators. It can manage products
  and product images, but cannot read or update orders, payment data, Supabase, or Razorpay.
- `razorpay_webhook_events` — RLS enabled with **no** policies, granted to `service_role` only.

### Contact form → email

`/contact` posts to the `send-contact-email` Edge Function, which stores the row in
`contact_messages` **and** emails it to **`ruhicollections2026@gmail.com`** with the subject
`New Contact Form Submission — Ruhi Collection`.

```bash
# 1. Server secret (Resend → https://resend.com)
npx supabase secrets set RESEND_API_KEY=re_... --project-ref <your-project-ref>

# 2. The function
npx supabase functions deploy send-contact-email \
  --project-ref <your-project-ref> --no-verify-jwt
```

The browser sends four plain strings — `name`, `email`, `phone`, `comment`. The recipient,
subject and body are fixed inside the function, so a tampered client cannot use it as a mail
relay; `RESEND_API_KEY` is only ever read in the Edge Function runtime. The `From` address
defaults to `onboarding@resend.dev` (Resend's own onboarding address, which only reaches the
account's own inbox) — once you have verified a domain, add
`RESEND_FROM=Ruhi Collection <hello@yourdomain.com>` to the same `secrets set` command.

Also useful: the submitted address is set as `reply_to`, so replying from Gmail answers the
customer directly. Set `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` as usual — no
`VITE_` variable is added for this.

### Order emails — the customer's confirmation and the owner's notice

Two mails go out for every order that is real:

| Mail | To | Says |
| --- | --- | --- |
| **Order confirmation** | the customer's own address on the order | the brand, the Order ID, the order date, the status, how it is paid, the delivery address, every product with its Product ID, colour, size, quantity and price, and the money |
| **New-order notification** | the shop's inbox (`OWNER_EMAIL`, default `ruhicollections2026@gmail.com`) | the same order facts, plus the customer's name, email and phone, the delivery address and note, the products and quantities, and the payment status. The customer's address is the `reply_to`, so answering the notice answers the customer |

**Both payment methods are handled, and neither is ever described wrongly:**

| Method | When the mail goes out | What it says |
| --- | --- | --- |
| **Razorpay** | after the payment is verified — by the browser's `verify-razorpay-payment` *or* by Razorpay's webhook, whichever gets there first | "Paid online (Razorpay)" and "Total paid: ₹…" |
| **Cash on delivery** | the moment the order is placed | "Cash on delivery — pay when it arrives" and "Amount to pay on delivery: ₹…". It never says the order was paid, because it has not been |

**No order is ever announced twice.** Each mail has its own marker on the order —
`orders.confirmation_sent_at` and `orders.owner_notified_at` — and each is claimed with a
single compare-and-set, so Postgres decides which of the browser's call, Razorpay's webhook
and Razorpay's retries actually sends. A refused send gives the marker back, so the next
attempt can still reach the customer.

**Cash on delivery is announced by the database, not by the payment functions.** The storefront
pays online, so the payment functions never see a cash order. A deferred trigger on
`public.orders` fires at COMMIT — by which time `create_order()` has inserted the order lines
— and calls the `order-notifications` Edge Function over `pg_net`. The trigger never writes to
the order, and a failed announcement never costs the shop an order.

#### Setting it up

```bash
# 1. The shared secret between the database and the function. The SAME value
#    goes into the database's vault (step 3) — that is what lets the trigger
#    prove who it is.
npx supabase secrets set ORDER_NOTIFICATIONS_SECRET="$(openssl rand -hex 32)" \
  --project-ref <your-project-ref>

# 2. The function
npx supabase functions deploy order-notifications \
  --project-ref <your-project-ref> --no-verify-jwt

# 3. The database side: the function's URL and the same secret, in the vault.
#    Run this in the Supabase SQL editor (Dashboard → SQL → New query).
#    The URL is not a secret; the secret must be the SAME string as step 1.
select vault.create_secret(
  'https://<your-project-ref>.functions.supabase.co/order-notifications',
  'order_notifications_url');
select vault.create_secret(
  '<the same value as ORDER_NOTIFICATIONS_SECRET>',
  'order_notifications_secret');
```

The trigger is part of the migration
`supabase/migrations/20261021160000_order_notifications.sql` — apply it with
`npx supabase db push --linked --yes`.

#### The From address — done

> **`ruhi-collections.com` is verified at Resend, and `RESEND_FROM` is set to
> `Ruhi Collection <orders@ruhi-collections.com>`.** Order mail now goes out
> from that address, and it has been delivered end to end.
>
> While `RESEND_FROM` is unset it falls back to `onboarding@resend.dev`, and
> Resend answers that with *"You can only send testing emails to your own email
> address… To send emails to other recipients, please verify a domain, and
> change the `from` address to an email using this domain."* — **403, and
> nothing is delivered.** The order is still recorded and the marker is given
> back, so nothing is lost; the mail simply has not gone out.
>
> A **sending access key** (a key restricted to sending only) cannot verify a
> domain itself — the domain has to be added in the Resend dashboard. It also
> cannot *read* Resend's delivery log: `GET /emails/{id}` answers
> `401 restricted_api_key`. To read the log you need a full-access key, or the
> Resend dashboard.
>
> The free tier carries one domain and 3,000 emails a month, which is plenty
> for a shop this size.

**When a mail cannot be sent, the failure is visible rather than silent:** the
`order-notifications` function answers with the reason (`failed resend-403`), and the same
detail is written to the function's log — Dashboard → Edge Functions → `order-notifications` →
Logs. The customer is never told a mail went out when it did not.

To check the whole chain yourself at any time:

```bash
# Sends the mails for one order (and for anything else that is still owed one).
curl -X POST "https://<your-project-ref>.functions.supabase.co/order-notifications" \
  -H "Content-Type: application/json" \
  -H "x-order-notifications-secret: <ORDER_NOTIFICATIONS_SECRET>" \
  -d '{"order_id":"<the order id>"}'
```

Without the secret it answers `401` — the function is not a mail relay and cannot be pointed
at an address of someone else's choosing. An order that has already been announced answers
`already-sent` and sends nothing, however many times you ask.

### Google Sheets — the daily order sheet

The owner connects their own Google account in **Admin → Orders → Google
Sheets**. Once connected, the sheet is kept up to date **without anyone
pressing "Export"**:

- **When a payment is verified** — the moment an order is paid, the order is
  sent to the sheet (the payment functions call the sync directly). The sheet
  is a record of the order, not a part of the payment: a sheet that cannot be
  reached is logged and the payment still stands.
- **Once a day** — a scheduled job (`vercel.json` → `crons` → `/api/google-sheets-sync`,
  06:00 UTC) asks the `google-sheets-sync` Edge Function to send anything the
  event-driven path missed, and to update the rows whose status has changed.

A Google call that is refused with a `429` or a `503` is asked again two more
times, a beat apart — those two answers are given *before* Google carries out
the request, so retrying them cannot put the same orders in the sheet twice.
Anything else (a typo'd range, a revoked token, a dropped connection on a
write) is reported instead of retried, and the next day's run — or the
**Export** button — is the reliable retry for it.

**No order is ever sent twice.** The ledger `public.order_sheet_exports` has
one row per (sheet, order) and its primary key is the guard; the ledger row is
written only after Google has accepted the rows, so a crash in between sends
the order again rather than losing it.

**The sheet keeps every row it already has.** The export only appends, and a
column that is added later is written into the sheet's first row — the
existing data never moves.

**What the sheet holds:** Order ID, order date and time (the shop's own clock),
status, payment status and method, the customer's name, email, phone and
address, and then one row per line item with the product name, the Product ID,
the colour, the size, the quantity, the item price and the line total — with
the order's money repeated on every item row.

**The admin panel shows the truth:** when the last automatic sync ran, how many
orders it sent, and the reason if it could not finish.

To set the scheduled job up, two environment variables are needed — the
project's own secret, never in the repository:

```bash
# Supabase: the secret the scheduler proves itself with
npx supabase secrets set --project-ref <ref> GOOGLE_SHEETS_SYNC_SECRET=<a long random string>

# Vercel: the same secret, and where the Edge Function lives
vercel env add GOOGLE_SHEETS_SYNC_SECRET production --value "<the same string>" --sensitive
vercel env add SUPABASE_FUNCTIONS_URL production --value "https://<ref>.supabase.co" --sensitive
```

The function refuses every caller that cannot present either that secret or a
signed-in store owner's session.

The three Google functions are deployed with the same flags the config file
records (`supabase/config.toml`) — the sync and the callback take no JWT,
because a cron and a Google redirect both arrive without one, and each
proves itself another way:

```bash
npx supabase functions deploy google-sheets \
  --project-ref <ref>                      # admin actions: needs the owner's session
npx supabase functions deploy google-sheets-callback \
  --project-ref <ref> --no-verify-jwt      # Google's redirect: proves its `state` instead
npx supabase functions deploy google-sheets-sync \
  --project-ref <ref> --no-verify-jwt      # the daily job: proves GOOGLE_SHEETS_SYNC_SECRET
```

### Google sign-in and restricted product access

#### Give the Ruhi client product-management access

After applying `20261015103000_product_manager_allowlist.sql`, use this exact sequence for
`ruhicollections2026@gmail.com`:

1. Have her visit the live site, open `/admin`, and choose **Continue with Google** using that exact
   account. She must finish the Google redirect once; this creates her `auth.users` record. Signing in
   alone does **not** grant access.
2. As the project owner, open **Supabase → SQL Editor** and run:

   ```sql
   select public.make_product_manager('ruhicollections2026@gmail.com');
   ```

3. Have her refresh `/admin` (or sign out and back in). She will see Products only and can create,
   edit, hide, delete, and upload product images. She cannot access orders or any Supabase/Razorpay
   dashboard; no UUID, service-role key, or dashboard account is shared.

If step 2 reports that no Auth user was found, step 1 has not completed with that exact Google
account. Do not substitute a UUID or add a row manually; have her sign in again, then rerun the same
statement.

"Continue with Google" is a three-way handshake (browser → Supabase → Google), so the
failures worth knowing are configuration, not code. The recurring one:

```
?error=server_error&error_code=unexpected_failure
 &error_description=Unable to exchange external code: 4%2F0A…
```

Google issued a code happily — the Client ID, the registered callback URI and the
redirect allow-list are all fine when you see this. What fails is Supabase trading
that code for tokens, which only happens when the **Client Secret** stored in
Supabase does not match the Client ID Supabase is actually using: empty, mistyped,
taken from a *different* OAuth client, or regenerated in Google Cloud after it was
saved.

Check every link in the chain at once:

```bash
node scripts/check-google-oauth.mjs
```

It prints the Client ID Supabase is using, checks the callback URI is registered
with that client, and asks Google whether the Client ID/secret pair is valid (the
secret is only sent to Google — never printed, never written to disk). Any `✗` is
the link to repair; then paste that exact pair into **Supabase Dashboard →
Authentication → Sign In → Google** and press Save.

While you are there:

- **Authentication → URL Configuration → Redirect URLs** must contain the exact URL
  the app comes back to: `http://localhost:5173/account` locally, `https://<domain>/account`
  in production. The app sends `window.location.origin + '/account'`.
- **Google Cloud → OAuth consent screen** must be *In production*, or the Google
  account signing in must be listed as a test user.
- The underlying reason Google gave is in **Authentication → Logs → Auth**: the line
  just before `Unable to exchange external code` (for example
  `oauth2: "invalid_client" "Unauthorized"` = the stored secret is wrong).

---

## Payments — Razorpay (TEST mode first)

Online payment is the only payment method the storefront offers. It is built on three Supabase
Edge Functions that keep the Razorpay **Key Secret** on the server — it never reaches React, the
bundle, `localStorage`, or git.

> **Nothing below has been run for you.** The database migration *is* applied; the
> Edge Functions and secrets are **not deployed** (verify with
> `npx supabase functions list` and `npx supabase secrets list`). Follow steps 1–7
> yourself, in TEST mode.

### 1. Get TEST keys

1. <https://dashboard.razorpay.com> → sign up / sign in.
2. Complete test-mode onboarding (Account & Settings → Business Details → Settings → Account Settings).
3. **Settings → API Keys → Generate Test Key**. You get:
   - Key Id: `rzp_test_…`
   - Key Secret: shown **once** — copy it now.
4. Leave the account in **Test Mode** (the toggle at the top of the Dashboard) until step 7 passes.

Never commit either value. Live keys start with `rzp_live_` and must not exist on your machine yet.

### 2. Public key for the browser

```bash
# .env
VITE_RAZORPAY_KEY_ID=rzp_test_...
```

Restart `npm run dev` (or rebuild) — Vite only reads `.env` at start-up.
Leave it empty and "Online payment" simply does not appear; nothing else changes.

### 3. Server secrets

```bash
npx supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_... \
  RAZORPAY_KEY_SECRET=... \
  RAZORPAY_WEBHOOK_SECRET=... \
  --project-ref <your-project-ref>
```

`RAZORPAY_WEBHOOK_SECRET` comes from step 6 — if you have not created the webhook yet,
set the other two now and add this one after.

### 4. Apply the migration

```bash
npx supabase db push --linked --yes
```

`supabase/migrations/20260928213000_razorpay_online_payments.sql` is **additive** — it never
recreates or drops `orders`, and existing rows are untouched. It adds:

| Object | Purpose |
| --- | --- |
| `orders.payment_status` | `pending` → `paid` / `failed`, and `refunded` |
| `orders.razorpay_order_id` | Our id for the gateway order (unique) |
| `orders.razorpay_payment_id` | Razorpay's payment id once paid |
| `orders.paid_at` | Required the moment `payment_status = 'paid'` |
| `orders_payment_chk` | widened to `payment_method in ('cod','razorpay')` |
| `orders_payment_status_chk`, `orders_payment_state_chk` | Allowed states; `paid` ⇒ `paid_at` |
| `orders_razorpay_order_idx` | Unique index on `razorpay_order_id` |
| `orders_open_online_order_idx` | At most one unfinished online order per email |
| `orders_protect_payment_fields` trigger | Blocks `anon`/`authenticated` from writing **any** payment column — admins included |
| `razorpay_webhook_events` | Idempotency ledger for webhook delivery ids |
| `create_order(payload json)` | Accepts `payment_method`, sets `payment_status = 'pending'`, and atomically reuses an unfinished online order for the same email instead of creating a duplicate |

No table is dropped, truncated or re-created; RLS is never disabled.

### 5. Deploy the Edge Functions

Four functions, all in `supabase/functions/`, all declared `verify_jwt = false`
in `supabase/config.toml` so that guest checkout, the contact page and Razorpay's webhook
can call them:

```bash
npx supabase functions deploy create-razorpay-order verify-razorpay-payment razorpay-webhook \
  --project-ref <your-project-ref> --no-verify-jwt

npx supabase functions deploy send-contact-email \
  --project-ref <your-project-ref> --no-verify-jwt
```

They have **no** npm/Deno dependencies — plain Web APIs and `fetch` only.

| Function | Called by | Does |
| --- | --- | --- |
| `create-razorpay-order` | Browser | Validates the cart, runs `create_order()` (prices come from the catalogue), creates the Razorpay order for the **server-computed** total, returns only `{key_id, amount, currency, razorpay_order_id, reference, …}` |
| `verify-razorpay-payment` | Browser | Recomputes `HMAC_SHA256(order_id \| payment_id)` with the Key Secret, checks it against Razorpay's signature, re-fetches the order from Razorpay to confirm amount + currency, **then** sets `payment_status='paid'` |
| `razorpay-webhook` | Razorpay | Verifies `x-razorpay-signature` against the raw body, records the event id once, then reconciles `payment.captured` / `payment.failed` / `refund.processed` from the trusted database row |
| `send-contact-email` | Browser (Contact page) | Validates the four form fields, stores the message in `contact_messages`, emails it to `ruhicollections2026@gmail.com` via Resend with the submitted address as `reply_to` |
| `order-notifications` | The **database** (a deferred trigger on `orders`, through `pg_net`) and the owner by hand | Sends the customer's confirmation and the owner's new-order notification for an order, once each, to the order's own address and to the shop's inbox |

### 6. Create the webhook

The browser may die mid-payment. The webhook is what guarantees the order still
settles.

1. Razorpay Dashboard → **Settings → Webhooks → + Add New Webhook**.
2. **Webhook URL**: `https://<your-project-ref>.functions.supabase.co/razorpay-webhook`
3. **Secret**: generate a long random string — this exact value is your
   `RAZORPAY_WEBHOOK_SECRET`.
4. **Active**: yes.
5. **Events**: `payment.captured`, `payment.failed`, `refund.processed`.
6. Save, then run step 3's `supabase secrets set RAZORPAY_WEBHOOK_SECRET=…`.

Razorpay retries a non-2xx response; the ledger table makes retries harmless.

> **The webhook is the safety net for the order emails as well as for the
> payment.** When the shopper's browser dies mid-payment, this is the only
> thing that settles the order — and therefore the only thing that can send the
> confirmation.
>
> `RAZORPAY_WEBHOOK_SECRET` is now set on this project, so the function is
> ready. It refuses every event whose signature does not match, which means a
> webhook created in the dashboard with a **different** secret will be rejected
> with `401 Invalid signature`. The two must be the same value: either use the
> one already in place, or set a fresh secret in the dashboard and run
> `npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=<the same value>`.
>
> The webhook itself has been proved end to end: a correctly signed
> `payment.captured` event settles the order and sends both mails, the same
> event delivered again answers `duplicate` and sends nothing more, and a
> forged or missing signature answers `401`.

### 7. Test it

With TEST keys and the functions deployed, in the Razorpay **test mode**:

| Test card / method | Result |
| --- | --- |
| `4111 1111 1111 1111`, any future expiry, any CVV | Success → order shows `Paid` |
| `4000 0000 0000 0002` | Failure → order shows `Failed`, cart still intact, retry works |
| Close the Razorpay window (Esc / ✕) | "Nothing has been charged", still on checkout, cart intact |
| UPI test handle | Success, if enabled on your Razorpay account |

Also worth checking: refresh the confirmation page (no second order appears), an
empty cart, a wrong PIN code, and both mobile and desktop widths.

Online payment must be the only method shown at checkout — it never touches anything but Razorpay.

### TEST → LIVE switch

Everything is the same four values:

1. Razorpay Dashboard → leave **Test Mode**, complete any remaining live onboarding (KYC, bank account).
2. **Settings → API Keys → Generate Live Key** → `rzp_live_…` + secret.
3. `.env`: `VITE_RAZORPAY_KEY_ID=rzp_live_…`, then rebuild.
4. `npx supabase secrets set RAZORPAY_KEY_ID=rzp_live_… RAZORPAY_KEY_SECRET=… --project-ref …`
5. Create the webhook again against the live account (new URL is the same, new secret) and
   `supabase secrets set RAZORPAY_WEBHOOK_SECRET=…`.
6. Optionally take a real ₹1 payment and refund it to confirm `refunded` shows in admin.

The test key id and the live key id are different values — there is no other
configuration, no code change, and no flag to flip. Roll back by pasting the test
values back in.

---

## How a paid order works

1. Shopper picks **Online payment** and submits.
2. `create-razorpay-order` runs `create_order()` in Postgres. The **database** looks up the
   products, validates sizes and quantities, and computes subtotal + shipping + total —
   shipping is always `0` (free for all products), so the total equals the subtotal. The browser
   sends ids, sizes and quantities — never a price.
3. The function creates a Razorpay order for exactly that amount (in **paise**: ₹499 → `49900`)
   and stores `razorpay_order_id` against our order.
4. Razorpay Checkout opens **inside the existing checkout page**, in Razorpay's own secure frame,
   offering whatever methods your Razorpay account has enabled.
5. Razorpay returns `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
6. `verify-razorpay-payment` recomputes the signature with the Key Secret, using the
   `razorpay_order_id` **read back from the database** (a client-supplied order id is never
   trusted), re-fetches the order from Razorpay to confirm the amount, and only then marks it
   `paid`.
7. The browser clears the cart and shows the confirmation with the reference and payment id.
8. If the browser never comes back, step 6 is repeated by the webhook, which is signature-checked
   and idempotent.
9. The two order mails go out — the customer's confirmation and the owner's new-order
   notification — once each, whichever of the two paths (browser or webhook) gets there first.
   See [Order emails](#order-emails--the-customers-confirmation-and-the-owners-notice).

Nothing in the browser decides price, discount, shipping, total, or whether an order is paid.

---

## Security notes

- **The Key Secret exists in exactly one place**: `supabase secrets`. It is not in `.env`,
  not in `.env.example`, not in any `VITE_*` variable, not in `src/`, not in `dist/`, not in git.
  `RAZORPAY_KEY_SECRET` is never returned by any function response.
- `payment_status = 'paid'` can be written by the service role (Edge Functions, webhook) or the
  function owner only. A trigger blocks `anon` **and** `authenticated` — including an admin
  session — from touching `payment_status`, `razorpay_order_id`, `razorpay_payment_id` and
  `paid_at`. Admin fulfilment edits (`status`) still work.
- Verification uses an HMAC the browser cannot forge, keyed with the secret Razorpay and the
  server share. A hand-written or replayed signature fails and writes nothing.
- Amounts are checked twice: once against our database total, once against Razorpay's own record
  of the order.
- Webhooks are signature-verified against the **raw** body, replay-protected by a ledger table,
  and never grant privileges — they only update a row that already exists and only in the
  direction `pending → paid`, `pending → failed`, `paid → refunded`.
- Errors returned to shoppers are human sentences ("Payment could not be completed. Your order
  has not been charged. Please try again."). Constraint names, SQL, stack traces, `error_id`s and
  service-role keys are never shown.
- Customers can only `SELECT` their own orders; there is no client path to another customer's order.
- **The mail key exists in exactly one place**: `supabase secrets`, read by the one module that
  talks to Resend. It is not in `.env`, not in `.env.example`, not in any `VITE_*` variable, not
  in `src/`, not in `dist/`, not in git.
- The `order-notifications` function is not a mail relay: it answers `401` to anyone who cannot
  present `ORDER_NOTIFICATIONS_SECRET`, it never takes a recipient from the caller, and the
  customer's address is the one the **database** holds for that order. A browser cannot write
  `confirmation_sent_at` or `owner_notified_at` either — a trigger refuses both to `anon` and
  to `authenticated`, so a session cannot quietly silence a customer's mail or the owner's
  notice.
- The database's announcement trigger only ever **reads** an order and makes one HTTP request
  to our own function. It never writes to the order, and everything it does is wrapped so that
  a missing secret or an unreachable network leaves the order exactly as it was.

---

## Order IDs

Every order carries a customer-facing ID of **exactly eight digits**, in the
format `DDMMYYNN`:

| Part | Meaning | Example |
|------|---------|---------|
| `DD` | the day of the month | `01` |
| `MM` | the month | `10` |
| `YY` | the last two digits of the year | `26` |
| `NN` | the order's number for that day, from `01` | `01` |

So `01102601` is the **first** order of the **1st of October 2026**, and
`01102602` is the second order of the same day.

**Where the number comes from.** The database, in the shop's own time zone
(`Asia/Kolkata`), from the order's own `created_at`:

- `public.next_order_reference()` takes an advisory lock for that day, so two
  orders placed at the same moment cannot be given the same number — the
  second one waits, and reads the day's highest number *after* the lock is
  held;
- a BEFORE INSERT trigger (`orders_assign_reference`) assigns the number, so
  no code path can write an order without one;
- a unique index on `orders.reference` has the final word;
- at 99 orders in a day the number is refused with a clear message rather than
  a duplicate or a malformed ID;
- the day resets at midnight **in the shop's own time zone**, which is the
  same clock the admin panel's date filter and every displayed order date use
  (`src/lib/shopTime.js`) — so the filter, the displayed date and the ID can
  never disagree about which day an order belongs to.

**Nothing existing was renumbered.** Orders placed before the format keep
their old `RCH-XXXXXXXX` number in `orders.previous_reference`, and the admin
search finds them by either number.

Verify it against the live database (the checks run in rolled-back
transactions, so no order is created):

```bash
node scripts/verify-order-ids.mjs
```

## Product IDs

Every product carries a six-character display ID in the format `CCPPCL`:

| Part | Meaning | Example |
|------|---------|---------|
| `CC` | the category's two-digit code | `01` |
| `PP` | the product's number inside that category | `01` |
| `CL` | the colour's two-letter code | `BU` |

So `0101BU` is the first product of category 01, in the colour "Blue".

**The category codes** are assigned once, in the order the categories are
displayed, and never move: `01` Tops & T-shirts, `02` Co-ord Sets, `03`
Dresses, `04` Trousers & Pants, `05` Night Wear, `06` Kurta Sets. Renaming a
category changes only its label; a new category takes the next free code — and
a code that has ever been used is never given to a second category, so the
Product IDs in an old order can never be mistaken for a new product's.

**The colour codes** live in `public.colour_codes` — one stable pair of
letters per colour, so "Blue" is always the same code forever. A colour that
is not on file is given the first pair of its letters that nobody holds; a
colour with **no** colour recorded is `XX`, a documented placeholder and never
a guess.

**The IDs are assigned by the database** (`products_assign_sku`), never typed
by hand, and never reused.

**The Product ID is snapshotted onto every ordered line** (`order_items.sku`),
exactly like the title and the price, so an order always names the exact
product that was bought — even after that product is renamed, renumbered or
deleted. It is shown on the admin order details, in the Google Sheet, in the
Excel download and on the order confirmation email.

## Behaviour worth knowing

- **Duplicate protection.** `create_order()` refuses a second order for the same email within
  5 minutes, and at most one *unfinished* online order may exist per email. A retry reuses
  the existing order and its reference instead of creating another — so a failed or abandoned
  Razorpay attempt never leaves duplicates behind.
- **Abandoned checkouts.** If the shopper closes Razorpay, loses the network, or the tab dies:
  nothing is charged, the cart is **not** cleared, they stay on the checkout page, and the next
  attempt reuses the same order. Verification is idempotent, so retrying after a network error
  cannot double-charge.
- **Cart is only cleared after a confirmed payment.** Refreshing the
  confirmation page does not create a second order.
- **Two mails per order, never more.** The customer's confirmation and the owner's new-order
  notice are each claimed with a compare-and-set on the order itself, so the browser's
  verification, Razorpay's webhook and Razorpay's retries all race for the same two slots and
  exactly one mail each wins. A refused send gives the slot back, so nothing is lost.
- **A cash-on-delivery order is announced the moment it is placed**, by a deferred trigger in
  the database — not by the payment functions, which only ever see online orders. The trigger
  fires at COMMIT, so the mail lists every product, not just the first one.
- **`VITE_RAZORPAY_KEY_ID` empty** ⇒ no online option, no Razorpay script loaded, and checkout
  cannot accept an order.
- The FAQ mentions UPI/cards only because Razorpay is expected to be connected. Online payment is
  the only method offered — do not add a delivery-time payment option in `src/data/site.js` or
  `src/components/Footer.jsx`.
- `site.phone` and the testimonial quotes are still owner placeholders — replace them with your
  real details before launch. `site.email` is `ruhicollections2026@gmail.com`, the same mailbox
  the contact form is delivered to.
- **Categories** are owned by the database. `public.categories` holds one row per category — an
  immutable `key`, the label shoppers see, a display `position`, a two-digit `code` the Product IDs
  of its products are built from, and the photograph the category shows. The header, footer, shop
  Type filter, admin selector and homepage tiles all read that list, so a category is added in
  exactly one place: the admin panel's **Categories** section (or the "Add category" button
  beside the category picker in the product editor). A new category is on the site straight away —
  it needs no code change and no redeployment — and the database gives it its own Product ID code
  when the row is saved. The list in `TYPES` (`src/data/products.js`) is only the **fallback** the
  storefront shows if the database cannot be reached, so the shop never has an empty category
  list. The homepage hero and the "Shop by Category"/Collections tiles only advertise a category
  once it has a live product.
- **A category that still holds products cannot be deleted.** The panel shows how many products
  each category holds and refuses the delete in plain words; the database refuses it independently
  (`products_type_fkey` is `ON DELETE RESTRICT`), so a stale count can never orphan a product or
  touch an order. Nothing is ever deleted to make a delete succeed, and the photograph file a
  category used is never deleted from the image storage either.
- **The banner, best seller and category photo panels each have an All / Active / Inactive
  filter**, with the count each filter would show. Every item carries its own status and its own
  switch; switching something off keeps it, keeps its place in the order and keeps everything
  else about it (a banner's destination, a category's photograph and name). An inactive banner is
  not in the homepage slider, an inactive best seller is not in the shop window, and an inactive
  category photograph is not the one the site shows — the category itself, its products and its
  navigation all stay exactly as they were.
- **Colour grouping** lives in `src/lib/productGrouping.js` and is shared by the storefront and
  the admin dashboard: rows group into one design when they share a category, a design name and
  a colour — either the row's `colour` column or a " - Colour" title suffix the catalogue
  recognises. Nothing is ever merged on a guess, and two designs that merely share a colour
  never pool.
- **A card always opens the product it shows.** One row speaks for a whole design — the cheapest
  colour — and every row-specific field on the card comes from that one row: its id, its price,
  its photograph, its gallery, its sizes. The card used to take the photograph from the design's
  first row and the id and price from the cheapest one, so a design whose colours cost different
  amounts showed one colour's photograph and opened another. The link itself is built by
  `src/lib/productLinks.js` (`productHref`), which every card, search result and banner uses, and
  the id in it is the product's own row id — the same row the cart adds and the order prices. A
  product that has been deleted resolves to nothing (`src/lib/productLookup.js`), so its page says
  "Product not found" instead of quietly opening somebody else's product.
- **A search looks at the whole catalogue.** Searching "red" returns every product that really is
  red — in every category and in every size it is stocked in — never "the red ones in the one
  category the page happened to be showing". The rule lives in `src/lib/productSearch.js`
  (`matchesProducts`, built on the per-product `matchesProduct`), which both the results page and
  the header's live search read. A search looks at the product's name, description, category,
  Product ID, badge, sizes and the colour and description of every one of its colour rows; it
  ignores stray spaces and capitalisation. A colour word is matched against the **saved** colour —
  the `colour` column, a colour row's colour, or the " - Colour" title suffix — and never against
  a description, so a black shirt that mentions red in its text is not a red shirt. A submitted
  search leaves the category filter behind (it would hide results) and keeps the sort (sorting
  hides nothing).
- **The admin panel manages a design as one product**: shared info (name, category, description,
  sizes, badge, ratings) plus a card per colour with its own ID, price, photos and visibility.
  A save writes only the columns that really changed (`src/lib/productForm.js`), so editing one
  colour's price can never overwrite another colour's data. Removing a colour deletes only that
  colour's row; deleting a design is confirmed and names every row it removes.

---

## Testing

`npm test` (pure-logic tests under `node --test`) and `npm run build` are the quality scripts in
`package.json`; both must pass.

What has been verified against this codebase:

- Storefront end-to-end in headless Chrome — catalogue, cart, pricing, checkout, auth, account
  order history, wishlist, policies, a11y, responsive (no horizontal overflow at 390/768/1280/1440).
- Admin end-to-end — sign-in, gate, products CRUD, orders panel, status persistence, search, logout.
- SQL permission probes — anon/customer/admin `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `orders` and
  `order_items`, pricing computed server-side, newsletter/contact policies unchanged, `make_admin()`
  uncallable by clients.
- Razorpay SQL probes — order creation for both methods, duplicate refusal, retry reuse, payment
  columns un-writable by `anon`/`authenticated`, webhook ledger idempotency, `paid` requiring `paid_at`.
- Edge Function unit tests run under Node against the real sources (HMAC/signature vectors, amount
  authority, forged signatures, idempotent verification, webhook replay, secret-missing paths).
- Checkout UI with `VITE_RAZORPAY_KEY_ID` set *and* empty — online option appears/disappears, the
  button swaps between `Place order` and `Pay now`, and a failed online attempt keeps the cart so
  the shopper can retry successfully.
- Bundle scan — `checkout.razorpay.com` present, `RAZORPAY_KEY_SECRET`/`VITE_RAZORPAY` absent.
- Automated unit tests (`npm test`, Node's built-in runner) over the two pure modules:
  `tests/productGrouping.test.js` pins the grouping rule (legacy titles group exactly as before,
  no cross-category or colour-only merges, explicit colours group without losing titles) and
  `tests/productForm.test.js` pins the editor's write path (colours round-trip without loss,
  only changed columns are written, shared fields only travel when edited, IDs are locked and
  de-duplicated, validation blocks duplicates/separator colours/ID clashes).
- The admin panels are driven in a **real browser** by the scripts in `scripts/audit-*.mjs`
  (`npm run audit:admin`, `audit:banners`, `audit:orders`, `audit:filters`, `audit:categories`).
  They render the panels through the harness in `audit/` — which is **not** part of the site; the
  production build only bundles `index.html` — and intercept the browser's requests, so the panels
  can be driven with made-up rows without touching the database.
- The category lifecycle is checked against the **live database** (`npm run audit:lifecycle`): a
  category is added, the storefront reads it with its own credentials, a product joins it and is
  given a Product ID built from the category's own code, the category cannot be deleted while that
  product is there, and everything the check creates is removed again.
- The storefront is checked with a **real browser** (`npm run audit:storefront`): a category with a
  product in it appears in the navigation, in the shop's own filter and in the homepage's
  "Shop by Category" row, and switching its photograph off leaves the category and its products
  in place while the site falls back to another picture.
- The homepage's product cards are checked against the live catalogue: every card opens the very
  product it shows (same name, photograph, price, sizes and colour) and a product that no longer
  exists opens "Product not found" rather than a different one
  (`tests/homepageProductLinks.test.js`).
- The search is checked across categories and sizes: "red", "blue" and a word with no match return
  the same products whether or not a category is selected, a search submitted from inside a
  category leaves that category behind, and a product is never called red because the word only
  appears in its description (`tests/catalogueSearch.test.js`).

Manual steps only you can do: create the Razorpay TEST keys, deploy the functions, set the
secrets, create the webhook, and run a real test-mode payment (steps 1–7 above). For the order
mails, one thing is left: **add the webhook in the Razorpay dashboard** with the URL and the
three events above, and make its secret the same value as `RAZORPAY_WEBHOOK_SECRET` — the
order emails are already delivered; this only adds the safety net for a shopper whose
browser dies mid-payment.
