// Physically locks out the user's real mouse/touchpad for the brief
// window of a single Manoo action, via `xinput disable`/`enable` on the
// physical pointer devices — NOT the "Virtual core XTEST pointer" device,
// which is what nut-js itself uses to inject Manoo's own clicks, so it
// must stay enabled or Manoo couldn't act either.
//
// Scope is deliberately narrow: only the duration of one action (a click,
// a drag, a scroll — typically well under a second). This is NOT the same
// thing as the human-takeover check in input-monitor.mjs, which lets the
// user stop an in-progress *task* by touching an input device between
// actions — that stays exactly as it was. This just stops a stray
// touchpad brush from landing a click meant for Manoo's own action onto
// whatever window happens to have focus for that one instant.
//
// Safety net: if the process dies mid-lock (crash, kill -9), a device
// left disabled would strand the user's mouse until something re-enables
// it. A short watchdog timer force-enables regardless, and exit/signal
// handlers do the same synchronously.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WATCHDOG_MS = 4000;

let physicalPointerIds = null;
let watchdogTimer = null;

async function detectPhysicalPointerIds() {
  const { stdout } = await execFileAsync("xinput", ["list"]);
  const ids = [];
  for (const line of stdout.split("\n")) {
    if (!/slave\s+pointer/i.test(line)) continue;
    if (/XTEST/i.test(line)) continue; // never touch Manoo's own injection device
    const m = line.match(/id=(\d+)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

async function getPhysicalPointerIds() {
  if (physicalPointerIds === null) {
    physicalPointerIds = await detectPhysicalPointerIds().catch(() => []);
  }
  return physicalPointerIds;
}

async function setEnabled(ids, enabled) {
  await Promise.all(
    ids.map((id) =>
      execFileAsync("xinput", [enabled ? "enable" : "disable", id]).catch(() => {})
    )
  );
}

function forceReenableSync() {
  const ids = physicalPointerIds;
  if (!ids || ids.length === 0) return;
  for (const id of ids) {
    try {
      execFileSync("xinput", ["enable", id], { stdio: "ignore" });
    } catch {
      // best-effort — nothing more we can do synchronously at exit
    }
  }
}

/** Immediately re-enables the mouse regardless of whether a lock is
 * currently in effect — the Escape hard-stop calls this the instant a
 * real (non-Manoo) Escape is detected, rather than waiting for the
 * current action's `finally` to run. */
export function emergencyUnlock() {
  clearTimeout(watchdogTimer);
  forceReenableSync();
}

process.on("exit", forceReenableSync);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    forceReenableSync();
    process.exit();
  });
}

/** Runs `fn` with the user's physical mouse/touchpad disabled for its
 * duration. Falls back to running `fn` unlocked if `xinput` isn't
 * available (no X11, headless, etc.) — never blocks the action itself. */
export async function withMouseLocked(fn) {
  const ids = await getPhysicalPointerIds();
  if (ids.length === 0) {
    return fn();
  }

  clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(forceReenableSync, WATCHDOG_MS);
  watchdogTimer.unref?.();

  await setEnabled(ids, false);
  try {
    return await fn();
  } finally {
    await setEnabled(ids, true);
    clearTimeout(watchdogTimer);
  }
}
