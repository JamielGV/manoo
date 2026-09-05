// Swaps the real system cursor for a neon-glow version while Manoo is
// active — a "neon shadow of the cursor" rather than a separate window
// with a proxy dot (an earlier version did that; a real user reported it
// wasn't what "neon cursor" should mean, and they're right — a detached
// mini-map dot isn't a glow on the actual pointer).
//
// XFCE-specific (xfconf-query) — same scope as the rest of the window/HUD
// code, which already assumes this desktop. Best-effort: no xfconf-query,
// no theme directory writable, anything — Manoo still works, the real
// cursor just stays whatever it already was.
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, copyFile, symlink, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const THEME_NAME = "manoo-neon";
const THEME_DIR = join(homedir(), ".icons", THEME_NAME);
const ASSET_CURSOR = join(dirname(fileURLToPath(import.meta.url)), "assets", "left_ptr");
const XFCONF = ["-c", "xsettings", "-p", "/Gtk/CursorThemeName"];

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
  await writeFile(
    join(THEME_DIR, "index.theme"),
    // Inherits the rest of the shapes (I-beam, resize handles, etc.) from
    // whatever the user's real theme was, so only the default pointer
    // changes — captured as `originalThemeName` below.
    `[Icon Theme]\nName=Manoo Neon\nInherits=${originalThemeName || "Adwaita"}\n`,
    "utf8"
  );
  themeInstalled = true;
}

async function getCurrentThemeName() {
  const { stdout } = await execFileAsync("xfconf-query", XFCONF);
  return stdout.trim();
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
    await execFileAsync("xfconf-query", [...XFCONF, "-s", THEME_NAME, "--create"]);
  } catch {
    // Best-effort — see comment above.
  }
}

function restoreSync() {
  if (!originalThemeName) return;
  try {
    execFileSync("xfconf-query", [...XFCONF, "-s", originalThemeName], {
      stdio: "ignore",
    });
  } catch {
    // best-effort — nothing more to do synchronously at exit
  }
}

/** Puts the user's real cursor theme back — called when Manoo stops
 * operating, alongside the window-layout and mouse-lock restores. */
export function restoreCursorTheme() {
  restoreSync();
}

// Safe to self-register: Node runs every "exit" listener from every
// module regardless of who ends the process (see mouse-lock.mjs).
process.on("exit", restoreSync);
