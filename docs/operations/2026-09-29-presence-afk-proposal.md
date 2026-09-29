# Presence, idle and the AFK channel — tracker item 37 — 2026-09-29

What the owner asked for: statuses that change in real time; on Windows,
presence that counts only real use of the machine; somebody asleep in a voice
channel shown «Неактивен» and moved to the server's AFK channel; and no false
positives — somebody watching a stream is not idle. Discord's mechanism was read
today in its shipped bundle; it is section 25 of `reference-clients.md`. This
document says what we would build from it, and what needs the owner. **Nothing
here is applied, and no migration is written.**

## What the reference settles

- **Activity is input and speech.** In Discord's desktop app, input anywhere on
  the machine counts; in its browser client, clicks, wheel and keys in the
  window. Speaking counts in both.
- **Idle comes after 10 minutes without activity**, and at once when the screen
  locks or the machine sleeps.
- **A running stream exempts a person outright**, watched or broadcast. That is
  the owner's false positive, and the reference answers it the way he asked.
- **The move to the AFK channel is made by the client itself, and only by the
  desktop app.** The browser client moves nobody. It cannot tell an idle
  machine from a person who is simply in another window.
- **After 5 hours idle in a call, the client leaves it.**

## What that means here

Our Windows app is a Tauri shell over the web build. Today it knows what the
web knows: its own window. So the parts that need the whole machine — presence
from any input, an immediate idle on a locked screen, and the AFK move — need a
native command in the shell that reports the system's idle time. **That is a
Windows release**, with its signing and SmartScreen gates (CLAUDE.md §13).
Everything else can be built on the web first.

## Four questions

**1. The order.** **Recommendation:** first the manual statuses and the
automatic «Неактивен» from window input, speech and streams, on every shell.
The system idle time and the AFK move follow with the next Windows release. That
follows the reference: its browser client never moves anybody either.

**2. Where a status lives.** A new column on `profiles` for the manual status
(«В сети», «Неактивен», «Не беспокоить», «Невидимый») with an expiry, and the
automatic idle published the way `online_at` is today. **This is a database
change, and one the owner has to approve.** «Невидимый» means somebody appears
offline while using the product fully, which is a decision about what others are
told.

**3. The AFK channel.** Two settings on a server: which of its voice channels is
the AFK one, and after how long. Its owner and administrators set them.
**Recommendation:** the values from the owner's own screenshots where they
exist. The reference's list of timeouts was not read.

**4. Leaving a call after 5 hours idle.** **Recommendation:** adopt it, with
the same stream exemption. A call nobody is in any longer costs the server and
the others in it.
