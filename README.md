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
    `license_status`, `license_activate`
  - `server/license.mjs` — verifies Ed25519-signed license keys (public key
    only; cannot mint new licenses)
  - `server/audit.mjs` — Pro-only local audit log
    (`~/.local/share/manoo/audit.log`)
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
something right now" counts.

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
- No license gating, usage metering, macro recording, or audit dashboard —
  those are the planned paid-tier pieces (see project plan discussed with
  Claude, not included in this repo yet).

## Naming

Product name **Manoo** was picked over Delega / Actua / Visorix — hands
metaphor for mouse/keyboard control, distinct from "Claude" branding per
Anthropic's guidelines (the product name itself must not imply an official
Anthropic product; "for Claude Code" is fine as a descriptor).
Before public launch: verify "Manoo" trademark and domain availability.
