# Manoo Pro checkout — Lemon Squeezy webhook

Automates what `mint-license.mjs` does manually: when someone pays for
Manoo Pro, this mints a signed license and emails it to them, with no
one at Corporación Jamiel needing to run a command by hand.

**Everything in this folder is written and ready.** The parts below are
the ones only you can do — they need your real identity, bank details,
and account creation, none of which Claude/an agent can do for you.

## 1. Lemon Squeezy (the actual checkout + payment)

1. Sign up at [lemonsqueezy.com](https://lemonsqueezy.com) as yourself
   (Jamiel García Velázquez / persona física — Lemon Squeezy acts as
   "merchant of record," so they handle VAT/sales tax globally; you don't
   need a registered company for this).
2. Create **two** products (or one product with two variants):
   - "Manoo Pro (Annual)" — **$49.00 USD**, recurring yearly.
   - "Manoo Pro (Monthly)" — **$6.00 USD**, recurring monthly.
   Either recurring or one-time both work — `mint-license.mjs`'s
   `--days` logic doesn't care which, it just mints a license valid for
   that many days. `api/webhook.mjs` tells the two apart by checking
   whether the product/variant name contains "month" (falls back to the
   365-day annual length if the name doesn't match anything recognized),
   so name them so that only the monthly one contains "month" somewhere.
3. Do **not** enable Lemon Squeezy's own "License Keys" feature on the
   product — Manoo's licenses are signed with your own Ed25519 key and
   verified fully offline (no telemetry, no server round-trip at
   activation time); using Lemon Squeezy's built-in license system
   instead would mean every activation calls out to their API, which
   contradicts that design.
4. Copy **both** checkout URLs — you'll paste them into `site/index.html`'s
   billing toggle (the annual/monthly switch on the Pro card already
   there; it currently just changes the displayed price and the `mailto:`
   subject line — swap `BILLING.year`/`BILLING.month`'s use of `mailto:`
   for the real checkout URLs once this is deployed).

## 2. Deploy this folder to Vercel

1. Sign up at [vercel.com](https://vercel.com) (free tier is enough for
   this volume).
2. From this `licensing/checkout-api/` folder: `vercel` (installs the CLI
   the first time it asks, then follow the prompts — "Link to existing
   project?" No, create new).
3. In the Vercel project's dashboard -> Settings -> Environment
   Variables, add the four from `.env.example`:
   - `LEMONSQUEEZY_WEBHOOK_SECRET` — you'll get this in step 3 below,
     come back and fill it in after.
   - `MANOO_PRIVATE_KEY` — paste the full contents of
     `licensing/private-key.pem` (BEGIN/END lines included).
   - `RESEND_API_KEY` — from step 4 below.
   - `FROM_EMAIL` — from step 4 below.
4. Redeploy after adding the env vars (`vercel --prod`) so the function
   picks them up.
5. Your webhook URL is `https://<your-vercel-project>.vercel.app/api/webhook`.

## 3. Point Lemon Squeezy at it

1. In Lemon Squeezy: Settings -> Webhooks -> add one.
2. URL: the `/api/webhook` URL from step 2.5 above.
3. Events: check **order_created** (that's the only one this function
   acts on; everything else is ignored and returns 200).
4. Save, copy the **Signing secret** it generates, and put that into
   Vercel's `LEMONSQUEEZY_WEBHOOK_SECRET` env var (step 2.3), then
   redeploy.

## 4. Resend (sends the license email)

1. Sign up at [resend.com](https://resend.com) (free tier: 3,000
   emails/month, plenty for this).
2. Verify a sending domain (or use their shared testing domain while
   you're still validating the flow — swap to your own domain before a
   real launch push, or emails may land in spam).
3. Create an API key, put it in Vercel's `RESEND_API_KEY`.
4. Set `FROM_EMAIL` to an address on that verified domain.

## 5. Test before trusting it with real money

Lemon Squeezy has a **test mode** — use it to make a $0 test purchase
and confirm:
- The webhook fires (check Vercel's function logs — Vercel dashboard ->
  your project -> Logs).
- A license email actually arrives.
- The license key it contains activates correctly:
  `license_activate` tool in Claude Code, or drop it in
  `~/.config/manoo/license.key`.

Only after that works end-to-end, flip Lemon Squeezy out of test mode
and update `site/index.html`'s "Get Pro" button to the real checkout URL
from step 1.4.

## Why this exists instead of just using Lemon Squeezy's built-in licensing

Manoo's whole pitch includes "runs 100% locally, no telemetry, license
verified offline." Lemon Squeezy's own License Keys feature works by
having your app call their API to validate a key — that's a server
round-trip on every activation, which is exactly what Manoo's design
avoids. This webhook keeps Lemon Squeezy scoped to just payment
processing (their actual strength — they're the merchant of record, so
you never have to think about VAT/sales tax in different countries) while
Manoo's own Ed25519 signing/verification (already built, in
`mint-license.mjs` / `plugin/server/license.mjs`) stays exactly as it is.
