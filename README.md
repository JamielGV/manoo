# Manoo (Claude Code plugin — free-tier prototype)

By Corporación Jamiel.

Gives Claude screenshot + mouse/keyboard control of this desktop via a local
MCP server, so it can act directly on screen instead of only describing
steps. Linux/X11 only for now. Everything runs locally — nothing leaves the
machine.

Developed and tested against **Antigravity** (the Electron/GTK-based IDE
this session runs in) — the window-finding logic (`window-layout.mjs`
walks process ancestry, not window titles) and the cursor theme switch
(`cursor-theme.mjs`, see below) both explicitly account for how
Antigravity behaves, not just a generic "any editor" assumption.

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
    driving into left/right halves via `wmctrl`, and un-splits/maximizes
    the IDE again once idle. Finds the IDE window by walking this
    process's own parent chain (not by title, which changes)
  - `server/cursor-theme.mjs` — swaps the real system cursor for a
    neon-glow version while Manoo is active (see "Screen layout & cursor"
    below); `server/assets/gen-cursor.py` + `server/assets/left_ptr` are
    the one-time generator and its committed output
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
    --days 365` prints a license key to hand to a paying customer manually
  - Automated checkout lives in `~/manoo/automation/` (Stripe + a
    Cloudflare Worker), not under `licensing/` — see that folder's
    `SETUP.md`. Built with a deliberate rule: none of Corporación
    Jamiel's payment/signing secrets are ever typed to or read by
    Claude — `wrangler secret put` sends them straight from the user's
    terminal to Cloudflare. (An earlier same-day attempt at a Lemon
    Squeezy/Vercel alternative broke that rule — Claude directly created
    the Resend account and read its API key off-screen — and was removed
    once the existing, already-tested Stripe automation was found.)

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
- **Not yet done:** the checkout automation (`automation/`, Stripe +
  Cloudflare) is built and tested but not connected to live Stripe/
  Resend/Cloudflare accounts yet — see `automation/SETUP.md` for the
  setup steps (all of which need the user's own identity/bank details,
  not something Claude can do). Also missing: device/seat limits. ToS
  and Privacy Policy drafts already exist at the repo root
  (`LEGAL_TERMINOS_DE_SERVICIO.md`, `LEGAL_AVISO_DE_PRIVACIDAD.md`,
  Spanish) — not yet linked from the site.

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
something right now" counts. **Escape gets its own longer allowance (8s,
not 2s)** — it's a deliberate stop gesture, not ambient noise, so it
shouldn't be discarded as fast — but not an indefinite one. Found live:
making it exempt from staleness entirely was itself a bug — Manoo's own
Escape (via the `key` tool) arrived at the input hook just after its
own suppression window closed, and since only gated action tools ever
call `consumeHumanInterference()`, it sat unread through
several unrelated Bash/Read/Edit calls before surfacing at the next real
action, reported as if the user had *just* pressed Escape, seconds later.
8 seconds is long enough to cover a real human's next action without
being a lingering false trip from Manoo's own past one.

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

## Screen layout & cursor (implemented, verified)

- **Lazy, action-gated activation:** none of this runs when the MCP
  server process starts, or even on read-only tool calls (`screenshot`,
  `cursor_position`). `index.mjs`'s `markProcessing()` fires on every
  action tool call instead (`mouse_move`, clicks, `scroll`, `type`,
  `key`) — installing the plugin, Claude Code launching its process, or
  Claude just looking at the screen should never by themselves pop up a
  window, move anything, or change the cursor.
- **Split screen with the IDE:** before every single action —
  `window-layout.mjs` tiles the
  Claude Code / IDE window and whatever app Manoo is driving into left/right
  halves of the work area (via `wmctrl`), so the user never loses sight of
  the conversation while Manoo acts. The `split_screen` tool re-runs this on
  demand — useful after opening a new target app window mid-task, or if the
  layout drifts. Target-window identification is sticky (remembers the
  window id once picked, keeps using it as long as it still exists) rather
  than re-guessing "the last other window" on every call — found live that
  the naive guess could mistake an unrelated window the user opened in
  parallel (a file manager) for the app being driven.
- **Neon cursor, only while processing (implemented, verified end-to-end
  via the real server process — see below):** the real system pointer is
  swapped for a neon-glow hand — not a separate window, the actual cursor
  — for as long as Manoo is actively working, reverting to the user's
  normal cursor `CURSOR_IDLE_MS` (3000ms) after its last actual action.
  This runs on its **own** timer, separate from the split/minimize layout
  (`LAYOUT_IDLE_MS`, 60000ms) — found live, per explicit user feedback,
  that sharing one timer meant the cursor lingered neon for up to a full
  minute after Manoo's last action just because the layout needed that
  much buffer (see the layout note below for why). The cursor's whole
  purpose is telling the user "Manoo is navigating/typing/clicking *right
  now*" — it should track Manoo's actual actions closely, not the much
  longer window the layout needs to stay stable. `index.mjs`'s
  `markProcessing()` re-applies it and re-arms its own short idle timer on
  every action, so a fast burst of actions (under ~3s apart) still reads
  as one continuous stretch instead of flickering between each one, while
  a real pause of a few seconds (Claude doing something else, not calling
  Manoo) reverts it quickly. Verified live: forced the cursor timer longer
  temporarily to observe `Xcursor.theme` switch to `manoo-neon` right
  after an action and back to the original theme once the window elapsed,
  while the layout (checked via `wmctrl` at the same moments) stayed split
  throughout — confirming the two timers are genuinely independent.
  `cursor-theme.mjs` generates
  the cursor once (`assets/gen-cursor.py`, Pillow + `xcursorgen`,
  committed as `assets/left_ptr` — the exact hand geometry and blue mesh
  fill from the site's `<svg class="hand-icon">`, scaled down, drawn at
  4x internal resolution and downsampled for crisp edges, with a 4-frame
  pulsing glow), installs the cursor image at `~/.icons/manoo-neon/
  cursors/left_ptr`, and swaps it in live through **two** independent
  channels together, since real testing showed different apps only
  listen to one or the other:
  - `xrdb -merge -` writes `Xcursor.theme` straight into the X server's
    RESOURCE_MANAGER property (direct X11 `DISPLAY`, no D-Bus), then
    `xsetroot -cursor_name left_ptr` nudges the root cursor — this is
    what Firefox and the bare desktop respect.
  - `xfconf-query -c xsettings -p /Gtk/CursorThemeName -s ...` writes
    XFCE's D-Bus-backed settings store — this is what GTK apps read,
    **confirmed live: Antigravity, the Electron/GTK-based IDE this
    plugin is meant to run inside.**

  Found live, from a real user report ("I still see the neon cursor and
  I'm in Claude/Antigravity"), that an *earlier* version of this file
  used xfconf-query alone, got swapped to xrdb-only after finding
  xfconf-query writes from this server's process weren't visible to
  other processes' reads (see below) — but the swap never wrote the
  user's original theme name back into xfconf, so that store was left
  stuck on `manoo-neon` indefinitely. Every check since was against
  Xcursor via `xrdb -query`, which correctly showed the real theme, so
  the stuck xfconf value went unnoticed while Antigravity (already
  running, reading xfconf) kept reflecting it — permanently neon,
  regardless of any idle timer. Fixed by writing and restoring **both**
  channels together on every `applyNeonCursor()`/`restoreCursorTheme()`
  call, using the xrdb-sourced name as the single source of truth for
  what to restore *both* to (deliberately not trusting xfconf's own
  current value for that, since it can itself be the stuck one).
  Re-tested the original xfconf isolation concern while building this
  fix — a write from inside the real server process this time **was**
  correctly visible to an external `xfconf-query` read — so whatever
  that earlier isolation was, it isn't reproducing now; xfconf-query is
  kept as a second channel alongside xrdb rather than reinstated as the
  only one, since xrdb remains the one with a longer track record of
  reliably working from this process.
  **This is the result of several rounds of real user feedback**, in
  order: a detached corner window with a mini-map and a proxy dot (wrong
  — "that's not what neon cursor glow means") → a plain glowing dot as
  the real cursor → a simplified pointing-hand blob → the actual hand
  geometry + mesh fill matching the site icon → smaller and crisper →
  the glow pulsing → the glow fixed to be pure light, no black fringing
  → on only while processing, off when idle, rather than for the whole
  session → switched off xfconf-query in favor of xrdb-only, which (per
  the paragraph above) turned out to be an incomplete fix, not a full
  replacement → both channels written and restored together.
- **No separate HUD window.** An earlier version had one (first Firefox,
  then a native GTK window after a real user pointed out an end user
  should never see a browser window with an address bar) — removed
  entirely once the pulsing neon cursor could show "Manoo is working" on
  its own; a second indicator was redundant, per that same user's
  feedback, and was removed rather than reworked further.
- **The target window minimizes (never closes) on the layout idle timer
  (`LAYOUT_IDLE_MS`, 60000ms — not the cursor's separate, much shorter
  one),** per explicit user feedback: leaving it merely covered behind the
  now-maximized IDE still left it one alt-tab away and cluttering the
  taskbar. `minimizeTargetWindow()` (`window-layout.mjs`) hides it via
  `wmctrl -b add,hidden`, using the same sticky target-window id
  `splitScreenWithIde()` already tracks. The next split un-minimizes it
  automatically as part of normal placement — **verified live that this
  needs `wmctrl -i -a <id>` (activate), not `-b remove,hidden`**: removing
  the `_NET_WM_STATE_HIDDEN` property alone cleared the property but left
  the window genuinely invisible and unresponsive to a geometry request;
  activating (which both de-iconifies and raises/focuses) is what actually
  restored it. `restoreOriginalLayout()` does the same on shutdown, so
  Manoo stopping while the target is minimized doesn't leave it stuck
  hidden.
- **IDE un-splits (and its chat scrolls to the latest message) on that
  same layout idle timer** — `maximizeIdeWindow()` fills the IDE back
  into the full work area, `focusIdeWindow()` raises and focuses it, then
  a plain `mouse.scrollDown` nudges its chat to the bottom, all from
  `goIdle()` in `index.mjs`. Deliberately uses explicit full-workarea
  geometry (the same `placeWindow()` the split itself uses), not the
  window manager's own "maximized" state flag (`-b add,maximized_vert,
  maximized_horz`) — found live that once the IDE had genuinely been put
  into that WM state, the *next* split's resize of it stopped landing
  reliably (confirmed via `wmctrl -lG` immediately after, not just a
  slow-propagation guess), even with unmaximize-then-retry; filling the
  same coordinates explicitly avoids ever setting that flag.
  **Known unresolved issue:** even with that fix, a resize of the IDE
  window issued by this MCP server doesn't always land, in a way a
  same-shaped resize of the *target* window (or of the IDE window done
  manually, or done by a throwaway Node script) doesn't share — every
  variant tried (adding a settle delay, verifying + retrying up to 4
  times, avoiding the maximized state flag) narrowed the failure mode
  without fully eliminating it. Current best guess, not confirmed: xfwm4
  may treat an external resize of the *currently focused/active* window
  differently than an unfocused one, and the IDE is very often the
  focused window at the exact moment an action fires (a user actively
  driving Claude Code has, by definition, just interacted with the IDE to
  send that message) — but this couldn't be cleanly isolated from inside
  this same interactive loop, since sending the very message that
  triggers a tool call also refocuses the IDE. If this keeps happening:
  `split_screen` re-run a moment later, or a manual resize, both still
  work.
- **The layout idle timer holds off while a real human is actively using
  the screen, even if Manoo itself hasn't acted.** Found live: a
  permission classifier blocked a sensitive action (filling a real
  financial-account signup form) and handed control to the user to
  finish by hand — but nothing about that showed up as a Manoo action,
  so the plain 60s timer would have maximized the IDE right over the
  window they were actively typing into. `input-monitor.mjs` now tracks
  `lastHumanActivityAt` on every real (non-Manoo) input event, not just
  the first one until consumed (that's what the existing one-shot
  `interference` handoff-message mechanism already did, and still does,
  separately); `index.mjs`'s `checkLayoutIdle()` checks
  `msSinceLastHumanActivity()` before calling `goIdle()` and, if the
  human touched anything within the last `HUMAN_ACTIVE_GRACE_MS`
  (5000ms), reschedules instead of reverting — repeating until they've
  also gone quiet.
- **Restore on shutdown:** the first time the layout is actually touched,
  `window-layout.mjs` captures the IDE and target windows' original
  position/size, and `cursor-theme.mjs` captures the original cursor
  theme name. When Manoo stops operating — session closed, process
  killed, `SIGINT`/`SIGTERM` — everything is put back. Window geometry
  only, not the WM's internal "maximized" flag (wmctrl doesn't expose
  that cheaply), but visually restores the common case well. A single
  centralized `shutdown()` in `index.mjs` owns SIGINT/SIGTERM for the
  whole process and calls both this and the mouse-lock cleanup —
  deliberately not left to each module to register its own signal
  handler, since the first one to call `process.exit()` would silently
  stop any other same-signal listener registered after it from ever
  running (Node quirk, not a wmctrl one). Each module's own `exit`
  listener is unaffected by that and still fires independently, since Node
  always runs every `exit` listener regardless of who ends the process.
  Same `kill -9` (SIGKILL) gap as the mouse lock, and for the same
  reason — nothing running inside the process being killed can react to
  it. Worst case the windows/cursor are left wherever they were;
  re-running `split_screen`, resizing windows by hand, or restarting the
  session fixes it.
- Also worth knowing: the plugin's installed *code* updates on
  `claude plugin install`, but an MCP server process already running
  keeps running the version it started with — reinstalling doesn't
  restart it. A session that reinstalls the plugin mid-conversation (as
  happened during development) needs the old server process explicitly
  ended (`kill` its PID, found via `ps aux | grep index.mjs`) for the next
  tool call to spawn a fresh one with the new code; otherwise the fixes
  above don't apply until the whole Claude Code session restarts.
- Split-screen and the cursor swap are both best-effort: no X11 display,
  no `wmctrl`, no `xsetroot` — Manoo still works, just without that
  particular touch.
- **Coordinate-based actions abort if the split just moved a window
  (implemented, verified end-to-end).** Found live: a click computed from
  a screenshot taken while idle (target window full-screen) landed on the
  IDE instead, because going idle→processing moves the target window out
  from under it in the very same `gated()` call, before the click fires —
  reproduced with a real `type` call whose text landed in the IDE's chat
  box instead of the intended window. `splitScreenWithIde()` now reports
  `layoutChanged` (whether either window needed to move to reach split
  position, using a 100px tolerance rather than exact equality — GTK
  client-side decorations mean a window can settle a stable few-to-several-
  dozen pixels off the exact geometry `wmctrl -e` requested, which exact
  equality would misread as "still changing" forever). When `layoutChanged`
  is true, `gated()` aborts the action entirely (nothing is clicked/typed)
  and returns a message asking for a fresh screenshot before retrying —
  verified this actually stops the wrong-window misfire, then verified a
  screenshot+retry immediately afterward lands correctly.

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
