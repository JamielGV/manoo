// Global human-input monitor: catches ANY mouse or keyboard activity on
// this machine, from any device, using uiohook-napi (a native OS-level
// hook — not limited to whichever device did it). Manoo's own synthetic
// actions (via nut-js) also fire these same hooks, since XTest-injected
// input is indistinguishable from real input at this level — so every
// Manoo action must wrap itself in beginManooAction()/endManooAction() to
// suppress its own echo. Anything detected outside that window is a human.
import { uIOhook, UiohookKey } from "uiohook-napi";

let suppressUntil = 0;
let interference = null;

// Escape gets its own, much narrower suppression window than the general
// one: a `type` action's window can last several seconds (long strings),
// during which a real Escape press must still get through immediately —
// only Manoo's OWN synthetic Escape (sent via the `key` tool) should be
// ignored, and that's a single near-instant keypress, not a multi-second
// window.
let escapeSuppressUntil = 0;
let emergencyStopHandler = null;

/** Registers a callback fired the instant a real (non-Manoo) Escape is
 * pressed — used to force-unlock the mouse immediately rather than
 * waiting for the next action's interference check. */
export function onEmergencyStop(fn) {
  emergencyStopHandler = fn;
}

export function beginEscapeAction(ms = 500) {
  escapeSuppressUntil = Math.max(escapeSuppressUntil, Date.now() + ms);
}

// An interference event older than this by the time something checks for
// it is presumed unrelated to "the human is acting right now" — e.g. the
// keystroke that sent a chat message to Claude a couple seconds ago,
// which is real input but not someone reaching for the mouse/keyboard to
// override an in-progress action. Only recent-enough activity blocks.
const STALE_MS = 2000;

// Escape gets a longer staleness allowance than other interference (real
// incident: Manoo's own Escape — sent via the `key` tool — arrived at
// this hook slightly after its self-suppression window closed, and
// because `type/click/scroll` tools are the only ones that ever call
// consumeHumanInterference(), it sat unread through several unrelated
// Bash/Read/Edit calls before finally surfacing at the next real action —
// reported as if the user had *just* pressed Escape, seconds or tool-calls
// later. Escape genuinely shouldn't be treated as ambient noise the way a
// stray mousemove is, but "never discard it" was too strong; this bounds
// it to "recent enough to plausibly be the same moment" without being an
// indefinitely-armed tripwire from Manoo's own past action.
const ESCAPE_STALE_MS = 8000;

function isSuppressed() {
  return Date.now() < suppressUntil;
}

function mark(type, detail) {
  if (!isSuppressed() && !interference) {
    interference = { type, detail, atMs: Date.now(), at: new Date().toISOString() };
  }
}

uIOhook.on("keydown", (e) => {
  if (e.keycode === UiohookKey.Escape) {
    if (Date.now() < escapeSuppressUntil) return; // Manoo's own Escape
    interference = { type: "escape", detail: "el usuario presionó Escape", atMs: Date.now(), at: new Date().toISOString() };
    emergencyStopHandler?.();
    return;
  }
  mark("keyboard", `keycode ${e.keycode}`);
});
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
  if (!found) return null;
  const age = Date.now() - found.atMs;
  const staleAfter = found.type === "escape" ? ESCAPE_STALE_MS : STALE_MS;
  if (age > staleAfter) {
    return null;
  }
  return found;
}

export function stopInputMonitor() {
  uIOhook.stop();
}
