// Global human-input monitor: catches ANY mouse or keyboard activity on
// this machine, from any device, using uiohook-napi (a native OS-level
// hook — not limited to whichever device did it). Manoo's own synthetic
// actions (via nut-js) also fire these same hooks, since XTest-injected
// input is indistinguishable from real input at this level — so every
// Manoo action must wrap itself in beginManooAction()/endManooAction() to
// suppress its own echo. Anything detected outside that window is a human.
import { uIOhook } from "uiohook-napi";

let suppressUntil = 0;
let interference = null;

// An interference event older than this by the time something checks for
// it is presumed unrelated to "the human is acting right now" — e.g. the
// keystroke that sent a chat message to Claude a couple seconds ago,
// which is real input but not someone reaching for the mouse/keyboard to
// override an in-progress action. Only recent-enough activity blocks.
const STALE_MS = 2000;

function isSuppressed() {
  return Date.now() < suppressUntil;
}

function mark(type, detail) {
  if (!isSuppressed() && !interference) {
    interference = { type, detail, atMs: Date.now(), at: new Date().toISOString() };
  }
}

uIOhook.on("keydown", (e) => mark("keyboard", `keycode ${e.keycode}`));
uIOhook.on("mousedown", (e) => mark("mouse-click", `button ${e.button} at (${e.x}, ${e.y})`));
uIOhook.on("mousemove", (e) => mark("mouse-move", `(${e.x}, ${e.y})`));
uIOhook.on("wheel", (e) => mark("mouse-wheel", `rotation ${e.rotation}`));

uIOhook.start();

/** Call right before Manoo performs a synthetic action. `ms` should cover
 * how long the action is expected to take (typing a long string takes
 * longer than a single click). */
export function beginManooAction(ms = 500) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

/** Returns and clears any interference detected outside a suppression
 * window — i.e. real human input — or null if none. Interference older
 * than STALE_MS is discarded rather than returned: it's real input, just
 * not recent enough to mean "the human is overriding this action now." */
export function consumeHumanInterference() {
  const found = interference;
  interference = null;
  if (found && Date.now() - found.atMs > STALE_MS) {
    return null;
  }
  return found;
}

export function stopInputMonitor() {
  uIOhook.stop();
}
