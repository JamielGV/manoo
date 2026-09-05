---
name: computer-use
description: Use when the user asks Claude to interact with the screen directly instead of describing what to do — e.g. "click the deploy button", "open this dialog and confirm it", "check what's on screen right now", "do it yourself instead of telling me the steps". Gives Claude screenshot, mouse, and keyboard control of this desktop.
---

# Computer use (local, free-tier prototype)

You have direct control of this machine's screen, mouse, and keyboard via the
`manoo` MCP tools: `screenshot`, `cursor_position`, `mouse_move`,
`left_click`, `right_click`, `middle_click`, `double_click`,
`left_click_drag`, `scroll`, `type`, `key`, `split_screen`, plus
`license_status` and `license_activate`.

Everything runs locally on this machine. Nothing is sent anywhere else
(Pro's audit log is also local-only).

## Split screen and the neon cursor only show up when Manoo is about to act

Nothing visible happens just because the MCP server process is running,
or even because you took a `screenshot` or checked `cursor_position` —
those are read-only and never touch the screen layout or the cursor.
Split screen and the neon cursor only appear right before an action tool
(`mouse_move`, a click, `scroll`, `type`, `key`) actually runs, and revert
on their own once Manoo goes quiet for about a minute (see below). You
don't need to do anything to trigger this — it's automatic on every
action tool call.

## The screen stays split with the IDE while Manoo acts

Manoo tiles the screen so the Claude Code / IDE window stays visible on
one side while it drives the other app — the user should never lose
sight of the conversation while Manoo is acting.

If you open a new target app window mid-task (e.g. you launched it via a
terminal command rather than clicking it into existence), call
`split_screen` again afterward so that window gets tiled in too. In
practice you rarely need to: the split is re-asserted before every single
action tool call, so the IDE stays fully visible even if something (the
user, the app itself) moved or maximized a window in between. It also
remembers which window is "the app Manoo is
driving" rather than re-guessing every time, so an unrelated window the
user opens on their own in parallel (a file manager, another browser tab)
doesn't get mistaken for the target and pulled into the split.

The split itself is also temporary within a session: after ~60 seconds of
no further action tool calls, the IDE fills back to the full screen, gets
focus, and its chat scrolls to the latest message — then splits again the
next time you act. If a resize doesn't seem to take (rare, but seen live
— the IDE window in particular can be stubborn about accepting an
external resize while it's the focused window), `split_screen` re-run a
moment later usually clears it.

When Manoo stops operating entirely (the server process ends — session
closed, plugin reloaded, etc.) both windows are put back to their
original position and size — the screen returns to how it was before
Manoo touched it.

**If an action tool replies that the screen "just split again" instead of
doing what you asked, that's not an error to work around — take a new
screenshot and repeat the action.** This happens the first time you act
after Manoo has been idle for a while: the split moves the target window
out from under any coordinates you computed from an older, pre-split
screenshot, so Manoo refuses to click/type blindly and aborts instead.
The very next screenshot will show the settled split layout — just
re-read coordinates from it and retry.

**If a permission classifier blocks a sensitive action** (entering
credentials, filling a real account/financial signup form), don't try to
route around it — call `hold_screen` right away, then tell the user
plainly what you were about to do and why, and let them finish that part
by hand. Manoo's own server has no way to detect a classifier block
itself (it happens above the plugin entirely) — only you see it, from
the tool-call error — so `hold_screen` is how you tell Manoo about it:
it splits the screen immediately and pins the layout there (skipping the
normal ~60s idle revert) for up to 30 minutes, so the window the user
needs to type into doesn't get covered before they've even started (a
plain "wait for real activity" check can't help with that gap — there's
no activity yet for it to notice). Call `release_screen_hold` once
they're done, or once you resume acting yourself, so normal idle
behavior resumes instead of holding the split indefinitely.

## The real cursor glows neon only while actually processing

The actual system pointer — not a separate window, the real cursor itself
— swaps to a neon-glow hand (matching Manoo's own icon) for as long as
Manoo is actively working, and reverts to the user's normal cursor about
3 seconds after its last actual action — quickly, since its whole purpose
is telling the user "Manoo is navigating/typing/clicking right now," not
lingering after Manoo has moved on to something else. This is on its own
timer, separate from the screen split (which stays up to 60 seconds, much
longer — see above); the two used to share one timer, which meant the
cursor stayed neon for up to a full minute after Manoo's last action just
because the split needed that much buffer, which a real user correctly
flagged as wrong. You never call anything for this; it's tied to every
action tool automatically. A burst of several actions under ~3 seconds
apart still reads as one continuous "processing" stretch rather than
flickering the cursor on and off between each one. Best-effort: needs
`xrdb` and `xsetroot` on an X11 `DISPLAY` — no X11, no those tools, Manoo
still works, the cursor just stays whatever it already was.

**Pass `x`/`y` to `type` so the cursor sits next to what's being typed.**
`type` doesn't move the mouse on its own — if you clicked into a field
far from where you're now typing, or the mouse was left somewhere else
entirely, the glowing cursor won't be anywhere near the text, and it stops
reading as "Manoo is writing this." Give `type` the coordinates of the
field (usually the same ones you just clicked) and it moves the mouse
there first. There's no text-highlighting effect — the visible feedback
is the cursor's own position and glow, not the text itself.

There is deliberately no separate HUD window anymore (an earlier version
had one, first as a Firefox window — which a real user correctly pointed
out an end user should never see, a generic browser window with an
address bar — then as a native GTK window). Once the cursor itself could
show "Manoo is working," a second indicator was redundant, per that same
user's feedback, and was removed rather than reworked.

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

**Escape is a dedicated hard-stop.** Pressing Escape always counts as the
user taking control, even mid-action (e.g. partway through a long `type`
call) — it gets a longer staleness allowance (8s) than ambient
interference (2s) does. You'll see a message specifically about Escape;
treat it exactly like any other human-takeover message: stop and wait.
If you sent Escape yourself moments ago (via the `key` tool) and then a
takeover message about Escape shows up on some later, unrelated action,
that's this same self-triggered edge case rather than a fresh press —
still stop and check with the user rather than assuming it's spurious.

**The user's physical mouse/touchpad is briefly disabled during each
action** (not between actions) so a stray touchpad brush can't land a
click meant for Manoo onto whatever window happens to have focus for that
instant. This does not weaken the takeover above — Escape still works
instantly since it's the keyboard, which is never touched.

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
