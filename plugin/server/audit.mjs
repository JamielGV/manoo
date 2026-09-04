// Pro-tier audit log: one JSON line per action, for teams/agencies that
// need a record of what Claude actually did on screen. Local file only —
// nothing is sent anywhere.
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const AUDIT_LOG_FILE = join(homedir(), ".local", "share", "manoo", "audit.log");

export async function logAction(entry) {
  await mkdir(dirname(AUDIT_LOG_FILE), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(AUDIT_LOG_FILE, line, "utf8");
}
