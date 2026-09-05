// Sends a one-off email via Resend, for Claude to use on request (e.g.
// "send me the license by email") — separate from checkout-api/, which
// only fires automatically from a Lemon Squeezy webhook.
//
// Reads the API key from RESEND_API_KEY if set, otherwise from
// licensing/resend-api-key.txt (gitignored, same pattern as
// private-key.pem — never commit it).
//
// Usage:
//   node send-email.mjs --to x@y.com --subject "Subject" --body "Plain text body"
import { readFileSync, existsSync } from "node:fs";

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

const args = parseArgs(process.argv.slice(2));
const keyPath = new URL("./resend-api-key.txt", import.meta.url);

const apiKey =
  process.env.RESEND_API_KEY ||
  (existsSync(keyPath) ? readFileSync(keyPath, "utf8").trim() : null);
const fromEmail = process.env.MANOO_FROM_EMAIL || "onboarding@resend.dev";

if (!apiKey) {
  console.error(
    "No Resend API key found. Set RESEND_API_KEY, or put it (nothing else) " +
      "in licensing/resend-api-key.txt."
  );
  process.exit(1);
}
if (!args.to || !args.subject || !args.body) {
  console.error('Usage: node send-email.mjs --to <email> --subject "..." --body "..."');
  process.exit(1);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: fromEmail,
    to: args.to,
    subject: args.subject,
    text: args.body,
  }),
});

if (!res.ok) {
  console.error(`Resend API error ${res.status}:`, await res.text());
  process.exit(1);
}

const data = await res.json();
console.log("Sent. Resend id:", data.id);
