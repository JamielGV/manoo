// Run once per plan (or whenever you change a price) to create the
// recurring Product/Price and a reusable Payment Link for Manoo Pro on
// Stripe. Prints the URL to put in site/index.html's billing toggle —
// run it twice, once per plan, since Manoo Pro sells as two separate
// prices (annual $49, monthly $6).
//
// Easier alternative: Stripe Dashboard → Product catalog → Add product →
// Create payment link. This script exists for reproducibility/scripting.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_xxx node create-payment-link.mjs --price 4900 --interval year --name "Manoo Pro (Annual)"
//   STRIPE_SECRET_KEY=sk_live_xxx node create-payment-link.mjs --price 600 --interval month --name "Manoo Pro (Monthly)"

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      out[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function stripe(secretKey, path, body) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
  return data;
}

const args = parseArgs(process.argv.slice(2));
const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.error("Set STRIPE_SECRET_KEY in your environment first (Stripe Dashboard > Developers > API keys).");
  process.exit(1);
}
if (!args.price) {
  console.error('Usage: STRIPE_SECRET_KEY=sk_live_xxx node create-payment-link.mjs --price 4900 --interval year --name "Manoo Pro (Annual)"');
  console.error("(--price is in cents, e.g. 4900 = $49.00; --interval is 'year' or 'month', default 'year')");
  process.exit(1);
}
const interval = args.interval || "year";
if (interval !== "year" && interval !== "month") {
  console.error(`--interval must be "year" or "month", got "${interval}"`);
  process.exit(1);
}

const product = await stripe(secretKey, "products", { name: args.name || "Manoo Pro" });
console.log("Product created:", product.id);

const price = await stripe(secretKey, "prices", {
  product: product.id,
  unit_amount: args.price,
  currency: args.currency || "usd",
  "recurring[interval]": interval,
});
console.log("Price created:", price.id);

const link = await stripe(secretKey, "payment_links", {
  "line_items[0][price]": price.id,
  "line_items[0][quantity]": "1",
});

console.log(`\n${interval === "year" ? "Annual" : "Monthly"} payment link created.`);
console.log("URL:", link.url);
console.log(
  `\nPut this URL in site/index.html's BILLING.${interval === "year" ? "year" : "month"}.mailSubject spot ` +
    `(replace the mailto: link for that billing period in the toggle)."`
);
console.log("\nIf you haven't already, run this again for the other billing period.");
console.log("\nDon't forget: Stripe Dashboard > Developers > Webhooks > add endpoint");
console.log("pointing to https://manoo-payments.YOUR-SUBDOMAIN.workers.dev/webhook/stripe");
console.log('subscribed to the "invoice.paid" event, then copy its signing secret into');
console.log("wrangler secret put STRIPE_WEBHOOK_SECRET.");
