// Swaps the real system cursor for a neon-glow version while Manoo is
// actively processing — a "neon shadow of the cursor" rather than a
// separate window with a proxy dot (an earlier version did that; a real
// user reported it wasn't what "neon cursor" should mean, and they were
// right — a detached mini-map dot isn't a glow on the actual pointer).
//
// Writes Xcursor.theme straight into the X server's RESOURCE_MANAGER
// property via `xrdb -merge -` (a pure X11 DISPLAY connection, no D-Bus),
// then nudges the root cursor with `xsetroot -cursor_name left_ptr` so the
// change is picked up immediately. Confirmed live, run manually from an
// interactive shell, that this combination IS visible over an actual app
// window Manoo was driving, not just the bare desktop background. Two
// other mechanisms were tried first and ruled out from inside this MCP
// server's process specifically (not in general — each failure was
// process-scoped, never reproduced from a plain interactive shell):
//   - xfconf-query (XFCE's D-Bus-backed settings store): reported success
//     and even read back correctly from a second xfconf-query call in the
//     SAME process, but was invisible to every other process on the
//     machine — same D-Bus socket device/inode, same uid, so not an
//     obvious sandbox/namespace mismatch, root cause never identified.
//   - xsetroot alone (no xrdb): only ever sets the ROOT window's cursor —
//     doesn't propagate to already-open GTK app windows, which cache their
//     own cursor and only pick up a change via XSETTINGS (which xsetroot
//     never touches). Looked "reliable" in isolated testing but was
//     actually invisible everywhere that matters — confirmed live when a
//     user reported not seeing it even on the bare desktop.
//
// Best-effort throughout: no `xrdb`/`xsetroot`, no X11 — Manoo still
// works, the real cursor just stays whatever it already was.
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const THEME_NAME = "manoo-neon";
const THEME_DIR = join(homedir(), ".icons", THEME_NAME);
const ASSET_CURSOR = join(dirname(fileURLToPath(import.meta.url)), "assets", "left_ptr");

let originalThemeName = null;
let themeInstalled = false;

async function installThemeIfNeeded() {
  if (themeInstalled) return;
  const cursorsDir = join(THEME_DIR, "cursors");
  await mkdir(cursorsDir, { recursive: true });
  const dest = join(cursorsDir, "left_ptr");
  await copyFile(ASSET_CURSOR, dest);
  for (const alias of ["default", "arrow", "top_left_arrow"]) {
    const aliasPath = join(cursorsDir, alias);
    try {
      await unlink(aliasPath);
    } catch {
      // didn't exist yet — fine
    }
    await symlink("left_ptr", aliasPath);
  }
  await writeFileTheme();
  themeInstalled = true;
}

async function writeFileTheme() {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(THEME_DIR, "index.theme"),
    `[Icon Theme]\nName=Manoo Neon\nInherits=${originalThemeName || "Adwaita"}\n`,
    "utf8"
  );
}

async function getCurrentThemeName() {
  const { stdout } = await execFileAsync("xrdb", ["-query"]);
  const m = stdout.match(/^Xcursor\.theme:\s*(\S+)$/m);
  return m ? m[1] : null;
}

/** Writes Xcursor.theme straight into the X server's RESOURCE_MANAGER
 * property via `xrdb -merge` (pure X11 DISPLAY connection, no D-Bus) and
 * then nudges the root cursor with `xsetroot` so the change is picked up
 * immediately rather than waiting for something else to notice. Confirmed
 * live: doing exactly this from an interactive shell made the neon
 * cursor visible over the target app window Manoo was driving — xfconf-
 * query (D-Bus) and xsetroot with an XCURSOR_THEME env override (which
 * doesn't touch Xresources at all) were each tried first and didn't
 * visibly work from this MCP server's process specifically. */
function setThemeViaXrdb(themeName) {
  return new Promise((resolve) => {
    const merge = spawn("xrdb", ["-merge", "-"], { stdio: ["pipe", "ignore", "ignore"] });
    merge.stdin.write(`Xcursor.theme: ${themeName}\n`);
    merge.stdin.end();
    merge.on("exit", () => {
      execFileAsync("xsetroot", ["-cursor_name", "left_ptr"])
        .catch(() => {})
        .then(resolve);
    });
    merge.on("error", () => resolve());
  });
}

/** Switches the real cursor to the neon-glow version. No-op (never
 * throws) if this isn't an XFCE session or anything else goes wrong —
 * this is a nice-to-have, never something an action should fail over. */
export async function applyNeonCursor() {
  try {
    if (originalThemeName === null) {
      originalThemeName = (await getCurrentThemeName()) || "Adwaita";
    }
    await installThemeIfNeeded();
    await setThemeViaXrdb(THEME_NAME);
  } catch {
    // Best-effort — see comment above.
  }
}

function restoreSync() {
  if (!originalThemeName) return;
  try {
    execFileSync("xrdb", ["-merge", "-"], {
      input: `Xcursor.theme: ${originalThemeName}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
    execFileSync("xsetroot", ["-cursor_name", "left_ptr"], { stdio: "ignore" });
  } catch {
    // best-effort — nothing more to do synchronously at exit
  }
}

/** Puts the user's real cursor theme back — called when Manoo goes idle
 * between tasks and again when it stops operating entirely, alongside
 * the window-layout and mouse-lock restores. */
export function restoreCursorTheme() {
  restoreSync();
}

// Safe to self-register: Node runs every "exit" listener from every
// module regardless of who ends the process (see mouse-lock.mjs).
process.on("exit", restoreSync);
