# Ruhi Womens Clothing
`npm install && npm run dev` (build: `npm run build`)
- Business details, nav, footer, FAQ: `src/data/site.js` (phone/email/address are editable placeholders — set your real ones)
- Products, reviews, categories: `src/data/products.js`; all photography URLs: `src/data/images.js` and the `A` map in products.js
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
| `VITE_RAZORPAY_KEY_ID` | `.env` | Razorpay **Key Id** (`rzp_test_…`). Identifies the account; cannot authorise anything on its own. **Empty ⇒ the "Online payment" option is hidden and checkout behaves exactly as a COD-only store.** |
| `RAZORPAY_KEY_ID` | Supabase secret | Same Key Id, read server-side by the Edge Functions |
| `RAZORPAY_KEY_SECRET` | Supabase secret | The Razorpay **Key Secret**. Never in `.env`, never `VITE_*`, never in this repo |
| `RAZORPAY_WEBHOOK_SECRET` | Supabase secret | Signing secret from Razorpay Dashboard → Settings → Webhooks |

The first three are the only ones the frontend can ever see. The last three are
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

Row Level Security is on for every table. Highlights:

- `newsletter_subscribers` / `contact_messages` — INSERT-only for anonymous visitors, no SELECT.
- `products` — anyone can read active products, only the admin can write.
- `orders` / `order_items` — no client-side `INSERT`/`UPDATE`/`DELETE` at all. Orders are created
  only through the `create_order()` function, and a customer can only ever `SELECT` their own.
- `admins` — the allowlist. `is_admin()` is a `SECURITY DEFINER` helper; admin rights are decided
  by the database, not by anything the browser sends.
- `razorpay_webhook_events` — RLS enabled with **no** policies, granted to `service_role` only.

### Google sign-in

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

Cash on delivery always works and is unchanged. Online payment is an extra option
built on three Supabase Edge Functions that keep the Razorpay **Key Secret** on the
server — it never reaches React, the bundle, `localStorage`, or git.

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
recreates or drops `orders`, and COD rows are untouched. It adds:

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

Three functions, all in `supabase/functions/`, all declared `verify_jwt = false`
in `supabase/config.toml` so that guest checkout and Razorpay's webhook can call them:

```bash
npx supabase functions deploy create-razorpay-order verify-razorpay-payment razorpay-webhook \
  --project-ref <your-project-ref> --no-verify-jwt
```

They have **no** npm/Deno dependencies — plain Web APIs and `fetch` only.

| Function | Called by | Does |
| --- | --- | --- |
| `create-razorpay-order` | Browser | Validates the cart, runs `create_order()` (prices come from the catalogue), creates the Razorpay order for the **server-computed** total, returns only `{key_id, amount, currency, razorpay_order_id, reference, …}` |
| `verify-razorpay-payment` | Browser | Recomputes `HMAC_SHA256(order_id \| payment_id)` with the Key Secret, checks it against Razorpay's signature, re-fetches the order from Razorpay to confirm amount + currency, **then** sets `payment_status='paid'` |
| `razorpay-webhook` | Razorpay | Verifies `x-razorpay-signature` against the raw body, records the event id once, then reconciles `payment.captured` / `payment.failed` / `refund.processed` from the trusted database row |

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

Cash on delivery must keep working throughout — it never touches Razorpay.

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
   products, validates sizes and quantities, and computes subtotal + shipping + total using the
   same rules as COD (`₹79` shipping, free over `₹999`). The browser sends ids, sizes and
   quantities — never a price.
3. The function creates a Razorpay order for exactly that amount (in **paise**: ₹999 → `99900`)
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

---

## Behaviour worth knowing

- **Duplicate protection.** `create_order()` refuses a second order for the same email within
  5 minutes (COD), and at most one *unfinished* online order may exist per email. A retry reuses
  the existing order and its reference instead of creating another — so a failed or abandoned
  Razorpay attempt never leaves duplicates behind.
- **Abandoned checkouts.** If the shopper closes Razorpay, loses the network, or the tab dies:
  nothing is charged, the cart is **not** cleared, they stay on the checkout page, and the next
  attempt reuses the same order. Verification is idempotent, so retrying after a network error
  cannot double-charge.
- **Cart is only cleared after a confirmed payment or a confirmed COD order.** Refreshing the
  confirmation page does not create a second order.
- **`VITE_RAZORPAY_KEY_ID` empty** ⇒ no online option, no Razorpay script loaded, store behaves
  exactly as it did before this feature.
- Footer payment badges and FAQ mention UPI/cards only because Razorpay is expected to be
  connected. If you ship COD-only, adjust `src/data/site.js` and `src/components/Footer.jsx`.
- `site.phone`, `site.email` and the testimonial quotes are still owner placeholders — replace
  them with your real details before launch.

---

## Testing

`npm run build` is the only quality script in `package.json`; it must pass.

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
  button swaps between `Place order` and `Pay now`, a failed online attempt keeps the cart and still
  allows a successful COD order.
- Bundle scan — `checkout.razorpay.com` present, `RAZORPAY_KEY_SECRET`/`VITE_RAZORPAY` absent.

Manual steps only you can do: create the Razorpay TEST keys, deploy the functions, set the
secrets, create the webhook, and run a real test-mode payment (steps 1–7 above).
