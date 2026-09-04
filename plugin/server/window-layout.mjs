// Splits the screen between the IDE (so the user keeps seeing Claude Code
// while Manoo acts) and whatever other window Manoo is driving. Uses wmctrl,
// an EWMH tool present on virtually every X11 desktop (XFCE, GNOME, MATE,
// Cinnamon...) — no extra install needed on top of what Linux already ships.
//
// The IDE window is found by walking this process's own parent chain
// (server -> claude -> the editor) and matching a PID against wmctrl's
// window list, rather than matching on window title — titles change with
// the open file/tab, but the process ancestry doesn't.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { OVERLAY_WINDOW_TITLE } from "./overlay-server.mjs";

const execFileAsync = promisify(execFile);

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

/** Best-effort guess at "the other app Manoo is driving": any top-level
 * window that isn't the IDE or Manoo's own HUD overlay, preferring the
 * most recently mapped one. */
function findTargetWindow(windows, ideWindow) {
  const candidates = windows.filter(
    (w) =>
      w.desktop >= 0 &&
      (!ideWindow || w.id !== ideWindow.id) &&
      !w.title.includes(OVERLAY_WINDOW_TITLE)
  );
  return candidates[candidates.length - 1] || null;
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
  await wmctrl(["-i", "-r", id, "-e", `0,${x},${y},${w},${h}`]);
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

  const wa = await getWorkArea();
  const halfW = Math.floor(wa.w / 2);
  const leftHalf = { x: wa.x, y: wa.y, w: halfW, h: wa.h };
  const rightHalf = { x: wa.x + halfW, y: wa.y, w: wa.w - halfW, h: wa.h };
  const ideGeom = ideSide === "left" ? leftHalf : rightHalf;
  const targetGeom = ideSide === "left" ? rightHalf : leftHalf;

  await placeWindow(ideWindow.id, ideGeom);

  const targetWindow = findTargetWindow(windows, ideWindow);
  if (targetWindow) {
    await placeWindow(targetWindow.id, targetGeom);
  }

  return {
    ok: true,
    ide: ideWindow.title,
    target: targetWindow ? targetWindow.title : null,
  };
}

/** Pins the HUD overlay window (matched by its fixed title) into the
 * bottom-right corner, always-on-top and out of the taskbar/pager. The
 * overlay window is opened by index.mjs right before this is called, but
 * it may take a moment to map — retries a few times. */
export async function placeOverlayWindow({
  width = 240,
  height = 190,
  attempts = 10,
  delayMs = 300,
} = {}) {
  for (let i = 0; i < attempts; i++) {
    const windows = await listWindows();
    const matches = windows.filter((w) => w.title.includes(OVERLAY_WINDOW_TITLE));
    const overlay = matches[matches.length - 1]; // most recently opened, if several
    if (overlay) {
      const wa = await getWorkArea();
      const geom = {
        x: wa.x + wa.w - width,
        y: wa.y + wa.h - height,
        w: width,
        h: height,
      };
      await wmctrl(["-i", "-r", overlay.id, "-b", "remove,maximized_vert,maximized_horz"]);
      await wmctrl(["-i", "-r", overlay.id, "-e", `0,${geom.x},${geom.y},${geom.w},${geom.h}`]);

      // Firefox enforces its own minimum chrome width/height, silently
      // overriding a request smaller than that — re-anchor to the corner
      // using whatever size actually stuck, instead of assuming it fit.
      const [placed] = (await listWindows()).filter((w) => w.id === overlay.id);
      if (placed && (placed.w !== geom.w || placed.h !== geom.h)) {
        const fixed = {
          x: wa.x + wa.w - placed.w,
          y: wa.y + wa.h - placed.h,
          w: placed.w,
          h: placed.h,
        };
        await wmctrl(["-i", "-r", overlay.id, "-e", `0,${fixed.x},${fixed.y},${fixed.w},${fixed.h}`]);
      }

      await wmctrl(["-i", "-r", overlay.id, "-b", "add,above,skip_taskbar,skip_pager"]);
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, reason: "overlay-window-not-found" };
}
