#!/usr/bin/env node
// Manoo MCP server: screenshot + mouse/keyboard control for Claude Code.
// By Corporación Jamiel. Everything runs on this machine, nothing leaves it
// — except the Pro audit log, which is also local, just richer.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  mouse,
  keyboard,
  screen,
  Point,
  Button,
  Key,
  FileType,
} from "@nut-tree-fork/nut-js";
import { z } from "zod";
import { readFile, unlink, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { loadLicense, verifyLicenseString, LICENSE_FILE } from "./license.mjs";
import { logAction, AUDIT_LOG_FILE } from "./audit.mjs";
import { beginManooAction, beginEscapeAction, consumeHumanInterference, onEmergencyStop, msSinceLastHumanActivity } from "./input-monitor.mjs";
import { splitScreenWithIde, maximizeIdeWindow, minimizeTargetWindow, focusIdeWindow, restoreOriginalLayout } from "./window-layout.mjs";
import { withMouseLocked, emergencyUnlock } from "./mouse-lock.mjs";
import { applyNeonCursor, restoreCursorTheme } from "./cursor-theme.mjs";

// A real Escape press always force-unlocks the mouse immediately, rather
// than waiting for the current action's own `finally` to release it.
onEmergencyStop(() => emergencyUnlock());

// A single centralized SIGINT/SIGTERM handler for the whole server —
// deliberately not left to mouse-lock.mjs/window-layout.mjs to each
// register their own (see the comment in mouse-lock.mjs for why that
// would silently drop one of them). Restores the mouse and the screen
// layout to how they were before Manoo touched anything, then exits.
function shutdown() {
  emergencyUnlock();
  restoreOriginalLayout();
  restoreCursorTheme();
  process.exit();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// nut-js defaults are tuned for animated, human-like movement. For
// programmatic control we want it fast and deterministic.
mouse.config.mouseSpeed = 3000;

// ---- Split screen + neon cursor, only while actually processing --------
// Manoo shouldn't take over the screen (split it, change the cursor) the
// moment the IDE happens to start the plugin's MCP server, or even the
// moment the user asks it to look at something — only once it's actually
// about to act (an action tool call, not a read-only one), which is
// exactly what markProcessing() below is called from.
//
// The cursor and the screen layout revert on two DIFFERENT timers, found
// live to need different lengths for opposite reasons:
//   - The cursor is the user's real-time "Manoo is navigating/typing/
//     clicking right now" signal (explicit user feedback) — it should go
//     back to the normal system cursor within a couple seconds of Manoo's
//     last actual action, not linger while Claude Code is just thinking or
//     doing unrelated work (editing files, running bash) between actions.
//   - The split/minimize layout needs a much longer buffer: found live that
//     reverting it too eagerly (15s) let it flip back mid-task, moving the
//     target window out from under coordinates a click was about to use.
// Sharing one timer meant fixing the layout bug (15s -> 60s) also made the
// cursor linger for a full minute after Manoo's last real action — wrong
// per the cursor's actual purpose. Two independent timers fix both.
const CURSOR_IDLE_MS = 3000;
const LAYOUT_IDLE_MS = 60000;
// If the human is actively touching the mouse/keyboard themselves — most
// often because they took over to fill in something sensitive Manoo
// handed off (a permission classifier blocked an action, a password
// field) — the layout timer must NOT minimize/maximize out from under
// them just because Manoo itself hasn't acted in 60s. Found live: a
// classifier-blocked signup form left the user filling it in by hand,
// and nothing about that showed up as a Manoo action, so the plain timer
// would have covered the very window they were typing into.
const HUMAN_ACTIVE_GRACE_MS = 5000;
let cursorIdleTimer = null;
let layoutIdleTimer = null;

async function goIdle() {
  await maximizeIdeWindow().catch(() => {});
  // Minimize (never close) the window Manoo was driving — per explicit
  // user feedback, it shouldn't just sit covered behind the now-maximized
  // IDE (still one alt-tab away, still cluttering the taskbar) once Manoo
  // is done with it for now. splitScreenWithIde() un-minimizes it again
  // automatically the next time it's needed (placeWindow() clears the
  // hidden state as part of positioning it).
  await minimizeTargetWindow().catch(() => {});
  // Bring the IDE forward and scroll its chat to the latest message —
  // otherwise the user gets the IDE back full-screen but possibly still
  // scrolled to wherever it was mid-task, not what Claude just said.
  await focusIdeWindow().catch(() => {});
  beginManooAction(400);
  try {
    await mouse.scrollDown(30);
  } catch {
    // best-effort — no display, no mouse control available, etc.
  }
}

/** Re-armed by markProcessing() on every action instead of calling
 * goIdle() directly — checks for recent real human activity first, and
 * if the human is mid-handoff (typing/clicking themselves right now),
 * postpones rather than minimizing/maximizing out from under them. Keeps
 * re-checking every HUMAN_ACTIVE_GRACE_MS until they've also gone quiet. */
function scheduleLayoutIdle() {
  clearTimeout(layoutIdleTimer);
  layoutIdleTimer = setTimeout(checkLayoutIdle, LAYOUT_IDLE_MS);
  layoutIdleTimer.unref?.();
}

async function checkLayoutIdle() {
  if (msSinceLastHumanActivity() < HUMAN_ACTIVE_GRACE_MS) {
    clearTimeout(layoutIdleTimer);
    layoutIdleTimer = setTimeout(checkLayoutIdle, HUMAN_ACTIVE_GRACE_MS);
    layoutIdleTimer.unref?.();
    return;
  }
  await goIdle();
}

/** Awaited by `gated()` before the actual handler runs — the split must
 * be settled before a click fires, or it could land on the wrong window
 * mid-transition. The cursor swap doesn't need the same guarantee, but is
 * awaited too rather than fired-and-forgotten, so a slow xsetroot call
 * can't race a fast handler.
 *
 * Returns whether the split just moved a window that wasn't already in
 * split position — i.e. this call transitioned the layout from idle
 * (target window full-screen) into split, rather than re-asserting a
 * split that was already in place. `gated()` uses this to abort the
 * action rather than run it: found live that a click computed from a
 * screenshot taken while idle landed on the IDE instead of the intended
 * window, because the split moved the target out from under it in this
 * same call, before the click fired. */
async function markProcessing() {
  const [, splitResult] = await Promise.all([
    applyNeonCursor().catch(() => {}),
    splitScreenWithIde().catch(() => ({ layoutChanged: false })),
  ]);
  clearTimeout(cursorIdleTimer);
  cursorIdleTimer = setTimeout(() => restoreCursorTheme(), CURSOR_IDLE_MS);
  cursorIdleTimer.unref?.();
  scheduleLayoutIdle();
  return Boolean(splitResult && splitResult.layoutChanged);
}

// ---- Licensing / free-tier quota -------------------------------------

const FREE_ACTION_LIMIT = 25; // per server process lifetime — a prototype cap

let license = loadLicense();
let actionsUsed = 0;

function isPro() {
  return license.valid;
}

// ---- Human-control handoff ---------------------------------------------
// A global input hook (input-monitor.mjs) watches EVERY mouse and keyboard
// event on the machine, from any device. Manoo's own synthetic actions
// suppress themselves via beginManooAction() right before they run; any
// input detected outside that window is a real human — stop immediately
// rather than guessing what they wanted.

function handoffMessage({ type, detail }) {
  if (type === "escape") {
    return textResult(
      `🛑 Presionaste Escape — Manoo se detuvo de inmediato y no realizó la ` +
      `acción pedida. Tienes el control. Pide que continúe cuando quieras.`
    );
  }
  return textResult(
    `🛑 Manoo detected real ${type} input (${detail}) that wasn't its own action — ` +
    `you touched an input device. Tienes el control ahora. Manoo stopped and did NOT ` +
    `perform the requested action. Ask again when you want it to continue.`
  );
}

/** Wraps an action tool handler with human-handoff, free-tier quota, and Pro audit log. */
function gated(name, handler) {
  return async (args) => {
    const layoutJustChanged = await markProcessing();
    // Always consume interference, even if we're about to abort for the
    // layout-changed reason below — an unconsumed flag would otherwise
    // wrongly surface on some later, unrelated action.
    const interference = consumeHumanInterference();
    if (interference) {
      return handoffMessage(interference);
    }
    if (layoutJustChanged) {
      return textResult(
        `La pantalla se acaba de dividir de nuevo con el IDE justo antes de esta acción — la ventana que ibas a usar pudo haberse movido, así que las coordenadas de una captura anterior ya no son confiables. No se ejecutó "${name}". Toma una nueva captura (screenshot) y repite la acción con las coordenadas actualizadas.`
      );
    }
    if (!isPro()) {
      if (actionsUsed >= FREE_ACTION_LIMIT) {
        return textResult(
          `Free tier limit reached (${FREE_ACTION_LIMIT} actions this session). ` +
          `Activate a Manoo Pro license with the "license_activate" tool to remove this limit — see https://corporacionjamiel.com/manoo (placeholder until checkout is live).`
        );
      }
      actionsUsed++;
    }
    const result = await handler(args);
    if (isPro()) {
      await logAction({ tool: name, args }).catch(() => {});
    }
    return result;
  };
}

// ---- Key mapping for the `key` tool ----------------------------------

const KEY_MAP = {
  ctrl: Key.LeftControl,
  control: Key.LeftControl,
  shift: Key.LeftShift,
  alt: Key.LeftAlt,
  meta: Key.LeftSuper,
  super: Key.LeftSuper,
  cmd: Key.LeftSuper,
  win: Key.LeftSuper,
  enter: Key.Return,
  return: Key.Return,
  esc: Key.Escape,
  escape: Key.Escape,
  tab: Key.Tab,
  space: Key.Space,
  backspace: Key.Backspace,
  delete: Key.Delete,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
};
for (let i = 0; i <= 9; i++) KEY_MAP[String(i)] = Key[`Num${i}`];
for (const c of "abcdefghijklmnopqrstuvwxyz") KEY_MAP[c] = Key[c.toUpperCase()];
for (let i = 1; i <= 12; i++) KEY_MAP[`f${i}`] = Key[`F${i}`];

function resolveKeys(combo) {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const keys = parts.map((p) => {
    const k = KEY_MAP[p];
    if (k === undefined) {
      throw new Error(
        `Unknown key "${p}" in combo "${combo}". Known keys: ${Object.keys(KEY_MAP).join(", ")}`
      );
    }
    return k;
  });
  if (keys.length === 0) throw new Error(`Empty key combo: "${combo}"`);
  return keys;
}

async function captureScreenshotBase64() {
  const filePath = await screen.capture(
    `cc-screenshot-${Date.now()}`,
    FileType.PNG,
    tmpdir()
  );
  try {
    const buffer = await readFile(filePath);
    return buffer.toString("base64");
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function imageResult(base64) {
  return { content: [{ type: "image", data: base64, mimeType: "image/png" }] };
}

const server = new McpServer({ name: "manoo", version: "0.1.0" });

// ---- Read-only tools (never gated) -----------------------------------

server.registerTool(
  "screenshot",
  {
    title: "Take a screenshot",
    description:
      "Capture the current screen and return it as an image. Use this before deciding where to click or what to type, and again afterward to verify the result.",
    inputSchema: {},
  },
  async () => imageResult(await captureScreenshotBase64())
);

server.registerTool(
  "cursor_position",
  {
    title: "Get cursor position",
    description: "Return the current mouse cursor coordinates.",
    inputSchema: {},
  },
  async () => {
    const p = await mouse.getPosition();
    return textResult(`x=${p.x}, y=${p.y}`);
  }
);

server.registerTool(
  "split_screen",
  {
    title: "Split the screen with the IDE",
    description:
      "Tile the screen so the Claude Code / IDE window and the app Manoo is " +
      "driving sit side by side, so the user can watch what's happening in " +
      "both at once. Runs automatically before every action tool call; call " +
      "this yourself after opening a new target app window, or if the " +
      "layout drifts.",
    inputSchema: { ide_side: z.enum(["left", "right"]).optional().default("left") },
  },
  async ({ ide_side }) => {
    const result = await splitScreenWithIde({ ideSide: ide_side });
    if (!result.ok) {
      return textResult(`Could not split the screen (${result.reason}).`);
    }
    return textResult(
      `Split screen: IDE (${result.ide}) on the ${ide_side}` +
      (result.target ? `, "${result.target}" on the other side.` : ", nothing else to place on the other side.")
    );
  }
);

server.registerTool(
  "license_status",
  {
    title: "Check Manoo license status",
    description: "Report whether Manoo Pro is active, and free-tier usage so far this session.",
    inputSchema: {},
  },
  async () => {
    if (isPro()) {
      return textResult(
        `Plan: Pro\nEmail: ${license.data.email}\nExpires: ${license.data.expiresAt}\nActions: unlimited\nAudit log: ${AUDIT_LOG_FILE}`
      );
    }
    return textResult(
      `Plan: Free\nActions used this session: ${actionsUsed}/${FREE_ACTION_LIMIT}\n` +
      (license.reason === "no_license" ? "No license installed." : `License invalid: ${license.reason}`)
    );
  }
);

server.registerTool(
  "license_activate",
  {
    title: "Activate a Manoo Pro license",
    description: "Save and verify a Manoo Pro license key, unlocking unlimited actions and the audit log.",
    inputSchema: { key: z.string() },
  },
  async ({ key }) => {
    const result = verifyLicenseString(key);
    if (!result.valid) {
      return textResult(`License not accepted: ${result.reason}`);
    }
    await mkdir(dirname(LICENSE_FILE), { recursive: true });
    await writeFile(LICENSE_FILE, key.trim(), "utf8");
    license = result;
    return textResult(`Manoo Pro activated for ${result.data.email}, expires ${result.data.expiresAt}.`);
  }
);

// ---- Action tools (gated by free-tier quota, logged if Pro) ----------

server.registerTool(
  "mouse_move",
  {
    title: "Move the mouse",
    description: "Move the mouse cursor to absolute screen coordinates (x, y) without clicking.",
    inputSchema: { x: z.number().int(), y: z.number().int() },
  },
  gated("mouse_move", async ({ x, y }) => {
    beginManooAction(150);
    await withMouseLocked(() => mouse.setPosition(new Point(x, y)));
    return textResult(`Moved cursor to (${x}, ${y})`);
  })
);

function registerClickTool(name, button, label) {
  server.registerTool(
    name,
    {
      title: label,
      description: `${label} at (x, y) if given, otherwise at the current cursor position.`,
      inputSchema: { x: z.number().int().optional(), y: z.number().int().optional() },
    },
    gated(name, async ({ x, y }) => {
      beginManooAction(150);
      const p = await withMouseLocked(async () => {
        if (x !== undefined && y !== undefined) {
          await mouse.setPosition(new Point(x, y));
        }
        await mouse.click(button);
        return mouse.getPosition();
      });
      return textResult(`${label} at (${p.x}, ${p.y})`);
    })
  );
}

registerClickTool("left_click", Button.LEFT, "Left click");
registerClickTool("right_click", Button.RIGHT, "Right click");
registerClickTool("middle_click", Button.MIDDLE, "Middle click");

server.registerTool(
  "double_click",
  {
    title: "Double click",
    description: "Double left-click at (x, y) if given, otherwise at the current cursor position.",
    inputSchema: { x: z.number().int().optional(), y: z.number().int().optional() },
  },
  gated("double_click", async ({ x, y }) => {
    beginManooAction(200);
    const p = await withMouseLocked(async () => {
      if (x !== undefined && y !== undefined) {
        await mouse.setPosition(new Point(x, y));
      }
      await mouse.doubleClick(Button.LEFT);
      return mouse.getPosition();
    });
    return textResult(`Double clicked at (${p.x}, ${p.y})`);
  })
);

server.registerTool(
  "left_click_drag",
  {
    title: "Click and drag",
    description:
      "Press the left mouse button at (start_x, start_y), drag to (end_x, end_y), then release. Useful for selecting text, moving windows, or dragging sliders.",
    inputSchema: {
      start_x: z.number().int(),
      start_y: z.number().int(),
      end_x: z.number().int(),
      end_y: z.number().int(),
    },
  },
  gated("left_click_drag", async ({ start_x, start_y, end_x, end_y }) => {
    beginManooAction(300);
    await withMouseLocked(async () => {
      await mouse.setPosition(new Point(start_x, start_y));
      await mouse.pressButton(Button.LEFT);
      await mouse.setPosition(new Point(end_x, end_y));
      await mouse.releaseButton(Button.LEFT);
    });
    return textResult(`Dragged from (${start_x}, ${start_y}) to (${end_x}, ${end_y})`);
  })
);

server.registerTool(
  "scroll",
  {
    title: "Scroll",
    description: "Scroll the mouse wheel in a direction by a given amount (clicks of the wheel).",
    inputSchema: {
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().positive().default(3),
    },
  },
  gated("scroll", async ({ direction, amount }) => {
    beginManooAction(150);
    const fn = {
      up: mouse.scrollUp,
      down: mouse.scrollDown,
      left: mouse.scrollLeft,
      right: mouse.scrollRight,
    }[direction];
    await withMouseLocked(() => fn.call(mouse, amount));
    return textResult(`Scrolled ${direction} by ${amount}`);
  })
);

server.registerTool(
  "type",
  {
    title: "Type text",
    description:
      "Type text at the current cursor/focus position, as if typed on the keyboard. Pass x/y (the text field you clicked into, or wherever the text is about to appear) to move the mouse there first — so the neon cursor visibly sits next to the text as it's typed, rather than wherever it was last left. Never use this to type passwords or other credentials.",
    inputSchema: { text: z.string(), x: z.number().int().optional(), y: z.number().int().optional() },
  },
  gated("type", async ({ text, x, y }) => {
    beginManooAction(Math.max(200, text.length * 15));
    if (x !== undefined && y !== undefined) {
      await withMouseLocked(() => mouse.setPosition(new Point(x, y)));
    }
    await keyboard.type(text);
    return textResult(`Typed ${text.length} characters`);
  })
);

server.registerTool(
  "key",
  {
    title: "Press a key or key combo",
    description:
      'Press (and release) a key or key combination, e.g. "enter", "escape", "ctrl+c", "ctrl+shift+t", "f5".',
    inputSchema: { combo: z.string() },
  },
  gated("key", async ({ combo }) => {
    beginManooAction(150);
    const keys = resolveKeys(combo);
    if (keys.includes(Key.Escape)) {
      // Manoo is about to send Escape itself — don't let the global input
      // monitor mistake its own synthetic Escape for the user's hard-stop.
      beginEscapeAction(300);
    }
    await keyboard.pressKey(...keys);
    await keyboard.releaseKey(...keys);
    return textResult(`Pressed ${combo}`);
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
