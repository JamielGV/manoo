// Swaps the real system cursor for a neon-glow version while Manoo is
// actively processing — a "neon shadow of the cursor" rather than a
// separate window with a proxy dot (an earlier version did that; a real
// user reported it wasn't what "neon cursor" should mean, and they were
// right — a detached mini-map dot isn't a glow on the actual pointer).
//
// Sets the cursor theme through TWO independent channels, since real
// testing showed different apps only listen to one or the other:
//   - `xrdb -merge -` writes Xcursor.theme straight into the X server's
//     RESOURCE_MANAGER property (pure X11, no D-Bus), then `xsetroot
//     -cursor_name left_ptr` nudges the root cursor so it's picked up
//     immediately. This is what Firefox (and the bare desktop) respect.
//   - `xfconf-query -c xsettings -p /Gtk/CursorThemeName -s ...` writes
//     XFCE's D-Bus-backed settings store, which GTK apps (confirmed live:
//     Antigravity, the Electron/GTK-based IDE this plugin is meant to run
//     inside) read for their cursor theme, at least at their own startup.
//     A real user reported the neon cursor stuck on permanently while
//     using the IDE, well after Manoo had gone idle — traced to exactly
//     this: an earlier version of this file used ONLY xfconf-query, wrote
//     "manoo-neon" into that store, and got swapped out for the xrdb-only
//     approach afterward WITHOUT ever writing the original theme name
//     back — so that xfconf value sat stuck on "manoo-neon" indefinitely,
//     invisible to every check this file was doing (all against Xcursor
//     via `xrdb -query`, never against xfconf), and the IDE (already
//     running, or any GTK app that reads this key at startup) kept
//     reflecting it. Both channels are now written and restored together
//     so neither can be left stuck like that again.
//
// Note: an EARLIER attempt at using xfconf-query alone (not in
// combination with xrdb) found that a `-s` write issued from inside this
// MCP server's process specifically wasn't visible to other processes'
// reads, for reasons never fully identified (same D-Bus socket, same
// uid). That finding is about xfconf-query being unreliable *as the only
// mechanism* from this process — it's kept here anyway, alongside xrdb,
// because real GTK apps like Antigravity demonstrably do read it (per the
// stuck-cursor bug above), so it's worth setting even if this specific
// process's writes to it can't be trusted to always land; xrdb remains
// the mechanism verified to reliably work from here.
//
// Best-effort throughout: missing `xrdb`/`xsetroot`/`xfconf-query`, no
// X11, no XFCE — Manoo still works, the real cursor just stays whatever
// it already was.
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

const XFCONF_PROP = ["-c", "xsettings", "-p", "/Gtk/CursorThemeName"];

// Deliberately NOT reading xfconf's own current value to decide what
// "original" means — found live that it can be stuck on a stale
// "manoo-neon" from a past bug, and capturing THAT as "original" would
// just restore back to the stuck value forever. `originalThemeName`
// (captured once, from xrdb) is the single source of truth for what both
// channels get restored to.
async function setThemeViaXfconf(themeName) {
  try {
    await execFileAsync("xfconf-query", [...XFCONF_PROP, "-s", themeName]);
  } catch {
    // best-effort — see the file-level comment on why this is kept
    // alongside xrdb rather than as the only mechanism
  }
}

function setThemeViaXfconfSync(themeName) {
  try {
    execFileSync("xfconf-query", [...XFCONF_PROP, "-s", themeName], { stdio: "ignore" });
  } catch {
    // best-effort
  }
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
    await Promise.all([setThemeViaXrdb(THEME_NAME), setThemeViaXfconf(THEME_NAME)]);
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
  // Same value, same reasoning as applyNeonCursor() — both channels
  // always move together so neither can drift and get stuck again.
  setThemeViaXfconfSync(originalThemeName);
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
