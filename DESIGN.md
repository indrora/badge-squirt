---
name: badge squirt
description: A hardware workbench for pushing pictures to a round BLE badge; Oat as shipped, one two-tone storage bar as the only colour that moves.
colors:
  background: "light-dark(#fff, #09090b)"
  foreground: "light-dark(#09090b, #fafafa)"
  card: "light-dark(#fff, #18181b)"
  primary: "light-dark(#574747, #fafafa)"
  primary-foreground: "light-dark(#fafafa, #18181b)"
  secondary: "light-dark(#f4f4f5, #27272a)"
  secondary-foreground: "light-dark(#574747, #fafafa)"
  muted: "light-dark(#f4f4f5, #27272a)"
  muted-foreground: "light-dark(#71717a, #a1a1aa)"
  faint-foreground: "light-dark(#a1a1aa, #71717a)"
  accent: "light-dark(#f4f4f5, #27272a)"
  border: "light-dark(#d4d4d8, #52525b)"
  ring: "light-dark(#574747, #d4d4d8)"
  success: "light-dark(#008032, #6cc070)"
  warning: "light-dark(#a65b00, #f0a030)"
  danger: "light-dark(#d32f2f, #f4807b)"
  panel-black: "#000"
typography:
  title:
    fontFamily: "system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)"
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.5
  numeral:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  numeral-small:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tabular-nums"
  log:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
rounded:
  medium: "0.375rem"
  full: "9999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  6: "1.5rem"
  8: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.ui}"
    rounded: "{rounded.medium}"
    padding: "0.5rem 1rem"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.ui}"
    rounded: "{rounded.medium}"
    padding: "0.5rem 1rem"
  button-outline-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.ui}"
    rounded: "{rounded.medium}"
    padding: "0.5rem 1rem"
  button-ghost-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.ui}"
    rounded: "{rounded.medium}"
    padding: "0.5rem 1rem"
  tag-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.numeral-small}"
    rounded: "{rounded.full}"
    padding: "0.25rem 1rem"
  queue-row:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.medium}"
    padding: "0.25rem 0.5rem"
  queue-row-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.medium}"
    padding: "0.25rem 0.5rem"
  action-bar:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.medium}"
    padding: "0.75rem 1rem"
  log-pane:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.log}"
    rounded: "{rounded.medium}"
    padding: "0.75rem"
  preview-stage:
    backgroundColor: "{colors.panel-black}"
    rounded: "{rounded.full}"
    size: "368px"
---

# Design System: badge squirt

> **Token authority.** Oat (`@knadh/oat`, npm) is the token authority for this project: every
> colour, spacing step, radius, font stack, text size and transition above is Oat's own
> `01-theme.css` value, inherited unchanged. This file is not a second token set. It records how
> the product uses Oat: the workbench grid, the rail, the storage-gauge semantics, the mono-numeral
> rule, the colour-that-moves rule, the one authored motion, and the drawer. The only value that
> is not Oat's is `panel-black`, and it exists because the badge's panel is black.

## Overview

**Creative North Star: "The Lit Workbench"**

badge squirt is a hardware workbench, not a form. The badge and its storage sit on the left,
the picture sits on the stage, one bar of verbs runs along the bottom. It refuses the stack of
same-size cards: there is exactly one framed surface on the page (the action bar) and it is
framed because it is sticky and has to read as a surface when it floats over the page. Everything
else is separated by hairline dividers and whitespace, so the rail reads as one column of hardware
facts rather than a pile of widgets.

Colour follows the system. Oat's `light-dark()` neutrals mean the page is light on a light desk
and dark on a dark one, and the scene is a lit desk with a badge in hand, so the app never forces
dark. Chroma is rationed: one primary for the leading verb, and one `<meter>` whose fill is the
only colour that moves. Every measurement (KB, px, ms, frames, seconds, quality) is set in
tabular monospace so numbers line up and never jitter as they change.

Density is workbench density: 14 px UI text, 12 px numerals, quarter-rem row gaps in the queue,
and the round preview at the badge's real pixel size (368 px) so the crop on screen is the crop
the badge shows.

**Key Characteristics:**
- Two-region grid (320 px rail + fluid stage) with a full-width sticky action bar and a closed
  drawer beneath; single column under 720 px.
- Oat's palette as shipped; no project colours beyond the badge panel's black.
- Hairline (1 px `border`) dividers between rail sections; borders, not cards, do the separating.
- Tabular monospace for every number the hardware or the encoder reports.
- The storage bar's queued span is the only element whose colour changes with state.
- One authored transition (the storage bar's spans), honouring `prefers-reduced-motion`.

## Colors

Oat's light-dark neutral ramp with a single warm-grey primary; semantic colours appear only where
the hardware state demands them.

### Primary
- **Warm Slate** (`primary`): the leading verb only. "Connect badge" before connection and
  "Send…" in the action bar are the two primary buttons on the page; once connected, Connect
  becomes "Disconnect" and drops to secondary so Send is the only primary left. Also the
  `::selection` colour and the fill of the upload `<progress>` bar (Oat default).

### Neutral
- **Page** (`background`) and **Ink** (`foreground`): body and text. Follow the system colour
  scheme via `color-scheme: light dark`.
- **Card** (`card`): the action bar's surface, the one framed panel on the page.
- **Secondary** (`secondary` / `secondary-foreground`): every non-leading button ("Add
  pictures…", "Send as animation", "Disconnect", "reset", "clear") and the status tags ("sent",
  "showing encoded JPEG").
- **Muted** (`muted`): the empty track of meter and progress bars, the debug log pane background,
  the summary hover.
- **Muted Ink** (`muted-foreground`): ritual copy, hints, status lines, `<dt>` labels, the footer,
  the drawer summary, and the queue-row remove button at rest.
- **Faint Ink** (`faint-foreground`): the drawer summary's subtitle only.
- **Accent Wash** (`accent`): the selected queue row's background and ghost/outline button hover.
- **Hairline** (`border`): rail dividers, the preview's dashed empty ring, queue-row hover ring,
  the action bar and drawer frames, thin scrollbar thumbs.
- **Ring** (`ring`): `:focus-visible` outline (2 px, 2 px offset) and the selected queue row's
  border.
- **Panel Black** (`panel-black`): the round preview stage and queue thumbnails. The badge's panel
  is black when unlit; the black behind a picture on screen is the black behind it on the device.

### Semantic (state only)
- **Success / Warning / Danger** (`success`, `warning`, `danger`): the meter fill bands (healthy,
  past 90 %, over capacity); the over-capacity caption; the remove "x" on hover/focus; the Abort
  ghost button; the no-Web-Bluetooth alert. Never decorative.

### Named Rules
**The One Colour That Moves Rule.** The storage bar's queued span is the only element on the page whose
colour changes with state (success → warning past 90 % → danger when the queue would overflow).
No other element animates or shifts hue to signal state; text says it instead.

**The Quiet Danger Rule.** Danger is latent, not resting. The remove button is `muted-foreground`
at rest and turns `danger` only on hover or focus; Abort is a ghost danger button and is hidden
until an upload is running.

**The Leading Verb Rule.** At most one primary-filled button per region. When Connect succeeds it
demotes itself to secondary so Send is the only primary on the page.

## Typography

**Body Font:** system-ui (with sans-serif)
**Numeral / Mono Font:** ui-monospace (with Consolas, monospace)

**Character:** Oat's shipped system sans, used at UI size; the monospace is not a decoration but a
measurement instrument. The pairing reads like a bench with a label maker and a multimeter.

### Hierarchy
- **Title** (`title`; Oat `--text-3`, 1.25–1.5 rem, line-height 1.25, tracking −0.01 em): the
  lowercase wordmark "badge squirt" in the header. The only heading on the page; there is no
  display tier.
- **Body** (`body`; 1 rem / 1.5): Oat's default, effectively only inherited by the status lines
  that are not sized down.
- **UI** (`ui`; `--text-7`, 0.875 rem): the working size. Ritual copy, hints, button labels,
  slider labels, `<dt>`s, the drawer summary, the header tagline, queue entry names.
- **Label** (`label`; `--text-7`, semibold 600): rail section titles ("Badge storage", "Queue").
  Sentence case, no tracking, no uppercase.
- **Numeral** (`numeral`; mono, `--text-7`, tabular): device readout values in the connect `<dl>`
  (name, panel size, pacing, ID) and slider `<output>`s.
- **Numeral Small** (`numeral-small`; mono, `--text-8`, 0.75 rem, tabular): the gauge caption,
  queue-row meta ("18.0 KB · q0.70"), the encoded-size readout under the preview, and the progress
  text in the action bar.
- **Log** (`log`; mono, `--text-8`, line-height 1.35): the debug drawer's `<pre>`.

### Named Rules
**The Tabular Mono Numeral Rule.** Every measurement the hardware or the encoder reports (KB, px,
ms, frames, seconds, q-values, hex IDs) is set in `--font-mono` with `font-variant-numeric:
tabular-nums`. Numbers that change must not shift their neighbours; the slider `<output>`s reserve
`min-width: 2.6em` and the readout row reserves `min-height: 1.6em` for the same reason.

**The One Heading Rule.** The wordmark is the only heading. Rail sections are titled with a
semibold `--text-7` span, not an `<h2>`, so the rail reads as labelled facts, not a document.

## Layout

The page is one CSS grid, `.workbench`, capped at 1100 px and centred, with `--space-4` (1 rem)
gutters and grid gap. Columns are `var(--rail) minmax(0, 1fr)` where `--rail: 320px`. Areas, top
to bottom: `head head` / `rail stage` / `bar bar` / `drawer drawer` / `foot foot`.

- **Head:** wordmark and tagline on one baseline-aligned flex row, wrapping.
- **Rail (320 px):** a vertical grid with `--space-6` (1.5 rem) between sections. Each section is
  itself a grid with `--space-3` gaps; sections after the first carry a 1 px top hairline and
  `--space-4` top padding. Order is fixed by the story: connect (ritual copy, button, status,
  device readout), storage gauge, queue. The queue list scrolls inside a 420 px max height.
- **Stage:** centres its content; the 368 px round preview sits at the top with `--space-4`
  padding, controls stacked beneath in centred rows (`mt-4`, `mt-2`).
- **Action bar:** spans both columns, `position: sticky; bottom: 0`, `--space-3 --space-4`
  padding, Send leading at the left, the free-space override pushed to the right edge from
  900 px up.
- **Drawer:** spans both columns beneath the bar; Oat's `<details>` accordion, closed by default,
  opens only by hand.
- **Footer:** centred, `--text-8`, muted, `--space-4` above and `--space-8` below.

**Responsive:** below 720 px the grid collapses to one column in the order head, rail, stage, bar,
drawer, foot; the action bar loses its bottom radius and bleeds to the viewport edges
(`margin-inline: -1rem`) so it reads as a docked toolbar; the progress row stacks. The preview
keeps its 368 px box but `max-width: 100%` lets it shrink on a 375 px phone.

**Spacing rhythm:** Oat's quarter-rem scale. In use: 1 (row gaps, `<dl>` row gap), 2 (inline gaps
inside labels, gauge stack), 3 (section internals, bar padding, log padding), 4 (grid gap, page
gutter, section top padding), 6 (between rail sections), 8 (footer bottom). Steps 5, 10–18 are
unused.

## Elevation & Depth

Flat by default. Depth is conveyed by hairlines and tonal layering (`muted` pane on `background`,
`card` bar on `background`, `accent` wash on the selected row), not by shadow. Exactly one shadow
exists: the sticky action bar casts a soft upward shadow so it reads as a surface when it floats
over scrolled content. Oat's own button borders use translucent white/black edges for a faint
bevel; that is Oat as shipped, not a project choice.

### Shadow Vocabulary
- **Bar lift** (`box-shadow: 0 -6px 18px -12px rgb(0 0 0 / .35)`): the action bar only. Large
  negative spread keeps it diffuse; it must never read as an offset or hard-edged shadow.

### Named Rules
**The Hairline Rule.** Separation is a 1 px `border` line or whitespace. Do not introduce a card to
separate content; the action bar is framed because it floats, and it is the only one.

## Shapes

Two radii. Oat's medium radius (0.375 rem) on buttons, queue rows, the action bar, the drawer and
the log pane. Full radius (9999 px / 50 %) on the meter and progress tracks, the status tags, the
44 px queue thumbnails and the 368 px preview stage, because the badge is round and everything
that stands for a picture on it is round too.

The empty preview is a 2 px dashed `border` ring; once a picture is loaded the ring goes solid. The
drop ring is the badge outline; the dash means "nothing here yet". Buttons are Oat's: 1 px bevel
border, medium radius, `--space-2 --space-4` padding, no pill buttons.

## Components

### Buttons
Oat's buttons unchanged; the project only chooses variants.
- **Shape:** medium radius (0.375 rem), 1 px translucent bevel border, `0.5rem 1rem` padding,
  `--text-7` medium weight.
- **Primary:** `primary` on `primary-foreground`. Connect (before connection) and Send. Send's
  label carries its eligibility ("Send 1 still + 1 animation"), and its `title` names the reason
  when disabled.
- **Secondary:** `secondary` fill. Disconnect, Add pictures…, Send as animation.
- **Outline secondary:** transparent, `border` colour stroke. reset, clear.
- **Ghost:** transparent, no border, `muted-foreground` ink. The queue remove "x" (inline 14 px
  stroke SVG, `currentColor`), turning `danger` on hover/focus. Abort is ghost + danger.
- **Hover / Active / Focus:** Oat's `color-mix` lighten/darken over 120 ms, 1 px translate on
  press, and the project's 2 px `ring` outline offset 2 px on `:focus-visible`.

### Storage Gauge (signature)
A `role="meter"` track (0.75 rem, full radius, `muted` ground) carrying two spans, under a two-line
head: "Badge storage" as an `h2` and a mono tabular caption ("11260 KB on the badge · 150 KB queued
· 4974 KB free"). Two colours by decision (2026-09-13): what is on the badge **now** is a fact and
fills in `muted-foreground`; what is **queued** is the thing about to change and takes the accent
`--queued`, which is `success` when healthy, `warning` once used+queued passes 90 %, and `danger`
when it would not fit (the caption then turns `danger` semibold and says by how much). The queued
span is hatched (`repeating-linear-gradient` 135°, 4 px on / 4 px at 55 %) so colour is never the
only code, and keeps `min-width: 6px` whenever non-zero, because at real capacities a true-scale
25 KB sliver on a 16 MB bar would be invisible. A legend under the track names both keys. Before
connection both spans are 0 and the caption says "connect to see space". Both spans ease their
width over 240 ms (`cubic-bezier(.2,.8,.2,1)`), the page's only authored motion, disabled under
`prefers-reduced-motion`; on send, queued collapses as used grows.

### Queue Rows
A `44px minmax(0,1fr) auto` grid per row: round thumbnail on `panel-black`, name on the first line
(ellipsised, with an optional secondary tag such as "sent" or "8 frames · 210 ms"), mono meta on
the second, ghost remove button spanning both rows. Rows have a transparent 1 px border at rest,
`border` on hover, and `ring` border plus `accent` wash when selected. Gap between rows is
`--space-1`.

### Preview Stage (signature)
A 368 × 368 px circle (the badge's reported panel size; honour it) on `panel-black`, 2 px dashed
`border` ring when empty and solid when loaded, `overflow: hidden` so the canvas shows exactly the
crop the badge will. Grab/grabbing cursors when loaded. Beneath: centred rows of `--text-7` labels
with 180 px range inputs and mono `<output>`s, then a reserved readout line and the "showing
encoded JPEG" secondary tag.

### Action Bar (signature)
`card` surface, 1 px `border`, medium radius, bar-lift shadow, sticky to the viewport bottom. Row
one: Send (primary), Send as animation (secondary) with its frame-time slider and mono output,
Abort (ghost danger, hidden at rest), the free-space override checkbox pushed right. Row two: an
Oat `<progress>` (primary fill) with a right-aligned tabular status line that ends every upload
with "the badge should be updating (it never confirms)".

### Drawer
Oat's `<details>` accordion as shipped (1 px `border`, medium radius, SVG chevron, `muted` hover).
The summary is sized down to `--text-7` in `muted-foreground` with a `faint-foreground` subtitle.
Inside: an outline-secondary "clear" button, a checkbox, and the log pane: `muted` background,
medium radius, `--space-3` padding, mono `--text-8` at 1.35 line-height, 260 px max height,
`pre-wrap` with `break-all`.

### Inputs
Oat defaults. Range inputs are 180 px wide in the stage; checkboxes sit inline in `--text-7`
labels. Focus is the global 2 px `ring` outline.

## Do's and Don'ts

### Do:
- **Do** use Oat's variables for every colour, size and radius; the project stylesheet introduces
  no new tokens except `--rail` and the badge's `panel-black`.
- **Do** set every measurement in `--font-mono` with `tabular-nums`, and reserve width or height
  where a number will change so neighbours never shift.
- **Do** separate rail sections with a 1 px `border` hairline and `--space-4` top padding, not a
  card.
- **Do** keep the preview at the badge's reported pixel size (368 px) and round; what you see is
  what the badge gets.
- **Do** let the `<meter>` carry state colour through its own `low`/`high`/`optimum` bands and put
  the exact numbers in the caption beside it.
- **Do** honour `prefers-reduced-motion` on any transition you add; the meter fill already does.
- **Do** put the eligibility of a verb in its label and the reason it is disabled in its `title`.

### Don't:
- **Don't** force dark mode or add a theme toggle; the page follows the system via Oat's
  `light-dark()` neutrals.
- **Don't** animate or recolour anything other than the storage meter to signal state; text does
  that job.
- **Don't** add a second primary-filled button to a region; demote the previous leading verb to
  secondary instead.
- **Don't** stack cards. The action bar is the only framed panel, and it is framed because it
  floats.
- **Don't** add shadows beyond the bar lift, and never a hard or offset shadow.
- **Don't** use `danger` at rest on a control; danger appears on hover, focus, or while an
  operation is running.
- **Don't** add headings inside the rail; section titles are semibold `--text-7` spans.
