// Vercel serverless function (Node.js runtime — NOT edge, so plain
// node:crypto works exactly like licensing/mint-license.mjs already does,
// no Web Crypto Ed25519 uncertainty). Receives Lemon Squeezy's
// order_created webhook, mints a Manoo Pro license the same way
// mint-license.mjs does, and emails it to the customer via Resend.
//
// Needed env vars (set as Vercel project secrets, never committed):
//   LEMONSQUEEZY_WEBHOOK_SECRET  — from the webhook's settings in Lemon Squeezy
//   MANOO_PRIVATE_KEY            — contents of licensing/private-key.pem
//   RESEND_API_KEY               — from resend.com
//   FROM_EMAIL                   — verified sender, e.g. ventas@yourdomain.com
//
// Disables Vercel's automatic JSON body parsing — the raw, exact bytes
// are needed to verify Lemon Squeezy's HMAC signature; a re-serialized
// parsed-then-stringified body would not match the signature they sent.
export const config = { api: { bodyParser: false } };

import { createHmac, timingSafeEqual, createPrivateKey, sign as cryptoSign } from "node:crypto";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const gotBuf = Buffer.from(signatureHeader, "utf8");
  return expectedBuf.length === gotBuf.length && timingSafeEqual(expectedBuf, gotBuf);
}

/** Same signing scheme as licensing/mint-license.mjs — keep these two in
 * sync if the license payload shape ever changes. */
function mintLicense({ email, plan = "pro", days = 365 }, privateKeyPem) {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const payload = { email, plan, issuedAt, expiresAt };
  const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, payloadBuf, privateKey);
  const licenseKey = `${payloadBuf.toString("base64url")}.${signature.toString("base64url")}`;
  return { licenseKey, payload };
}

async function sendLicenseEmail({ to, licenseKey, expiresAt }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to,
      subject: "Your Manoo Pro license key",
      text:
        `Thanks for getting Manoo Pro!\n\n` +
        `Your license key:\n${licenseKey}\n\n` +
        `Valid until: ${expiresAt}\n\n` +
        `Activate it with the "license_activate" tool in Claude Code, or save it to ` +
        `~/.config/manoo/license.key\n\n` +
        `Questions? Just reply to this email.`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-signature"];

  if (!verifySignature(rawBody, signature, process.env.LEMONSQUEEZY_WEBHOOK_SECRET)) {
    console.error("Manoo webhook: invalid signature, rejecting");
    res.status(401).send("Invalid signature");
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  const eventName = event?.meta?.event_name;
  // Only fulfill on a real completed order — Lemon Squeezy sends several
  // other event types (subscription_*, etc.) that don't mean "charge
  // succeeded, ship the license."
  if (eventName !== "order_created") {
    res.status(200).send(`Ignored event: ${eventName}`);
    return;
  }

  const attrs = event?.data?.attributes;
  const email = attrs?.user_email;
  // "Paid" excludes test-mode webhook pings and any not-yet-settled state
  // — don't fulfill until Lemon Squeezy itself confirms the money moved.
  const status = attrs?.status;

  if (!email) {
    console.error("Manoo webhook: order_created with no user_email", JSON.stringify(event));
    res.status(400).send("Missing user_email");
    return;
  }
  if (status !== "paid") {
    res.status(200).send(`Order not paid yet (status=${status}), ignoring`);
    return;
  }

  // Manoo Pro sells as two separate Lemon Squeezy products/variants
  // (monthly $6, annual $49) — both mint the same "pro" plan, just for a
  // different number of days. Matched by name rather than a product ID
  // so this doesn't need updating if the product is ever recreated;
  // defaults to the annual length if the name is unrecognized, since a
  // license that's valid too long is a much smaller problem than one
  // that's too short.
  const itemName = (
    attrs?.first_order_item?.product_name ||
    attrs?.first_order_item?.variant_name ||
    ""
  ).toLowerCase();
  const days = itemName.includes("month") ? 30 : 365;

  try {
    const { licenseKey, payload } = mintLicense(
      { email, plan: "pro", days },
      process.env.MANOO_PRIVATE_KEY
    );
    await sendLicenseEmail({ to: email, licenseKey, expiresAt: payload.expiresAt });
    console.log(`Manoo webhook: minted + emailed license for ${email}`);
    res.status(200).send("OK");
  } catch (err) {
    // 500 so Lemon Squeezy retries the webhook later rather than silently
    // losing a paid order — check Vercel's function logs for this.
    console.error("Manoo webhook: fulfillment failed", err);
    res.status(500).send("Fulfillment failed, will retry");
  }
}
