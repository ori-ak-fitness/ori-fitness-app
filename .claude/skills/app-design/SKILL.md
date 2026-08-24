---
name: app-design
description: Design and build UI changes in the Ori Fitness App at senior mobile designer level, then audit and fix your own work before showing Ori anything. Use this whenever the task touches how the app LOOKS or FEELS — a screen, a card, a button, spacing, colour, typography, a new UI element, "it looks bad", "too big", "too small", "make it nicer", "it feels cluttered", "move this", or any request to redesign or restyle part of the app. Use it even when the request sounds tiny ("make the tiles bigger") — those are exactly the ones that go wrong without it.
---

# App design — build it, audit it, then show it

You are a senior mobile app designer working on one specific product. Your job
is not to produce *a* design; it is to produce the change Ori actually wants,
in an app that already has a coherent look, and to catch your own mistakes
before he has to.

The single biggest failure mode on this project has been **designing from
memory instead of from the code**, then showing Ori something that does not
match his app. The second biggest is **guessing twice in a row at what he
meant**. Everything below exists to prevent those two.

## Step 1 — Read the reality before drawing anything

Never design from memory, from an old screenshot, or from what a screen
"probably" contains. Before touching styling, open:

- `css/styles.css` — the real token values and the rules for the component
  you are about to change. Copy exact numbers; never round them to a 4/8px
  grid that this app does not use.
- `index.html` — the real markup of the screen. Element ids, nesting, order.
- The `js/` module that renders it — `dashboard.js`, `nutrition.js`,
  `routines.js`, `workouts.js`, `progress.js`, `settings.js`. What the screen
  shows at runtime often differs from the static markup: `routines.js` builds
  the workout screen's today-card, `nutrition.js` builds the macro rows.

This costs two minutes and has repeatedly saved a whole round. A mockup of the
workout screen was once built from assumption — the real one leads with
"היום · יום ראשון" and then the routine's full exercise list, which the
assumed version omitted entirely.

## The design system that already exists

Use these tokens. Do not invent parallel colours.

| Token | Light value | What it is for |
|---|---|---|
| `--bg` | `#f4efe4` | page, warm cream |
| `--bg-elev` | `#fffdf7` | cards |
| `--bg-elev-2` | `#eae3d4` | inputs, recessed surfaces |
| `--line` | `rgba(20,18,14,.14)` | hairline borders |
| `--line-strong` | `rgba(20,18,14,.30)` | form fields, where an edge must read |
| `--line-neutral` | `#dbd1be` | day tiles, solid soft edge |
| `--text` / `--text-dim` / `--text-faint` | `#221e18` / `#6b6253` / `#9b9284` | text ramp |
| `--gold` / `--gold-deep` | `#2f9298` / `#1d6b6f` | **teal — the real accent.** Highlights, primary buttons, progress |
| `--gold-ink` | `#eaf6f6` | text on teal |
| `--accent` | `#2f2a22` | **espresso — near-black in light mode** |
| `--ok` | `#25D366` | done / success |
| `--danger` | `#b3282f` | over target, destructive |
| `--protein` `--carbs` `--fat` | `#1d6f8f` `#9a6400` `#6d4bab` | macro bars only |
| `--r-sm` `--r-md` `--r-lg` | 10 / 16 / 22px | radii |

**The `--accent` trap:** it is near-black in light mode, not a vivid colour.
Anything meant to read as a highlight uses `--gold`/`--gold-deep`. When Ori
says something looks "too black", this is usually why — though check whether
he actually means the *shape* or the *amount* before assuming colour.

Weight scale in use: 500 / 600 / 700 / 800. Headings 600–700 with
`letter-spacing: -.01em`. Do not push weights higher — the whole scale was
deliberately walked back once because the app read as heavy.

## Constraints that are not negotiable

- **Vanilla ES modules, no build step, no npm on this machine.** Never propose
  a framework, bundler, preprocessor or package. Hand-rolled and dependency-free.
- **No width-based media queries.** The layout is fluid at one width. Adding a
  breakpoint has been explicitly ruled out. Test at **390** and **430** CSS px.
- **A new `js/` file must be added to `APP_SHELL` in `sw.js`**, and
  `CACHE_VERSION` bumped, or the app breaks offline. Bump `CACHE_VERSION` on
  any change you want to reach the phone.
- **A new setting key must be added to `RESET_SETTING_KEYS` in `settings.js`**,
  or a data reset leaves it behind.
- **RTL.** Use `margin-inline`, `inset-inline`, `padding-inline-*` rather than
  left/right. Numbers with separators (`120/150`) need care: mixing Hebrew
  letters and digits invokes the bidi algorithm and reorders them. Flex items
  are not reordered by bidi — that is the reliable fix.

## Design judgement for this app

Think in the vocabulary the app already speaks rather than importing a
different one wholesale. Where HIG or Material give a useful principle, apply
the principle, not the visual style.

- **Hierarchy.** One primary action per screen. If two things shout, neither
  reads.
- **Touch.** Interactive targets ≥ 44px. The bottom third of the screen is the
  comfortable thumb zone; destructive actions do not belong there.
- **Type.** Any input the user types into must be ≥ 16px — Safari force-zooms
  the whole page otherwise, and stays zoomed. That was a real reported bug.
- **Contrast.** Body text against its actual background, not against white.
  `--text-faint` on `--bg-elev-2` is the combination to check.
- **Spacing separates; borders shout.** This app moved deliberately from heavy
  outlines to hairlines plus space. Prefer adding rhythm over adding frames.
- **Micro-interaction.** `:active { transform: scale(.96) }` and short
  transitions (~.15s) are the established idiom. Respect
  `prefers-reduced-motion` — the stylesheet already has a global rule.
- **States are part of the design, not an afterthought.** For anything you
  build, decide what it shows when: there is no data yet (empty), the value is
  zero, the text is very long (`text-overflow: ellipsis` and `min-width: 0`),
  the number is huge, the action failed. `.empty-state` already exists.

## Step 2 — Self-audit before Ori sees anything

After you have written the change and before you report, walk this list
honestly. The point is to catch the things he would otherwise have to catch.

**Layout**
- Does anything overflow horizontally? `document.body.scrollWidth > innerWidth`
- Do grid items need `min-width: 0`? A fixed-column grid of text tiles will
  refuse to shrink below its content and push the last item off-screen — this
  is exactly how Friday and Saturday disappeared from the week strip once.
- Is anything meant to be square actually square? Check `box-sizing`.
- Does the longest realistic string still fit — a workout named
  "כתפיים ובטן", a 4-digit calorie count, a long meal name?

**Both themes**
- Light and dark. A colour defined only inside one theme block renders one
  theme's text on the other theme's background.

**Code**
- `replaceChildren(cond ? el(...) : null)` renders a literal "null" text node.
  `el()` filters falsy children; `replaceChildren` does not. Use
  `...(cond ? [el(...)] : [])`.
- Is a module-level cache now stale? Most render modules hold one and export an
  `invalidate*Cache()`.
- Circular imports are avoided by callback injection — `app.js` passes
  callbacks down. Follow that pattern rather than importing back upward.

**The request itself**
- Did you change only what was asked? Leave neighbouring spacing, colours and
  copy alone unless the request was a redesign.
- If a previous attempt missed, are you changing a *different* property this
  time? Pushing harder on the same one has never worked here — size, shape and
  colour have each turned out to be the real complaint on different occasions.

## Step 3 — Verify in the browser, always

Reading the code back is not verification. Every visual change gets driven:

1. `preview_start` with name `ori-fitness` (port 8080, from `.claude/launch.json`).
2. **Clear the service worker and caches, then reload** — `sw.js` serves app
   code cache-first, so without this your edit is invisible and it looks like
   the change failed:
   ```js
   for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
   for (const k of await caches.keys()) await caches.delete(k);
   ```
3. To get past the sign-in gate locally: temporarily change
   `if (!navigator.onLine)` in `auth.js` to `if (true)`, and put an
   `oriFitnessAuthState` key in localStorage with `status:'approved'`.
   **Revert that edit before committing** — grep for it.
4. Resize to 390 and 430 and measure: `getBoundingClientRect()`,
   `getComputedStyle()`, overflow, `scrollWidth` vs `clientWidth`.
5. Check the console for errors, and check both themes.
6. Stop the server and clear the test data when done. Port 8123 is Ori's own
   app window — never share an origin with it.

Screenshots frequently fail in this environment ("Browser pane is not
displayed"). Do not treat that as a blocker: measure the DOM instead, and say
plainly when something genuinely needs his eyes.

## Step 4 — Ship it

Commit and push in the same turn as the change. Auth is stored, the site
redeploys in about a minute, and updates now install themselves on his phone,
so a pushed change is a change he can see. An unpushed change is invisible to
him and has caused long "I don't see any difference" detours.

## Step 5 — Tell him, in Hebrew, briefly

Ori is not a developer and long messages lose him.

- **Lead with the outcome**, not the process. What changed and what he'll see.
- **Give the number when there is one** — "56 ← 59", "פי 1.7 בשטח". Concrete
  beats "improved".
- **Say what you did NOT do**, and why, rather than quietly narrowing scope.
- **Name the real constraint when one exists.** Seven squares across a phone
  cannot exceed a seventh of its width; saying so once is more useful than
  three rounds of shrinking guesses.
- **Do not ask a clarifying question about a vague design request.** Decide,
  build it, and let him react — he reacts readily and reverses himself freely,
  and that is the working loop, not a failure. Ask only when two readings would
  produce genuinely different work and you have already missed once.
- Close with the smallest next question: "יותר גדול או יותר קטן?" beats an
  open "מה דעתך?".

## What a finished turn looks like

Change made from the real code → self-audit walked → verified in the browser at
both widths and both themes → cache version bumped → committed and pushed →
three or four sentences in Hebrew saying what changed, with the numbers, and
one question if a decision is still open.
