// Manoo license verification. Only the PUBLIC key lives here — it can
// verify a signature but cannot create one, so shipping it in the plugin
// (which every user's machine will have a copy of) is safe.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAG0nM6plBcsp0AtXhyk/xFCSv7h/wUkhhAKI6Z1zNGIw=
-----END PUBLIC KEY-----`;

export const LICENSE_FILE = join(homedir(), ".config", "manoo", "license.key");

export function verifyLicenseString(raw) {
  try {
    const [payloadB64, sigB64] = raw.trim().split(".");
    if (!payloadB64 || !sigB64) return { valid: false, reason: "malformed" };

    const payloadBuf = Buffer.from(payloadB64, "base64url");
    const signature = Buffer.from(sigB64, "base64url");
    const publicKey = createPublicKey(PUBLIC_KEY_PEM);

    if (!verify(null, payloadBuf, publicKey, signature)) {
      return { valid: false, reason: "bad_signature" };
    }

    const data = JSON.parse(payloadBuf.toString("utf8"));
    if (data.expiresAt && Date.now() > new Date(data.expiresAt).getTime()) {
      return { valid: false, reason: "expired", data };
    }
    return { valid: true, data };
  } catch (err) {
    return { valid: false, reason: "error", error: String(err) };
  }
}

export function loadLicense() {
  const raw = process.env.MANOO_LICENSE_KEY
    || (existsSync(LICENSE_FILE) ? readFileSync(LICENSE_FILE, "utf8") : null);
  if (!raw) return { valid: false, reason: "no_license" };
  return verifyLicenseString(raw);
}
