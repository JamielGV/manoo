# Manoo (Claude Code plugin — free-tier prototype)

By Corporación Jamiel.

Gives Claude screenshot + mouse/keyboard control of this desktop via a local
MCP server, so it can act directly on screen instead of only describing
steps. Linux/X11 only for now. Everything runs locally — nothing leaves the
machine.

## Layout

- `.claude-plugin/marketplace.json` — local marketplace listing so this repo
  can be added directly with `claude plugin marketplace add <path>`.
- `plugin/` — the actual plugin:
  - `.claude-plugin/plugin.json` — plugin manifest
  - `.mcp.json` — wires up the local stdio MCP server (passes `DISPLAY`/
    `XAUTHORITY` through explicitly — the MCP SDK does NOT inherit the
    parent environment by default, so this is required for X11 access)
  - `server/index.mjs` — the MCP server (`@modelcontextprotocol/sdk` +
    `@nut-tree-fork/nut-js`), exposing: `screenshot`, `cursor_position`,
    `mouse_move`, `left_click`, `right_click`, `middle_click`,
    `double_click`, `left_click_drag`, `scroll`, `type`, `key`,
    `split_screen`, `license_status`, `license_activate`
  - `server/license.mjs` — verifies Ed25519-signed license keys (public key
    only; cannot mint new licenses)
  - `server/audit.mjs` — Pro-only local audit log
    (`~/.local/share/manoo/audit.log`)
  - `server/window-layout.mjs` — tiles the IDE window and the app Manoo is
    driving into left/right halves via `wmctrl`, and pins the HUD overlay
    window into the bottom-right corner. Finds the IDE window by walking
    this process's own parent chain (not by title, which changes)
  - `server/overlay-server.mjs` — local HTTP+SSE server behind the neon HUD
    (see "Screen layout & HUD" below)
  - `server/mouse-lock.mjs` — disables the user's physical mouse/touchpad
    for the duration of a single action (see "Mouse lock" below)
  - `skills/computer-use/SKILL.md` — teaches Claude the
    screenshot→reason→act→verify loop and safety rules (no password fields,
    confirm before destructive actions)
- `licensing/` — **not shipped with the plugin**, tooling for Corporación
  Jamiel only:
  - `generate-keypair.mjs` — run once, produced the keypair already in use
    (private key gitignored, never commit it)
  - `mint-license.mjs` — `node mint-license.mjs --email x@y.com --plan pro
    --days 365` prints a license key to hand to a paying customer (manual
    for now — wiring this to a real checkout via Lemon Squeezy/Paddle is
    the next step before charging anyone for real)

## Licensing model (implemented, verified end-to-end)

- **Free:** all tools work, but action tools (everything except
  `screenshot`/`cursor_position`/license tools) cap at 25 calls per server
  process lifetime.
- **Pro:** unlimited actions + every action written to a local audit log.
  Activate with the `license_activate` tool (or by placing a key at
  `~/.config/manoo/license.key`, or via `MANOO_LICENSE_KEY` env var).
- License keys are Ed25519-signed (`payload.signature`, both base64url).
  Verified offline — no server round-trip yet, no telemetry. Tampered or
  forged keys are rejected (tested).
- **Not yet done:** actually selling a key (no checkout page/payment
  processor hooked up), ToS/Privacy Policy, device/seat limits.

## Human control handoff (implemented, verified)

`server/input-monitor.mjs` runs a global OS-level input hook
(`uiohook-napi`) that sees every mouse and keyboard event on the machine,
from any device. Every action tool calls `beginManooAction(ms)` right
before it acts, suppressing its own synthetic echo for roughly how long
the action takes; anything the hook sees outside that window is real human
input. The next action tool call refuses to run, leaves input untouched,
and returns a 🛑 message. Verified end-to-end: a real mouse move and a real
key press each independently blocked the next action; normal actions
before/after succeeded once the interference was consumed.

Trade-off, by design: detection is system-wide, not scoped to the specific
window Manoo is driving — activity in an unrelated window can trigger it
too. Safe-by-default over precise.

Interference older than 2 seconds by the time an action checks for it is
discarded rather than blocking — otherwise the keystrokes used to send a
chat message to Claude would block Claude's very next action almost every
time (found live: typing "corrige" repeatedly blocked the next click,
every time, because "corrige" starts with the letter it kept reporting).
Only activity recent enough to plausibly mean "the human is touching
something right now" counts. **Escape is exempt from this staleness
discard** — it's a deliberate stop gesture, not ambient noise, so it
always counts, however long ago it was checked for.

### Mouse lock during each action (implemented, verified)

`server/mouse-lock.mjs` physically disables the user's real mouse/
touchpad (via `xinput disable`, never the "Virtual core XTEST pointer"
device nut-js itself uses) for the duration of a single action — a click,
a drag, a scroll — then re-enables it in a `finally`. This is narrower in
scope than the human-takeover check above: it only covers one action, not
the whole task, and only the mouse, never the keyboard, so Escape (see
below) always gets through. Verified: during the lock `xinput list` shows
the devices as `[floating slave]`; after, they're back to
`[slave pointer]`.

Safety net against the process dying mid-lock: a 4-second watchdog timer
force-re-enables regardless, and `exit`/`SIGINT`/`SIGTERM` handlers do the
same synchronously. Verified: a simulated crash (hard `process.exit()`
right after locking, skipping the `finally`) still left the mouse
re-enabled immediately via the exit handler. The one real gap, inherent to
the OS and not fixable from inside the process: `kill -9` (SIGKILL) can't
be caught by anything running in the process being killed, so only the
external watchdog timer would apply, and if the whole process is gone
that timer is gone too — worst case the user's mouse stays disabled until
they use the keyboard to fix it (`xinput enable <id>`) or unplug/replug a
USB mouse. Not a full lockout since the keyboard is never touched.

### Escape hard-stop (implemented, verified)

A real Escape press (`input-monitor.mjs`) always counts as human takeover
immediately, even mid-action — unlike other interference it isn't limited
to "between actions" or subject to the 2-second staleness discard. It has
its own narrow suppression window (`beginEscapeAction`, ~300ms) so Manoo's
own synthetic Escape (sent via the `key` tool, e.g. to close a dialog)
isn't mistaken for the user's stop signal. When triggered, it also
force-unlocks the mouse immediately via `onEmergencyStop` rather than
waiting for the current action's own cleanup.

## Screen layout & HUD (implemented, verified)

- **Lazy activation:** none of this runs when the MCP server process
  starts. `index.mjs`'s `ensureActivated()` fires once, on the first
  actual Manoo tool call (`screenshot` included) — the moment the user has
  asked Claude to do something with the screen, not a moment sooner or
  later. Installing the plugin and Claude Code launching its process
  should never by themselves pop up a window or move anything.
- **Split screen with the IDE:** on activation — and before every single
  action after that, not just once — `window-layout.mjs` tiles the
  Claude Code / IDE window and whatever app Manoo is driving into left/right
  halves of the work area (via `wmctrl`), so the user never loses sight of
  the conversation while Manoo acts. The `split_screen` tool re-runs this on
  demand — useful after opening a new target app window mid-task, or if the
  layout drifts. Target-window identification is sticky (remembers the
  window id once picked, keeps using it as long as it still exists) rather
  than re-guessing "the last other window" on every call — found live that
  the naive guess could mistake an unrelated window the user opened in
  parallel (a file manager) for the app being driven.
- **Neon HUD overlay:** a small always-on-top window pinned to the
  bottom-right corner (opened in Firefox, positioned via `wmctrl`) shows a
  pulsing neon dot tracking the cursor on a mini-map, plus a flashing ticker
  for the last thing typed or key pressed. Pushed live from the MCP server
  over Server-Sent Events (`overlay-server.mjs`) — every mouse/click/
  scroll/type/key tool feeds it, no extra calls needed. Excluded from
  `split_screen`'s target-window detection so it's never mistaken for the
  app being driven.
- **Restore on shutdown:** the first time the layout is actually touched,
  `window-layout.mjs` captures the IDE and target windows' original
  position/size. When Manoo stops operating — session closed, process
  killed, `SIGINT`/`SIGTERM` — everything is put back and the HUD window
  is closed. Geometry only, not the WM's internal "maximized" flag (wmctrl
  doesn't expose that cheaply), but visually restores the common case
  well. A single centralized `shutdown()` in `index.mjs` owns SIGINT/
  SIGTERM for the whole process and calls both this and the mouse-lock
  cleanup — deliberately not left to each module to register its own
  signal handler, since the first one to call `process.exit()` would
  silently stop any other same-signal listener registered after it from
  ever running (Node quirk, not a wmctrl one). Each module's own `exit`
  listener is unaffected by that and still fires independently, since Node
  always runs every `exit` listener regardless of who ends the process.
  Same `kill -9` (SIGKILL) gap as the mouse lock, and for the same
  reason — nothing running inside the process being killed can react to
  it. Worst case the windows are left wherever they were; re-running
  `split_screen` or just resizing them by hand fixes it, same as any
  normal window.
- Also worth knowing: the plugin's installed *code* updates on
  `claude plugin install`, but an MCP server process already running
  keeps running the version it started with — reinstalling doesn't
  restart it. A session that reinstalls the plugin mid-conversation (as
  happened during development) needs the old server process explicitly
  ended (`kill` its PID, found via `ps aux | grep index.mjs`) for the next
  tool call to spawn a fresh one with the new code; otherwise the fixes
  above don't apply until the whole Claude Code session restarts.
- Both split-screen and the HUD are best-effort: no X11 display, no
  `wmctrl`, or no Firefox just means Manoo runs without them — never a
  hard failure.

## Test / iterate locally

```bash
claude plugin marketplace add ~/manoo
claude plugin install manoo@manoo-local
```

**Important:** this is a local-path plugin, not a git one. Editing files
under `plugin/` does **not** auto-sync to the installed copy — `claude
plugin update` only checks the version number. After making changes, run:

```bash
claude plugin uninstall manoo@manoo-local
claude plugin install manoo@manoo-local
```

Then restart the Claude Code session for the MCP server process to reload.

## Known limitations (tracked, not yet fixed)

- Linux/X11 only — will not work under Wayland.
- No accessibility-tree reading — coordinates come from Claude visually
  reading screenshots, not structured UI metadata.
- No usage metering beyond the in-process free-tier cap, no macro
  recording/replay, no audit dashboard UI (the audit log itself exists,
  just no viewer for it yet).

## Naming

Product name **Manoo** was picked over Delega / Actua / Visorix — hands
metaphor for mouse/keyboard control, distinct from "Claude" branding per
Anthropic's guidelines (the product name itself must not imply an official
Anthropic product; "for Claude Code" is fine as a descriptor).
Before public launch: verify "Manoo" trademark and domain availability.
