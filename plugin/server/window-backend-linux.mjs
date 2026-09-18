// Linux/X11 window-management primitives, via wmctrl (an EWMH tool
// present on virtually every X11 desktop — XFCE, GNOME, MATE, Cinnamon —
// no extra install needed on top of what Linux already ships). Extracted
// from window-layout.mjs so that module can stay platform-agnostic and
// dispatch to this file (or window-backend-macos.mjs) by process.platform.
//
// See window-layout.mjs for the shared higher-level logic (sticky target
// tracking, restore-on-exit, split geometry) that calls these primitives -
// none of the reasoning in this file's history has changed, only its
// location.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

async function wmctrl(args) {
  const { stdout } = await execFileAsync("wmctrl", args);
  return stdout;
}

export async function listWindows() {
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
    .filter(Boolean)
    .filter((w) => w.desktop >= 0);
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

export async function findIdeWindow(windows) {
  const ancestors = await ancestorPids(process.pid);
  for (const pid of ancestors) {
    const win = windows.find((w) => w.pid === pid);
    if (win) return win;
  }
  return null;
}

export async function getWorkArea() {
  const out = await wmctrl(["-d"]);
  const lines = out.split("\n").filter(Boolean);
  const activeLine = lines.find((l) => l.includes("*")) || lines[0];
  const m = activeLine.match(/WA:\s*(-?\d+),(-?\d+)\s+(\d+)x(\d+)/);
  if (!m) throw new Error(`Could not parse work area from: ${activeLine}`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}

export async function placeWindow(id, { x, y, w, h }) {
  // Unmaximize first — a maximized window ignores -e geometry requests.
  await wmctrl(["-i", "-r", id, "-b", "remove,maximized_vert,maximized_horz"]);
  // Un-minimize via activate (-a), not `-b remove,hidden` — confirmed live
  // that removing the _NET_WM_STATE_HIDDEN property alone (whether chained
  // onto the maximized-state removal above or issued as its own separate
  // call) clears the property but doesn't actually de-iconify the window:
  // a subsequent -e geometry request silently did nothing, and the window
  // stayed invisible. `-a` (the same EWMH activate wmctrl uses for
  // activateWindow()) both de-iconifies AND raises/focuses it, and *that*
  // is what actually made a minimized window visible and resizable again.
  // A window minimized by minimizeWindow() needs this before a geometry
  // request will do anything.
  await wmctrl(["-i", "-a", id]);
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

export function placeWindowSync(id, geom) {
  try {
    execFileSync("wmctrl", ["-i", "-r", id, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
    execFileSync("wmctrl", ["-i", "-a", id], { stdio: "ignore" });
    execFileSync("wmctrl", ["-i", "-r", id, "-e", `0,${geom.x},${geom.y},${geom.w},${geom.h}`], { stdio: "ignore" });
  } catch {
    // best-effort — the window may already be gone
  }
}

export async function activateWindow(id) {
  await wmctrl(["-i", "-a", id]);
}

export async function minimizeWindow(id) {
  await wmctrl(["-i", "-r", id, "-b", "add,hidden"]);
}
