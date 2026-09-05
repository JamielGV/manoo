// Swaps the real system cursor for a neon-glow version while Manoo is
// actively processing — a "neon shadow of the cursor" rather than a
// separate window with a proxy dot (an earlier version did that; a real
// user reported it wasn't what "neon cursor" should mean, and they were
// right — a detached mini-map dot isn't a glow on the actual pointer).
//
// Talks to the X server directly (`xsetroot`, over the same DISPLAY
// connection nut-js already uses for mouse/keyboard/screenshots) rather
// than going through xfconf/D-Bus. Found live: an xfconf-query -s from
// inside this MCP server reported success and even read back correctly
// from a second xfconf-query call in the same process, but was
// completely invisible to every other process on the machine (matching
// device/inode for the D-Bus socket, matching uid — so not an obvious
// namespace mismatch, just consistently ineffective) — Antigravity (the
// IDE this was built and tested in) apparently isolates D-Bus for its
// extension host in some way that doesn't affect the plain X11 DISPLAY
// socket. Since mouse/keyboard/screenshots all work fine over that same
// DISPLAY connection, changing the cursor the same way sidesteps
// whatever that isolation is instead of fighting it.
//
// Best-effort throughout: no `xsetroot`, no X11, anything — Manoo still
// works, the real cursor just stays whatever it already was.
import { execFile, execFileSync } from "node:child_process";
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
  await copyFile(ASSET_CURSOR, join(cursorsDir, "left_ptr"));
  themeInstalled = true;
}

/** Best-effort read of the cursor theme currently in effect, straight
 * from the X resource database (no xfconf/D-Bus involved) — used only to
 * know what to switch back to. Falls back to a sane default if the
 * resource isn't set (also normal — not every system defines it). */
async function getCurrentThemeName() {
  try {
    const { stdout } = await execFileAsync("xrdb", ["-query"]);
    const m = stdout.match(/^Xcursor\.theme:\s*(\S+)$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function setRootCursor(themeName) {
  return execFileAsync("xsetroot", ["-cursor_name", "left_ptr"], {
    env: { ...process.env, XCURSOR_THEME: themeName },
  });
}

/** Switches the real cursor to the neon-glow version. No-op (never
 * throws) if there's no X11/xsetroot or anything else goes wrong — this
 * is a nice-to-have, never something an action should fail over. */
export async function applyNeonCursor() {
  try {
    if (originalThemeName === null) {
      originalThemeName = await getCurrentThemeName();
    }
    await installThemeIfNeeded();
    await setRootCursor(THEME_NAME);
  } catch {
    // Best-effort — see comment above.
  }
}

function restoreSync() {
  if (!themeInstalled) return; // neon cursor was never actually applied
  try {
    // If the original theme name couldn't be detected, still ask for a
    // plain left_ptr without our override — falls back to whatever the
    // environment/Xresources already resolve to, rather than leaving the
    // neon one stuck on because we didn't know what to name.
    const env = originalThemeName
      ? { ...process.env, XCURSOR_THEME: originalThemeName }
      : process.env;
    execFileSync("xsetroot", ["-cursor_name", "left_ptr"], { env, stdio: "ignore" });
  } catch {
    // best-effort — nothing more to do synchronously at exit
  }
}

/** Puts the user's real cursor back — called when Manoo goes idle
 * between tasks and again when it stops operating entirely, alongside
 * the window-layout and mouse-lock restores. */
export function restoreCursorTheme() {
  restoreSync();
}

// Safe to self-register: Node runs every "exit" listener from every
// module regardless of who ends the process (see mouse-lock.mjs).
process.on("exit", restoreSync);
