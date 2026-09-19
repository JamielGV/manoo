// macOS neon-cursor overlay. macOS has no per-process, system-wide cursor
// swap the way X11's Xcursor theme gives cursor-theme.mjs on Linux —
// there's no public API to replace the shared arrow image; the only
// lever is `NSCursor.set()`, and every other app's view silently
// overrides that again the instant the mouse re-enters its own tracking
// area, so it can't hold a swap for longer than a frame.
//
// Instead of trying to replace the real cursor, this draws Manoo's own
// animated hand icon (the same 4 PNG frames used to build the Linux
// Xcursor theme — see assets/gen-cursor.py / assets/cursor.conf) in a
// borderless, click-through, always-on-top window that tracks the real
// pointer position every frame and sits exactly on top of it, hotspot
// aligned to hotspot. Visually this reads the same as a real cursor
// swap, since the underlying arrow is fully covered at the position it
// would otherwise occupy — even though, unlike the Linux mechanism,
// this never touches any real system cursor setting.
//
// Bugs real detectados 2026-09-19 (probado en hardware real) while
// writing this: `NSApplication.sharedApplication` and
// `NSEvent.mouseLocation` are ObjC *properties* in JXA, not methods —
// calling them with `()` throws `TypeError: Object is not a function`
// the moment the position timer fires. And `orderFrontRegardless()`
// isn't reachable through JXA's bridge at all (comes back `undefined`);
// plain `orderFront(null)` works instead. Confirmed live: with those
// fixed, the process runs indefinitely with the position timer firing
// without crashing or leaking (killed cleanly, window gone with it).
//
// Visually confirmed 2026-09-19: took a real screenshot (via Manoo's own
// screenshot tool, once Screen Recording permission was granted) while
// this was running standalone — the glowing hand renders correctly, on
// top of other windows, aligned to the real cursor position. Still
// untested: multi-monitor (NSEvent.mouseLocation should already be in
// the shared global desktop space, but not confirmed against a real
// second display), behavior over a full-screen app's own Space, and the
// frame-animation cycling specifically (only confirmed a single static
// frame renders correctly, not the 4-frame pulse over time).
//
// Note for whoever ships this: a raw SIGTERM to a bare Node process with
// no signal handler of its own does NOT reliably run 'exit' listeners
// (confirmed live while testing this file standalone - an orphaned
// overlay process survived `kill <pid>` and needed `kill -9`). This
// isn't a gap in production: index.mjs's own SIGINT/SIGTERM handler
// calls restoreCursorTheme() explicitly before process.exit(), and
// process.exit() does reliably fire 'exit' listeners - the self-
// registered hook below is only a safety net for paths other than that
// one, same as mouse-lock.mjs's own documented kill-9 gap.
//
// Implemented as a spawned `osascript -l JavaScript` (JXA) process,
// matching window-backend-macos.mjs's approach — no extra build step or
// native dependency for users to install beyond what macOS already
// ships. One process per show; killing it removes the window
// (WindowServer cleans up a dead process's windows immediately), so
// there's no persistent daemon or IPC protocol to get wrong — the
// Linux file's own history (a cursor theme left stuck because a restore
// path was missed) is exactly the class of bug that design avoids here
// by construction rather than by remembering to restore anything.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets");
const FRAME_PATHS = [0, 1, 2, 3].map((i) => join(ASSETS_DIR, `cursor-frame-${i}.png`));

// Hotspot (tip of the middle finger) and per-frame duration, kept in
// sync BY HAND with assets/cursor.conf — the source of truth for the
// compiled Xcursor theme used on Linux (format: `<size> <xhot> <yhot>
// <file> <ms>` per xcursorgen). There's no shared machine-readable
// format between the two platforms' cursor pipelines; if cursor.conf's
// hotspot or timing ever changes, update these too.
const HOTSPOT_X = 20;
const HOTSPOT_Y = 3;
const FRAME_MS = 150;

// JXA has no way to define a new Objective-C class, so this avoids
// target/selector-based NSTimer entirely and uses the block-based
// `scheduledTimerWithTimeInterval:repeats:block:` initializer instead —
// the block is an ordinary bridged JS function. `app.run()` (rather than
// a raw CFRunLoopRun, which would need ObjC.bindFunction to reach a bare
// C symbol) is what actually drives those timers and flushes window
// updates to WindowServer; activationPolicy is set to Prohibited first
// so this never gets a Dock icon or steals focus/Cmd-Tab the way a
// normal foreground app would.
const OVERLAY_JXA = `
ObjC.import('AppKit');

function run(argv) {
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyProhibited);

  var images = argv.slice(0, 4).map(function (p) {
    return $.NSImage.alloc.initByReferencingFile(p);
  });
  var hotX = Number(argv[4]), hotY = Number(argv[5]), frameMs = Number(argv[6]);
  var size = images[0].size;

  var rect = $.NSMakeRect(0, 0, size.width, size.height);
  var win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    rect, $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false
  );
  win.opaque = false;
  win.backgroundColor = $.NSColor.clearColor;
  win.hasShadow = false;
  win.ignoresMouseEvents = true;
  win.level = $.NSScreenSaverWindowLevel;
  win.collectionBehavior =
    $.NSWindowCollectionBehaviorCanJoinAllSpaces |
    $.NSWindowCollectionBehaviorStationary |
    $.NSWindowCollectionBehaviorIgnoresCycle |
    $.NSWindowCollectionBehaviorFullScreenAuxiliary;

  var view = $.NSImageView.alloc.initWithFrame(rect);
  view.imageScaling = $.NSImageScaleNone;
  view.image = images[0];
  win.contentView = view;

  function place() {
    var loc = $.NSEvent.mouseLocation;
    win.setFrameOrigin($.NSMakePoint(loc.x - hotX, loc.y - (size.height - hotY)));
  }

  place();
  // orderFrontRegardless() isn't reachable through JXA's bridge (comes
  // back undefined, confirmed live) - plain orderFront(null) works and
  // is enough here since the window's own level (above) is what keeps
  // it on top, not app activation.
  win.orderFront(null);

  var frameIdx = 0;
  $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(frameMs / 1000, true, function () {
    frameIdx = (frameIdx + 1) % images.length;
    view.image = images[frameIdx];
  });
  $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(1 / 60, true, function () {
    place();
  });

  app.run();
}
`;

let overlay = null;

/** Spawns the overlay process if it isn't already running — a no-op if
 * one is already up (mirrors the Linux file's themeInstalled guard).
 * Best-effort: if osascript/JXA/AppKit isn't available for any reason,
 * Manoo's real actions still work, the cursor just doesn't change. */
export function applyNeonCursor() {
  if (overlay) return;
  try {
    const child = spawn(
      "osascript",
      [
        "-l", "JavaScript", "-e", OVERLAY_JXA, "--",
        ...FRAME_PATHS, String(HOTSPOT_X), String(HOTSPOT_Y), String(FRAME_MS),
      ],
      { stdio: "ignore" }
    );
    child.on("exit", () => {
      if (overlay === child) overlay = null;
    });
    child.on("error", () => {
      if (overlay === child) overlay = null;
    });
    child.unref();
    overlay = child;
  } catch {
    // best-effort — see file-level comment
  }
}

/** Kills the overlay process, if running. The window disappears with it
 * immediately — unlike the Linux theme, there's no shared system setting
 * this ever wrote to, so there's no separate value to restore. */
export function restoreCursorTheme() {
  if (!overlay) return;
  try {
    overlay.kill("SIGKILL");
  } catch {
    // already gone — fine
  }
  overlay = null;
}

// Safe to self-register: Node runs every "exit" listener from every
// module regardless of who ends the process (see mouse-lock.mjs).
process.on("exit", restoreCursorTheme);
