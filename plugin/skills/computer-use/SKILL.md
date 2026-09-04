---
name: computer-use
description: Use when the user asks Claude to interact with the screen directly instead of describing what to do — e.g. "click the deploy button", "open this dialog and confirm it", "check what's on screen right now", "do it yourself instead of telling me the steps". Gives Claude screenshot, mouse, and keyboard control of this desktop.
---

# Computer use (local, free-tier prototype)

You have direct control of this machine's screen, mouse, and keyboard via the
`manoo` MCP tools: `screenshot`, `cursor_position`, `mouse_move`,
`left_click`, `right_click`, `middle_click`, `double_click`,
`left_click_drag`, `scroll`, `type`, `key`, plus `license_status` and
`license_activate`.

Everything runs locally on this machine. Nothing is sent anywhere else
(Pro's audit log is also local-only).

Free tier caps action tools (everything except `screenshot`,
`cursor_position`, and the license tools) at 25 per session. If a tool
returns a "Free tier limit reached" message, tell the user plainly that
they've hit the limit and can run `license_activate` with a Manoo Pro key
to remove it — don't just retry the same action.

## Human takes control — stop immediately

A global input hook watches every mouse and keyboard event on the machine,
from any device. If it sees real input that wasn't one of Manoo's own
actions, it refuses the next action and returns a message starting with 🛑
instead of guessing what the human wanted. **When you see that message:
stop the whole task, tell the user plainly that they took control, and
wait for them to ask you to continue.** Do not retry, do not "route
around" it by clicking somewhere else — the human touching any input
device mid-task is a deliberate interrupt, not a glitch to work past.

This is intentionally system-wide, not scoped to the window Manoo is
driving — it can trigger from activity in a completely unrelated
window if the user is doing something else at the same time. That's a
known trade-off (safe-by-default over precise), not a bug.

## The loop

For any on-screen task:

1. **Screenshot first.** Never click blind — always take a screenshot before
   deciding on coordinates, even if you think you know the layout.
2. **Reason about the screenshot.** Identify the element you need (button,
   field, menu item) and its approximate pixel coordinates.
3. **Act with one tool call.** Prefer one deliberate action per step over a
   burst of actions — screens change, and you want to react to what actually
   happened, not what you assumed would happen.
4. **Screenshot again to verify.** Confirm the action had the intended
   effect before moving to the next step. If it didn't, re-assess — don't
   repeat the same click hoping it works.

## Safety rules — do not skip these

- **Never type into a password/credential field.** If a field looks like a
  password input (masked characters, labeled "password", "PIN", "secret",
  "token", etc.), stop and ask the user to enter it themselves.
- **Confirm before destructive or irreversible actions** — delete, remove,
  submit a payment, send a message, force-push, close without saving. State
  what you're about to click and why, and wait for the user's go-ahead if
  there's any doubt about intent.
- **Stay inside the task's scope.** Don't click around exploring unrelated
  windows or applications the user didn't mention.
- **If you're not confident about a coordinate, zoom in first** — take a
  screenshot, reason about the general area, and if precision matters (small
  icons, dense toolbars) consider moving the mouse there first and checking
  `cursor_position` / another screenshot before clicking.
- **Stop and report if the screen doesn't match your expectations** (a
  dialog appeared, the app crashed, a permission prompt showed up) rather
  than clicking through blindly.

## Known limitations (this is the free-tier local prototype)

- Linux/X11 only for now — will not work under Wayland sessions.
- No accessibility-tree reading yet — coordinates come from visually reading
  the screenshot, not from structured UI metadata. Small or ambiguous
  targets may need a couple of attempts.
- No action audit log / macro recording yet — that's a planned paid-tier
  feature.
