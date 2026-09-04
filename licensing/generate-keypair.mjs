// Run once. Generates the Ed25519 keypair Corporación Jamiel uses to sign
// Manoo license keys. The PRIVATE key must never leave this machine (or
// wherever you choose to keep it) — anyone with it can mint valid licenses.
// The PUBLIC key is safe to embed in the shipped plugin: it can verify
// signatures but cannot create them.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";

const privPath = new URL("./private-key.pem", import.meta.url);
const pubPath = new URL("./public-key.pem", import.meta.url);

if (existsSync(privPath)) {
  console.error("private-key.pem already exists — refusing to overwrite. Delete it manually first if you really want a new keypair (this invalidates every license issued so far).");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));

console.log("Keypair generated.");
console.log("private-key.pem — keep secret, back it up somewhere safe, never commit it.");
console.log("public-key.pem  — paste this into plugin/server/license.mjs (PUBLIC_KEY_PEM).\n");
console.log(publicKey.export({ type: "spki", format: "pem" }).toString());
