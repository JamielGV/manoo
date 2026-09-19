// macOS window-management primitives, via System Events (Accessibility
// API) through JXA (JavaScript for Automation, `osascript -l JavaScript`)
// — no extra install needed on top of what macOS already ships. Requires
// the terminal/IDE process running this server to be granted Accessibility
// access (System Settings > Privacy & Security > Accessibility) - the same
// permission category nut-js's own synthetic mouse/keyboard input already
// needs there, so this doesn't add a new consent prompt class.
//
// Confirmed on real hardware 2026-09-18 — see the "Bug real detectado"
// comments below (listWindows' visible-processes filter, minimizeWindow's
// bracket-notation attribute set) for what testing live actually turned
// up, the same way the Linux backend's own comments describe bugs that
// were only found by testing live. placeWindow/activateWindow have not
// been separately called out with their own real-hardware bug reports —
// exercise them directly before assuming they're as solid as the two
// primitives above.
//
// Window ids here are synthesized as "pid:index" from a fresh listWindows()
// snapshot each time (macOS/Accessibility windows have no wmctrl-style
// stable numeric id exposed reliably across app versions) - placeWindow/
// activateWindow/minimizeWindow re-locate the window by (pid, title) in
// their own osascript call, same reliability class as wmctrl acting on an
// id looked up from a separate `wmctrl -l` call.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runJXA(script, args = []) {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script, "--", ...args]);
  return stdout.trim();
}

const LIST_WINDOWS_JXA = `
function run() {
  var se = Application("System Events");
  var out = [];
  // Bug real detectado 2026-09-18 (probado en hardware real): iterar
  // TODOS los procesos (se.processes()) incluye procesos de fondo sin UI
  // que no responden a eventos de Apple, y System Events truena con
  // "Timeout" (-1712) esperando su respuesta. Filtrar a procesos visibles
  // evita preguntarle a un proceso que nunca va a contestar.
  var procs = se.processes.whose({ visible: true })();
  for (var i = 0; i < procs.length; i++) {
    var p = procs[i];
    var wins;
    try { wins = p.windows(); } catch (e) { continue; }
    for (var j = 0; j < wins.length; j++) {
      var w = wins[j];
      try {
        var pos = w.position();
        var size = w.size();
        out.push({
          pid: p.unixId(),
          proc: p.name(),
          index: j,
          title: w.name() || "",
          x: pos[0], y: pos[1], w: size[0], h: size[1]
        });
      } catch (e) {}
    }
  }
  return JSON.stringify(out);
}
`;

export async function listWindows() {
  const out = await runJXA(LIST_WINDOWS_JXA);
  const raw = JSON.parse(out || "[]");
  return raw.map((w) => ({ ...w, id: `${w.pid}:${w.index}` }));
}

/** Walk the process tree via `ps` (no /proc on macOS) to find this
 * process's ancestor PIDs, closest first - same purpose as the Linux
 * backend's /proc walk, different mechanism. */
async function ancestorPids(startPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid,ppid"]);
  const ppidByPid = new Map();
  for (const line of stdout.split("\n").slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) ppidByPid.set(Number(m[1]), Number(m[2]));
  }
  const pids = [];
  let pid = startPid;
  for (let i = 0; i < 20 && pid > 1; i++) {
    pids.push(pid);
    const ppid = ppidByPid.get(pid);
    if (!ppid) break;
    pid = ppid;
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

/** visibleFrame excludes the menu bar and Dock (macOS's equivalent of
 * wmctrl's work area) but is reported in AppKit's bottom-up coordinate
 * space; System Events window position/size (used everywhere else here)
 * is top-down, so this converts before returning. */
const WORK_AREA_JXA = `
function run() {
  ObjC.import('AppKit');
  var screen = $.NSScreen.mainScreen;
  var full = screen.frame;
  var vis = screen.visibleFrame;
  var topDownY = full.size.height - vis.origin.y - vis.size.height;
  return JSON.stringify({ x: vis.origin.x, y: topDownY, w: vis.size.width, h: vis.size.height });
}
`;

export async function getWorkArea() {
  const out = await runJXA(WORK_AREA_JXA);
  return JSON.parse(out);
}

const PLACE_WINDOW_JXA = `
function run(argv) {
  var pid = Number(argv[0]), title = argv[1];
  var idx = Number(argv[2]);
  var x = Number(argv[3]), y = Number(argv[4]), w = Number(argv[5]), h = Number(argv[6]);
  var se = Application("System Events");
  var procs = se.processes.whose({ unixId: pid })();
  if (procs.length === 0) return "not-found";
  var proc = procs[0];
  var win = null;
  try { win = proc.windows[idx]; win.name(); } catch (e) { win = null; }
  if (!win) {
    var byTitle = proc.windows.whose({ name: title })();
    win = byTitle.length ? byTitle[0] : (proc.windows.length ? proc.windows[0] : null);
  }
  if (!win) return "not-found";
  try { proc.frontmost = true; } catch (e) {}
  win.position = [x, y];
  win.size = [w, h];
  return "ok";
}
`;

export async function placeWindow(id, { x, y, w, h }) {
  const [pid, index] = id.split(":");
  // Title isn't known here (only id is passed by window-layout.mjs) -
  // pass empty string, placeWindow falls back to window index / first
  // window of the process, same best-effort spirit as the rest of this
  // file.
  await runJXA(PLACE_WINDOW_JXA, [pid, "", index, String(x), String(y), String(w), String(h)]);
}

export function placeWindowSync(id, { x, y, w, h }) {
  const [pid, index] = id.split(":");
  try {
    execFileSync("osascript", [
      "-l", "JavaScript", "-e", PLACE_WINDOW_JXA, "--",
      pid, "", index, String(x), String(y), String(w), String(h),
    ], { stdio: "ignore" });
  } catch {
    // best-effort — the window may already be gone
  }
}

const ACTIVATE_WINDOW_JXA = `
function run(argv) {
  var pid = Number(argv[0]), idx = Number(argv[1]);
  var se = Application("System Events");
  var procs = se.processes.whose({ unixId: pid })();
  if (procs.length === 0) return "not-found";
  var proc = procs[0];
  try { proc.frontmost = true; } catch (e) {}
  try {
    var win = proc.windows[idx];
    win.actions.byName("AXRaise").perform();
  } catch (e) {}
  return "ok";
}
`;

export async function activateWindow(id) {
  const [pid, index] = id.split(":");
  await runJXA(ACTIVATE_WINDOW_JXA, [pid, index]);
}

const MINIMIZE_WINDOW_JXA = `
function run(argv) {
  var pid = Number(argv[0]), idx = Number(argv[1]);
  var se = Application("System Events");
  var procs = se.processes.whose({ unixId: pid })();
  if (procs.length === 0) return "not-found";
  var win = procs[0].windows[idx];
  try {
    // Bug real detectado 2026-09-18 (probado en hardware real): reading
    // an attribute's value in JXA needs .value() called as a function,
    // not accessed as a bare property - a bare ".value" (get OR set)
    // threw "Cannot convert types" every time, so this silently never
    // minimized anything (swallowed by this same try/catch). Confirmed
    // working: bracket-indexed .attributes["AXMinimized"] (byName(...)
    // was not re-verified for the SET path specifically, kept as
    // bracket notation since that's what was actually proven live).
    win.attributes["AXMinimized"].value = true;
  } catch (e) {}
  return "ok";
}
`;

export async function minimizeWindow(id) {
  const [pid, index] = id.split(":");
  await runJXA(MINIMIZE_WINDOW_JXA, [pid, index]);
}
