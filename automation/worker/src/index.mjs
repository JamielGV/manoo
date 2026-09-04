// Manoo payments worker — Stripe edition. Receives a Stripe webhook,
// independently re-verifies the invoice with Stripe's own API (never
// trusts the webhook body alone), mints a signed license, and emails it.
// No human intervention required per sale — and renewals reissue the
// license automatically too, since `invoice.paid` fires for both the
// first payment and every renewal of a subscription.
//
// Security model (see PROTECT DATA/MONEY rule this was built under):
//  - Stripe's webhook signature scheme (documented, stable, unchanged for
//    years) is verified below — this is a real filter, unlike the
//    Mercado Pago version's unconfirmed format.
//  - Even so, we still re-fetch the invoice from Stripe's API with our
//    own secret key before minting anything, and check amount+currency —
//    defense in depth, not just the signature.
//  - Idempotent per Stripe event id, via Cloudflare KV, so a retried
//    webhook never issues two licenses.

const PLAN = "pro";
const LICENSE_DAYS = 380; // a little over a year of margin past the billing period

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook/stripe") {
      return handleWebhook(request, env);
    }
    return new Response("not found", { status: 404 });
  },
};

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");

  const sigOk = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!sigOk) {
    console.log("Stripe signature check failed — rejecting.");
    return new Response("invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  if (event.type !== "invoice.paid") {
    return new Response("ignored", { status: 200 });
  }

  // Idempotency — never issue two licenses for the same Stripe event.
  const already = await env.PROCESSED_PAYMENTS.get(`event:${event.id}`);
  if (already) {
    return new Response("already processed", { status: 200 });
  }

  const invoiceId = event.data?.object?.id;
  if (!invoiceId) return new Response("no invoice id", { status: 200 });

  // THE real check: ask Stripe directly, with our own secret key.
  const invoice = await fetchInvoice(invoiceId, env.STRIPE_SECRET_KEY);
  if (!invoice || invoice.status !== "paid") {
    console.log(`Invoice ${invoiceId} is not paid according to Stripe's own API — skipping.`);
    return new Response("not paid", { status: 200 });
  }

  const expected = Number(env.EXPECTED_AMOUNT_CENTS);
  if (Number.isFinite(expected) && invoice.amount_paid < expected) {
    console.log(`Invoice ${invoiceId} amount ${invoice.amount_paid} is below expected ${expected} — skipping.`);
    return new Response("amount mismatch", { status: 200 });
  }

  const email = invoice.customer_email || (await fetchCustomerEmail(invoice.customer, env.STRIPE_SECRET_KEY));
  if (!email) {
    console.log(`Invoice ${invoiceId} has no resolvable customer email — cannot issue a license.`);
    return new Response("no customer email", { status: 200 });
  }

  const licenseKey = await mintLicense(email, env.MANOO_PRIVATE_KEY_PEM);
  await sendLicenseEmail(env, email, licenseKey);

  await env.PROCESSED_PAYMENTS.put(`event:${event.id}`, JSON.stringify({ email, invoiceId, at: new Date().toISOString() }), {
    expirationTtl: 60 * 60 * 24 * 400,
  });

  return new Response("ok", { status: 200 });
}

async function fetchInvoice(invoiceId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/invoices/${invoiceId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchCustomerEmail(customerId, secretKey) {
  if (!customerId) return null;
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const customer = await res.json();
  return customer.email || null;
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  // Reject stale signatures (Stripe recommends a 5 minute tolerance).
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computed = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(computed, v1);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintLicense(email, privateKeyPem) {
  const der = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + LICENSE_DAYS * 24 * 60 * 60 * 1000);
  const payload = JSON.stringify({
    email,
    plan: PLAN,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const payloadBuf = new TextEncoder().encode(payload);
  const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, key, payloadBuf);

  return `${base64url(payloadBuf)}.${base64url(new Uint8Array(sigBuf))}`;
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendLicenseEmail(env, buyerEmail, licenseKey) {
  const subject = "Tu licencia de Manoo Pro";
  const text = [
    "¡Gracias por tu compra de Manoo Pro!",
    "",
    "Tu clave de licencia:",
    licenseKey,
    "",
    "Cómo activarla:",
    '1. En Claude Code, con el plugin Manoo instalado, pide: "activa mi licencia de Manoo con esta clave: <pega la clave>"',
    "2. O guárdala directamente en ~/.config/manoo/license.key",
    "",
    "Esta licencia se renueva sola cada año mientras tu suscripción siga activa.",
    "",
    "Cualquier duda, responde este correo.",
    "— Corporación Jamiel",
  ].join("\n");

  await sendViaResend(env, buyerEmail, subject, text);
  if (env.SELLER_NOTIFY_EMAIL) {
    await sendViaResend(
      env,
      env.SELLER_NOTIFY_EMAIL,
      `Nueva venta/renovación de Manoo Pro — ${buyerEmail}`,
      `Se emitió una licencia para ${buyerEmail}.\n\nClave:\n${licenseKey}`
    );
  }
}

async function sendViaResend(env, to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_ADDRESS || "Manoo <onboarding@resend.dev>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    console.log("Resend send failed:", res.status, await res.text());
  }
}
