// Mint a signed Manoo license key. Run by Corporación Jamiel after a
// customer pays (manually for now, until checkout is wired to Lemon
// Squeezy/Paddle — see README). Requires private-key.pem in this folder.
//
// Usage:
//   node mint-license.mjs --email cliente@example.com --plan pro --days 365
import { readFileSync, existsSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const privPath = new URL("./private-key.pem", import.meta.url);

if (!existsSync(privPath)) {
  console.error("private-key.pem not found. Run generate-keypair.mjs first.");
  process.exit(1);
}
if (!args.email) {
  console.error("Usage: node mint-license.mjs --email <email> --plan <pro|team> --days <n>");
  process.exit(1);
}

const plan = args.plan || "pro";
const days = Number(args.days || 365);
const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const payload = { email: args.email, plan, issuedAt, expiresAt };
const payloadBuf = Buffer.from(JSON.stringify(payload), "utf8");

const privateKey = createPrivateKey(readFileSync(privPath));
const signature = sign(null, payloadBuf, privateKey);

const licenseKey = `${payloadBuf.toString("base64url")}.${signature.toString("base64url")}`;

console.log("License payload:", payload);
console.log("\nLicense key (give this to the customer):\n");
console.log(licenseKey);
