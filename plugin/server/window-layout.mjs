// Splits the screen between the IDE (so the user keeps seeing Claude Code
// while Manoo acts) and whatever other window Manoo is driving. Platform-
// agnostic: the reasoning below (sticky target tracking, restore-on-exit,
// split geometry, tolerance-based layout-changed detection) is the same
// on every OS - only the low-level "list/place/activate/minimize a
// window" primitives differ, and those live in window-backend-linux.mjs /
// window-backend-macos.mjs, picked by process.platform below.
//
// The IDE window is found by walking this process's own parent chain
// (server -> claude -> the editor) and matching a PID against the
// backend's window list, rather than matching on window title — titles
// change with the open file/tab, but the process ancestry doesn't.
import * as linuxBackend from "./window-backend-linux.mjs";
import * as macosBackend from "./window-backend-macos.mjs";

const UNSUPPORTED_BACKEND = {
  async listWindows() {
    return [];
  },
  async findIdeWindow() {
    return null;
  },
  async getWorkArea() {
    throw new Error("window management not supported on this platform yet");
  },
  async placeWindow() {},
  placeWindowSync() {},
  async activateWindow() {},
  async minimizeWindow() {},
};

// Windows support is tracked as a known gap (see README) rather than
// guessed at here - PowerShell/Win32 automation needs its own backend
// written and tested against a real machine, same as macOS's.
const backend =
  process.platform === "darwin" ? macosBackend :
  process.platform === "linux" ? linuxBackend :
  UNSUPPORTED_BACKEND;

// Remembered across calls so repeated splits don't get confused by some
// unrelated window that happened to appear (observed live: a file manager
// the user opened on their own got mistaken for "the app Manoo is
// driving" and was tiled in instead of the real target). Once we've
// identified the target, we stick with it as long as it still exists.
let lastTargetWindowId = null;

// Captured once, the first time the layout is actually touched, so it can
// be put back when Manoo stops operating. Not "the maximized state" (the
// backends don't expose that cheaply) — just the geometry, which visually
// restores the common case well enough.
let originalIdeGeom = null;
let originalTarget = null; // { id, x, y, w, h }

/** Identifies "the other app Manoo is driving". Once picked, keeps
 * pointing at that same window (by id) across calls rather than
 * re-guessing "the last other window" every time — otherwise some
 * unrelated window the user opens in parallel (a file manager, another
 * browser tab) can get mistaken for the target mid-task. Falls back to
 * the last-mapped-window guess only when the previous target is gone. */
function findTargetWindow(windows, ideWindow) {
  const candidates = windows.filter((w) => !ideWindow || w.id !== ideWindow.id);
  if (lastTargetWindowId) {
    const stillThere = candidates.find((w) => w.id === lastTargetWindowId);
    if (stillThere) return stillThere;
  }
  const guess = candidates[candidates.length - 1] || null;
  lastTargetWindowId = guess ? guess.id : null;
  return guess;
}

/** Tile the IDE window and the most-recent other window into left/right
 * halves of the work area. Safe to call repeatedly (e.g. after opening a
 * new target app window) — always re-computes from current window state. */
export async function splitScreenWithIde({ ideSide = "left" } = {}) {
  const windows = await backend.listWindows();
  const ideWindow = await backend.findIdeWindow(windows);
  if (!ideWindow) {
    return { ok: false, reason: "ide-window-not-found" };
  }

  const targetWindow = findTargetWindow(windows, ideWindow);

  // Capture "how it was" the very first time, before moving anything —
  // restoreOriginalLayout() puts this back once Manoo stops operating.
  if (originalIdeGeom === null) {
    originalIdeGeom = { id: ideWindow.id, x: ideWindow.x, y: ideWindow.y, w: ideWindow.w, h: ideWindow.h };
  }
  if (originalTarget === null && targetWindow) {
    originalTarget = { id: targetWindow.id, x: targetWindow.x, y: targetWindow.y, w: targetWindow.w, h: targetWindow.h };
  }

  const wa = await backend.getWorkArea();
  const halfW = Math.floor(wa.w / 2);
  const leftHalf = { x: wa.x, y: wa.y, w: halfW, h: wa.h };
  const rightHalf = { x: wa.x + halfW, y: wa.y, w: wa.w - halfW, h: wa.h };
  const ideGeom = ideSide === "left" ? leftHalf : rightHalf;
  const targetGeom = ideSide === "left" ? rightHalf : leftHalf;

  // Whether either window actually needs to move — i.e. the layout wasn't
  // already in this split shape. Reported back so a coordinate-based action
  // in the same gated() call (see index.mjs) can tell whether the (x, y) it
  // was given, computed from a screenshot taken before this call, still
  // points at the same window. Found live: going from idle (target window
  // full-screen) straight into an action moved the target window out from
  // under a click aimed at it by a stale, pre-split screenshot, and the
  // click (and the `type` that followed it) landed on the IDE instead.
  // Tolerance, not exact equality: confirmed live that a window can settle
  // a few (or several dozen) pixels off the exact geometry requested — GTK
  // client-side decorations/shadow margins mean what a placement request
  // asks for and what a subsequent read-back reports aren't always the
  // same reference frame, and this offset is stable, not something
  // placeWindow's own retry loop can converge away. Exact-match here would
  // report layoutChanged on EVERY call for such a window, permanently
  // aborting every action after the first split. 100px comfortably covers
  // that kind of decoration offset while still catching a real change
  // (going from full-screen to half-screen is a 720px+ jump).
  const GEOM_TOLERANCE = 100;
  const geomClose = (w, g) =>
    Math.abs(w.x - g.x) <= GEOM_TOLERANCE &&
    Math.abs(w.y - g.y) <= GEOM_TOLERANCE &&
    Math.abs(w.w - g.w) <= GEOM_TOLERANCE &&
    Math.abs(w.h - g.h) <= GEOM_TOLERANCE;
  const layoutChanged =
    !geomClose(ideWindow, ideGeom) || (targetWindow ? !geomClose(targetWindow, targetGeom) : false);

  await backend.placeWindow(ideWindow.id, ideGeom);

  if (targetWindow) {
    await backend.placeWindow(targetWindow.id, targetGeom);
  }

  return {
    ok: true,
    ide: ideWindow.title,
    target: targetWindow ? targetWindow.title : null,
    layoutChanged,
  };
}

/** Puts the IDE and target windows back where they were before Manoo's
 * first split — "the screen goes back to how it was" once Manoo stops
 * operating. Synchronous so it can run from a process "exit" handler, and
 * safe to call even if activation never happened (nothing was captured,
 * so this is a no-op). */
export function restoreOriginalLayout() {
  if (originalIdeGeom) {
    backend.placeWindowSync(originalIdeGeom.id, originalIdeGeom);
  }
  if (originalTarget) {
    backend.placeWindowSync(originalTarget.id, originalTarget);
  }
}

// Safe to self-register: Node calls every "exit" listener from every
// module regardless of who's responsible for the process ending, unlike
// SIGINT/SIGTERM (see the comment in mouse-lock.mjs).
process.on("exit", restoreOriginalLayout);

/** Gives the IDE window back the full screen once Manoo goes idle between
 * tasks — the split is only useful while it's actually about to act.
 * Reuses the id captured on first split rather than re-discovering the
 * IDE window, so this is cheap enough to call from an idle timer. No-op
 * if the layout was never touched yet. */
export async function maximizeIdeWindow() {
  if (!originalIdeGeom) return;
  try {
    // Explicit full-workarea geometry, not a WM/window-manager "maximized"
    // state flag — found live (Linux/wmctrl) that once a window had
    // genuinely been put into that state, subsequent external resize
    // requests (the next split) stopped landing reliably, even with
    // unmaximize-then-retry. Filling the same coordinates explicitly gets
    // the same visual result without ever setting that flag.
    const wa = await backend.getWorkArea();
    await backend.placeWindow(originalIdeGeom.id, { x: wa.x, y: wa.y, w: wa.w, h: wa.h });
  } catch {
    // best-effort — the window may be gone
  }
}

/** Minimizes the window Manoo was driving once it goes idle — the user
 * asked for this explicitly: leaving it sitting open (even if covered by
 * the now-maximized IDE) means it's still one alt-tab away and clutters
 * the taskbar; closing it would be destructive and lose whatever state it
 * had. Minimizing is reversible and gets it out of the way. Uses
 * `lastTargetWindowId` (the sticky target-window tracking splitScreenWithIde
 * already keeps) rather than re-discovering it, so this is cheap enough to
 * call from the idle timer. No-op if no target has been identified yet. */
export async function minimizeTargetWindow() {
  if (!lastTargetWindowId) return;
  try {
    await backend.minimizeWindow(lastTargetWindowId);
  } catch {
    // best-effort — the window may be gone
  }
}

/** Brings the IDE window to the front and gives it input focus — used
 * when going idle so a follow-up "scroll to the latest message" gesture
 * actually lands on the IDE rather than whatever had focus before. */
export async function focusIdeWindow() {
  if (!originalIdeGeom) return;
  try {
    await backend.activateWindow(originalIdeGeom.id);
  } catch {
    // best-effort — the window may be gone
  }
}

/** Lists every open window (id, title, pid) — not just the IDE/target
 * pair splitScreenWithIde() tracks. Found live: with more than one
 * non-IDE window open (a browser AND a terminal), the sticky single-
 * target tracking used for the split can only ever point at one of
 * them, so a terminal could never be reliably brought forward on its
 * own — this (with focusWindowById()) lets Claude pick a specific
 * window by id instead of being limited to "the split's other window". */
export async function listAllWindows() {
  const windows = await backend.listWindows();
  return windows.map((w) => ({ id: w.id, title: w.title, pid: w.pid }));
}

/** Focuses an arbitrary window by id (from listAllWindows()), regardless
 * of whether it's the IDE or the split's current target — e.g. a
 * terminal that isn't part of the split at all. Does not touch the
 * split/layout state, just raises and focuses the requested window. */
export async function focusWindowById(id) {
  await backend.activateWindow(id);
}
