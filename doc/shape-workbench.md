# Shape brief: badge squirt page as a device-and-queue workbench

Confirmed 2026-09-12 via `/impeccable shape` (seed d612eeef, re-roll 1, card "workbench",
code-led). Visual world: Oat, inherited unchanged. Mode: Operate.

## Job and audience
Hobbyist badge owner at a laptop in Chrome, badge in hand, wants a picture or short
animation on it in under a minute. Success: the framed preview appears on the badge first
try with no surprise about fit or quality.

## Outcome and proof
Task: connect, frame, send. Proof is the encoded preview itself and honest hardware state.
The badge never acknowledges: "done" reads as "sent, badge should be updating", never
"confirmed".

## Selected direction
Two-region workbench.
* **Left rail = the hardware.** Connect, device details, a free-space gauge (Oat `<meter>`),
  then the picture queue with add/remove.
* **Right region = the work.** The round editor with zoom and quality; encoded preview at rest.
* **Bottom action bar.** Send stills, Send animation, frame time, progress. Always visible;
  sticky when the layout collapses.
* **Focal moment.** Adding pictures visibly fills the gauge, so "will it fit" is answered
  before Send.
* **Consequence.** The four current cards dissolve into rail, stage and bar. Components
  stay; layout plus a new gauge are the work.

## Scope and boundaries
Production-ready rebuild of the one page. Desktop first; single column under ~720 px with
the action bar sticky. Untouched: protocol/BLE layers, encode pipeline, Python tool, the 2–5
entry animation rule, debug log content. Anti-goals: no wizard, no onboarding overlay, no
theme beyond Oat variables, no phone-first work yet.

## States and ranges
Not connected (rail shows press-then-connect; gauge empty, "connect to see space");
connecting; connected; disconnected mid-session. Queue of 0, 1, 2–5, >5 (animation disabled
with reason). GIF entries of 8–100+ frames, hundreds of KB. Uploading with abort; failed;
done. Free space exceeded, with override.

## Interaction and layout
Rail reads "the device, then what's going to it". Gauge: **two segments**, used+queued as
one fill against free (decided). Selecting a queue row swaps the editor. Send buttons carry
eligibility in their labels. Progress lives in the bar. Debug log becomes a collapsible
drawer at the bottom, closed by default, **opens only by hand** (decided), open state
remembered.

## Constraints
Chrome/Edge, https or localhost, tsc-only ES modules, Oat from npm. PRODUCT.md governs.
