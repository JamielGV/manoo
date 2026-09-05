// Splits the screen between the IDE (so the user keeps seeing Claude Code
// while Manoo acts) and whatever other window Manoo is driving. Uses wmctrl,
// an EWMH tool present on virtually every X11 desktop (XFCE, GNOME, MATE,
// Cinnamon...) — no extra install needed on top of what Linux already ships.
//
// The IDE window is found by walking this process's own parent chain
// (server -> claude -> the editor) and matching a PID against wmctrl's
// window list, rather than matching on window title — titles change with
// the open file/tab, but the process ancestry doesn't.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

// Remembered across calls so repeated splits don't get confused by some
// unrelated window that happened to appear (observed live: a file manager
// the user opened on their own got mistaken for "the app Manoo is
// driving" and was tiled in instead of the real target). Once we've
// identified the target, we stick with it as long as it still exists.
let lastTargetWindowId = null;

// Captured once, the first time the layout is actually touched, so it can
// be put back when Manoo stops operating. Not "the maximized state" (wmctrl
// doesn't expose that cheaply) — just the geometry, which visually restores
// the common case well enough.
let originalIdeGeom = null;
let originalTarget = null; // { id, x, y, w, h }

async function wmctrl(args) {
  const { stdout } = await execFileAsync("wmctrl", args);
  return stdout;
}

async function listWindows() {
  const out = await wmctrl(["-lpG"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.match(
        /^(\S+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/
      );
      if (!m) return null;
      const [, id, desktop, pid, x, y, w, h, host, title] = m;
      return {
        id,
        desktop: Number(desktop),
        pid: Number(pid),
        x: Number(x),
        y: Number(y),
        w: Number(w),
        h: Number(h),
        title,
      };
    })
    .filter(Boolean);
}

/** Walk /proc to find this process's ancestor PIDs, closest first. */
async function ancestorPids(startPid) {
  const pids = [];
  let pid = startPid;
  for (let i = 0; i < 20 && pid > 1; i++) {
    pids.push(pid);
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      pid = Number(afterComm[1]); // ppid is the field right after comm
    } catch {
      break;
    }
  }
  return pids;
}

async function findIdeWindow(windows) {
  const ancestors = await ancestorPids(process.pid);
  for (const pid of ancestors) {
    const win = windows.find((w) => w.pid === pid && w.desktop >= 0);
    if (win) return win;
  }
  return null;
}

/** Identifies "the other app Manoo is driving". Once picked, keeps
 * pointing at that same window (by id) across calls rather than
 * re-guessing "the last other window" every time — otherwise some
 * unrelated window the user opens in parallel (a file manager, another
 * browser tab) can get mistaken for the target mid-task. Falls back to
 * the last-mapped-window guess only when the previous target is gone. */
function findTargetWindow(windows, ideWindow) {
  const candidates = windows.filter(
    (w) => w.desktop >= 0 && (!ideWindow || w.id !== ideWindow.id)
  );
  if (lastTargetWindowId) {
    const stillThere = candidates.find((w) => w.id === lastTargetWindowId);
    if (stillThere) return stillThere;
  }
  const guess = candidates[candidates.length - 1] || null;
  lastTargetWindowId = guess ? guess.id : null;
  return guess;
}

async function getWorkArea() {
  const out = await wmctrl(["-d"]);
  const lines = out.split("\n").filter(Boolean);
  const activeLine = lines.find((l) => l.includes("*")) || lines[0];
  const m = activeLine.match(/WA:\s*(-?\d+),(-?\d+)\s+(\d+)x(\d+)/);
  if (!m) throw new Error(`Could not parse work area from: ${activeLine}`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

async function placeWindow(id, { x, y, w, h }) {
  // Unmaximize first — a maximized window ignores -e geometry requests.
  await wmctrl(["-i", "-r", id, "-b", "remove,maximized_vert,maximized_horz"]);
  // A window that was genuinely maximized (real WM state, e.g. by
  // maximizeIdeWindow() on a previous idle) doesn't always accept the
  // very next geometry request immediately — the un-maximize above needs
  // a moment to actually take effect first, or the resize is silently
  // ignored (confirmed live: the un-maximize + resize landed fine for a
  // window that had never been maximized, but did nothing for one that
  // had). Verify and retry rather than assuming one attempt is enough.
  for (let attempt = 0; attempt < 4; attempt++) {
    await wmctrl(["-i", "-r", id, "-e", `0,${x},${y},${w},${h}`]);
    const windows = await listWindows();
    const placed = windows.find((w2) => w2.id === id);
    if (placed && placed.x === x && placed.y === y && placed.w === w && placed.h === h) {
      return;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Tile the IDE window and the most-recent other window into left/right
 * halves of the work area. Safe to call repeatedly (e.g. after opening a
 * new target app window) — always re-computes from current window state. */
export async function splitScreenWithIde({ ideSide = "left" } = {}) {
  const windows = await listWindows();
  const ideWindow = await findIdeWindow(windows);
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

  const wa = await getWorkArea();
  const halfW = Math.floor(wa.w / 2);
  const leftHalf = { x: wa.x, y: wa.y, w: halfW, h: wa.h };
  const rightHalf = { x: wa.x + halfW, y: wa.y, w: wa.w - halfW, h: wa.h };
  const ideGeom = ideSide === "left" ? leftHalf : rightHalf;
  const targetGeom = ideSide === "left" ? rightHalf : leftHalf;

  await placeWindow(ideWindow.id, ideGeom);

  if (targetWindow) {
    await placeWindow(targetWindow.id, targetGeom);
  }

  return {
    ok: true,
    ide: ideWindow.title,
    target: targetWindow ? targetWindow.title : null,
  };
}

/** Puts the IDE and target windows back where they were before Manoo's
 * first split — "the screen goes back to how it was" once Manoo stops
 * operating. Synchronous (execFileSync) so it can run from a process
 * "exit" handler, and safe to call even if activation never happened
 * (nothing was captured, so this is a no-op). */
export function restoreOriginalLayout() {
  const restore = (id, geom) => {
    try {
      execFileSync("wmctrl", ["-i", "-r", id, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
      execFileSync("wmctrl", ["-i", "-r", id, "-e", `0,${geom.x},${geom.y},${geom.w},${geom.h}`], { stdio: "ignore" });
    } catch {
      // best-effort — the window may already be gone
    }
  };

  if (originalIdeGeom) {
    restore(originalIdeGeom.id, originalIdeGeom);
  }
  if (originalTarget) {
    restore(originalTarget.id, originalTarget);
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
    // Explicit full-workarea geometry, not the WM's own "maximized" state
    // flag (`-b add,maximized_vert,maximized_horz`) — found live that once
    // this window had genuinely been put into that WM state, subsequent
    // external resize requests (the next split) stopped landing reliably,
    // even with unmaximize-then-retry. Filling the same coordinates
    // explicitly gets the same visual result without ever setting that
    // flag, which split screen's own placeWindow() already does
    // successfully every time.
    const wa = await getWorkArea();
    await placeWindow(originalIdeGeom.id, { x: wa.x, y: wa.y, w: wa.w, h: wa.h });
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
    await wmctrl(["-i", "-a", originalIdeGeom.id]);
  } catch {
    // best-effort — the window may be gone
  }
}
