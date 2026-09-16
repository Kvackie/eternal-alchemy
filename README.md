# Eternal Alchemy

A cozy fantasy potion shop for web and mobile. Grow it, raise it, dig it up or send someone braver
to fetch it — then match essences in the cauldron, bring it to temperature, seal it well, and price
it right.

**M1 — the vertical slice.** Plant → tend → harvest → brew → bottle → seal → stock → price → sell,
including while the app is closed.

**M2 — the other sources.** Merchants, renown ranks and bought equipment; a mushroom cave that
spreads on its own; a mining shaft that depletes and deepens; heroes who take your own potions on
expeditions; and a contract board.

**M3 — depth.** Face-to-face haggling; the greenhouse and crossbreeding; the full bottling range
(10 forms, 8 vessels, 7 seals); ranks V–X; and the Long Distillation with its Mastery Codex.

Design document: `docs/design.html` (open it in a browser). It is the design record rather than a
description of the build — it still describes the alembic wheel that M1's rework replaced, among
other things. It opens with a status panel listing exactly where it and the code have parted company;
this README is the accurate account.

## Running it

```
npm install
npm run dev        # http://localhost:5173
```

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server, with the debug panel enabled |
| `npm run build` | Type check, then production bundle into `dist/` |
| `npm run preview` | Serve the production bundle |
| `npm test` | Run the simulation test suite |
| `npm run test:watch` | The same suite, watching |
| `npm run typecheck` | Type check without building |
| `npm run android:sync` | Build, then copy `dist/` into the native project |
| `npm run android:apk` | Sync, then Gradle a debug APK (Windows — see `ANDROID.md`) |
| `npm run android:open` | Open the native project in Android Studio |
| `npm run android:run` | Sync, then launch on a device or emulator |

## How it's put together

The one structural rule: **the simulation never imports the engine.**

```
src/
  sim/        Pure TypeScript. Every rule in the game. No Phaser, no DOM, no wall clock.
  data/       JSON. Every tunable number, so balance is diffable in git.
  i18n/       Every user-facing string, keyed. No literals in game code.
  ui/
    phaser/   The world: garden, pot, shelves, day/night lighting.
    dom/      The panels: eight screens of lists, forms and prices, plus the
              brewing station and the overlays a tile opens.
  platform/   Save adapters (localStorage now, Capacitor Preferences on mobile).
  debug/      The time panel. Dev builds, or `?debug=1` on a built copy.
```

Eight screens: **Shop** (shelves and bottled inventory) · **Board** (contracts) · **Market**
(merchants) · **Grounds** (garden, cave and shaft as sub-tabs) · **Cauldron** (all alchemy) ·
**Roster** (heroes and missions) · **Ledger** (statistics and a paginated event log) · **Settings**.

Two of them draw a world behind the panel and can be panned and zoomed: **Shop** and **Grounds**.
The rest are documents. The Market was among them until it wasn't: it had no art of its own and
borrowed the Shop's, which drew your own shelves behind another trader's stock — one picture
claiming to be two places.

## The four ways ingredients arrive

Each source gets a different *verb*, or they are four timer farms wearing different art.

| Source | Verb | Yields | Character |
| --- | --- | --- | --- |
| **Garden** | cultivate | Herbs | You choose exactly what grows. Low potency, ages. |
| **Cave** | tend | Fungi | You seed a bed; mycelium spreads on its own. Light steers which species wins. |
| **Shaft** | extract | Minerals | Veins deplete and you dig deeper. Highest potency, never ages. |
| **Heroes** | send | Reagents | The only route to the rarest things — and they eat your potions to get there. |

Minerals carry the most essence per unit, which is what makes a large cauldron reachable at all, and
they are far too coarse to steer a ratio with. A good high-tier brew is minerals for mass and herbs
for correction.

## Merchants, ranks and equipment

**Renown is permission; gold is acquisition.** A rank never hands you a capability — it makes one
appear in a merchant's stock, and you still pay. Equipment shows up one rank early, greyed with the
reason, so you learn what a rank is *for* before you reach it.

Merchant presence *and stock* are derived from the world clock — a merchant is in town on the days
their cycle lands on, and their goods come from an RNG seeded on `(merchant, day)`. Nothing about a
visit is stored except what you have already bought, so offline catch-up needs no special handling
and a reload cannot reshuffle the shelves.

Bramm, Vessa and Hesk keep daylight hours. **The Ashwalker trades only at night, and takes no gold** — his
prices are sealed potions of a minimum grade, and he spends your cheapest qualifying bottles first.

## Heroes and contracts

Heroes consume **your own potions** as expedition supplies. That is the loop closing: your product
becomes an input, and you have a reason to brew things you would never sell.

Nobody dies and nobody quits. A mission never fails outright — it returns Bountiful, Successful or
Meagre, with an independent injury roll — and favour never falls below its floor. An unsupplied
return still earns something, because keeping a hero's regard must not require spending potions on
them; that would be a toll, not a relationship.

Contracts pay better than the shelf if you can meet the terms. Two mercies are deliberate:
**deadlines only run down while you are present**, so a weekend away never costs one, and **partial
delivery** pays pro rata with no reputation hit.

Three things follow from keeping `sim/` headless:

**Offline progress is the same code as online progress.** `sim.advanceTo(now)` runs on every frame
and on resume from a three-week absence. There is no second implementation to drift out of sync.

**The rules are testable without a renderer.** Given this cauldron, assert this grade. Given 72 hours
away, assert this gold.

**Randomness is seeded and serialised.** Offline catch-up replays time the player never watched, so
`Math.random` would make the same save produce different money twice. Every draw comes from `sim/rng.ts`,
and the seed lives in the save.

### Why Phaser for the world and DOM for the panels

A shop management game is mostly text and lists. DOM gives us text layout, scrolling, screen readers,
and the 85–150% text scaling setting for free — each of those would be a week of work on canvas. The
canvas gets what it's good at: the garden, the pot, the shelves, the lighting. The two halves never call
each other; they talk to the simulation and to `ui/bus.ts`.

## Recipe discovery

Two recipes are known at the start; the other 194 are found by brewing them. Accepting a pot whose
ratio and method match an unknown recipe puts it in the book — and then you have to find its
temperature.

**The book never shows a band you haven't found.** It shows the bounds *you* established: brew too
cold and it records "hotter than 120"; too hot and "colder than 200"; the entry reads as a range you
close by bisecting it. Hit the band once and it is yours for good. Step 3 says only "Too cold" or
"Too hot" until then — the exact distance is the answer.

Only **accepting** teaches. Rejecting stays free precisely so experimenting is free, and a rejected
pot that leaked the answer would make the free option strictly better than committing to one.

This is what replaces the skill the alembic wheel took with it when it was cut: discovery rather than
dexterity. *Deft Hands* in the Codex now widens the band you have to hit rather than granting an
action to a minigame that no longer exists.

## Brewing

A potion is three things at once, and the cauldron screen is three numbered steps plus bottling —
all on one page, because they are one continuous act.

**1 · Ingredients.** Tap or drag them into the pot. The blend's essence totals and the capacity meter
update as you go. Nothing is spent yet.

**2 · Prepare.** Bring the pot to temperature — hold Heat or Chill to ramp, tap for a single step, and
it drifts slowly back toward the room if you leave it. Then choose **Stirred** or **Simmered**.

**3 · Outcome.** What you would make right now, with its grade and the three numbers behind it.
**Accept** spends the ingredients and starts the brew timer; **Pour it back** returns every ingredient
unchanged.

Then **Bottle** — form, vessel, seal — once the timer finishes.

How the three parts of a recipe behave is deliberately different:

| Part | Miss it and… |
| --- | --- |
| **Ratio** | You are making something else. Outside every recipe's tolerance is Murk. |
| **Method** | You are making something else entirely — simmering a tonic doesn't make a bad tonic. |
| **Temperature** | You are making the right thing badly. Purity falls in proportion to the miss. |

Recipes state their band as numbers (`140–175°`), so finding the right heat is something you can
experiment toward. That only works because rejecting is free — nobody experiments when trying costs
ingredients.

## Debug panel

On by default in `npm run dev`. A built copy leaves it out — it grants gold and skips days, so it is
not something every visitor to the deployed site should find — but `?debug=1` opts a browser in and
is remembered, and `?debug=0` opts back out. It is imported dynamically either way, so a build
nobody has asked it for never downloads it. A crop takes eighteen hours and a contract runs eight
in-game days, so this is not optional tooling.

Time scale ×1–×600 · jump to dawn/dusk/night · skip a day · **simulate being away** (runs the real
resume path) · finish all timers · grant gold, renown and ingredients · pin the RNG seed so a bug
reproduces exactly.

## Placeholder art

Generated at runtime from the game's own data — ingredient badges tinted by dominant essence and
stamped with that essence's glyph, bottles tinted by the potion's blend, plots and pots as shapes.
Composition and silhouette are final; only the rendering isn't. In M4 this becomes a build step
writing an atlas, and nothing else changes.

## Commitments held from day one

**Colour is never the only signal.** Each of the five essences has a glyph — triangle, droplet,
square, chevron, crescent — used everywhere the colour is.

**Text scales 85–150%** on top of the device setting, which is the practical reason panels are DOM.

**Every string is keyed** in `src/i18n/en.json`, formatted through `Intl`, with layouts assuming
+40% string length. English ships first; adding a language is a translation contract, not an
engineering project.

**Nothing is lost.** Untended crops still yield. Nothing wilts. Sealed goods never degrade. Rejecting
a brew returns every ingredient. A pot left mid-preparation keeps its contents, its temperature and
its method across a reload, and a save from an older schema is migrated rather than dropped.

## Haggling

Rock-paper-scissors against a stance the customer telegraphs. Each pitch family counters exactly one
stance and backfires against exactly one other, and the backfires are thematic rather than arbitrary
— lecturing a noble, flattering someone in a hurry, offering a freebie to a sceptic. You can reason
your way to the right move the first time instead of memorising a grid.

Landing a counter **forces a stance change**, so you are reading a moving target and can never mash
one button. Every button shows how it will land *before* you press it. **Hold firm** sits outside the
triangle: it converts accumulated interest straight into price, worthless early and decisive once two
counters have landed.

Patience hitting zero ends the haggle at the customer's last standing offer, and a refused price
costs you the visit, never the stock.

## Crossbreeding

The long-tail hook. Two parents produce a seed whose essence sits **midway between them**, so
repeated crossing walks a lineage toward a ratio no wild plant can hit. A cross sometimes throws a
mutation — Potent, Pure, Twinned or Volatile — that neither parent had.

A strain is the one kind of content the player makes rather than finds, so it lives on the save
rather than in the data files, and it carries its own essence all the way into the pot. A bred line
drops its own seed on harvest, so it can be replanted forever.

## Prestige — the Long Distillation

At the top rank you may retire and open a new shop. Everything goes except **Mastery**, earned from
lifetime renown at the moment you retire (square root, so the first run is not worthless and the
tenth is not absurd) and spent in a Codex that never resets. Each town carries a modifier that
reshapes which gathering site carries the run, so the Codex nodes you bought get tested differently
each time.

Prestige is always optional. The top rank with no reset is a complete game.

## Playing it in a browser

The game is a static site. Nothing runs on a server — the simulation, the save and every asset live
in the page — so `dist/` can be dropped onto any static host as-is.

`.github/workflows/pages.yml` builds it and publishes it to GitHub Pages on every push to `main`. It
needs Pages switched on once, under **Settings → Pages → Build and deployment → Source: GitHub
Actions**; after that the site lands at:

```
https://kvackie.github.io/eternal-alchemy/
```

That subpath is why `vite.config.ts` sets `base: './'` and why `ui/art.ts` returns relative paths
like `art/potion/x.png`: every reference resolves against the document, so the same build works at a
repo subpath, at a domain root, and inside the Capacitor WebView without a rebuild.

Two things follow from the save living in `localStorage`. It is **per-browser and per-origin** — the
Pages save and a local `npm run dev` save are different games, and a browser that clears site data
clears the shop. And the site is public: anyone with the link plays their own copy, starting from
day one.

## Mobile

`capacitor.config.json` is in place, and `platform/storage.ts` picks the save backend at runtime: the
web build uses `localStorage`, a native build uses Capacitor Preferences — which survives an OS cache
clear that would wipe `localStorage`. For a local-only save that difference is the difference between
keeping a forty-hour game and losing it.

The plugin is reached through the **injected `Capacitor.Plugins.Preferences` global**, not an
`import`, so Capacitor never enters the web bundle and TypeScript never tries to resolve a bare
specifier a browser could not load either. The packages are already in `package.json` — `cap sync`
reads them to install the native half — so a native build is:

```
npx cap add android    # and/or ios; the generated project is gitignored
npm run android:sync   # build, then copy dist/ into the native project
```

`ANDROID.md` has the toolchain, the APK path and what is still untested.

Checked across all eight screens on both layouts, at 85, 100 and 150% text, on a 412x883 viewport:
**no horizontal page scroll, and no text clipped or broken mid-word.** Both are swept by measurement
rather than by eye — every leaf element's longest word against the box it has — so a regression shows
up as a number.

Tap targets are tiered rather than uniform, and the honest version is worth stating: the primary
controls carry a 44px floor through `--tap` — the nav, `.btn`, tiles, options, and the tavern's
filter chips on a touch pointer. `.btn.small`, the secondary action inside a row, is 36px.
`.view-button` is 32px. The info badge in the corner of a tile is 18px and sits *inside* a tile that
is itself the 44px target, so it is an extra rather than the only way in. A sweep at 100% text counts
22 controls under 44px in one dimension, all of them from those three classes.

Below the 960px breakpoint the screens that draw no scene — Market, Roster, Board, Settings — are
full-stage pages rather than bottom sheets, and they are the only scroller on the page: a section
that scrolls inside a panel that scrolls inside a phone is a section that takes the flick and gives
nothing back. The two that *do* draw one — Shop and Grounds — take turns instead, because 412x883 is
not enough for a shop and the managing of it at once. The toggle in the view controls
names the screen rather than the mechanism (**View Shop** / **Manage Shop**), and each half gets the
whole stage: managing hides the scene entirely, and the zoom and recentre buttons go with it. Nothing
is lost by hiding it — nothing in the world is clickable, so the scene is a picture.

Above the breakpoint the toggle is hidden: the panel and the scene already fit side by side.

## What's not here yet

Audio is out of scope behind a silent bus stub. Saves are local only. The **art pipeline** is
specified in the design doc but unbuilt — it needs actual assets to be worth writing, and no native
build has been compiled or tested on a real device.

## The balance harness

`tests/balance.test.ts` is not a correctness suite — it is a set of **measurements** that fail when a
number drifts outside a range we decided was sane. The sim core is headless and deterministic, so
rather than guessing at balance we play thousands of hours of it and read the results.

When one of these fails, the right response is usually to look at the number and decide, not to
reach for the assertion.

It found four things on its first run, two of them real bugs:

| Finding | Outcome |
| --- | --- |
| One seeded cave bed carpeted all twelve overnight | Spread rate cut; the cave now rewards neglect without replacing the garden |
| A single ingredient graded S | Top grades tied to potency — a trivial brew now caps at C |
| Contracts appeared to pay *less* than the shelf | My test compared against a hardcoded price; the real ratio was correct at 1.55× |
| Renown reached rank 6 in a week | Measures an impossible ceiling (free restocks, perfect uptime); relabelled |

It also checks the recipe book against itself: that no two same-method recipes have overlapping
tolerance cones (which would make one of them unreachable), that every band is within the cauldron's
range, and that **every recipe has an ingredient pointing at it**. That last one caught the
Cinderveil Bomb shipping with nothing gatherable within 46° of it, before it ever reached the game.

And it checks that **nothing sold is inert**. Five upgrades and half the Mastery Codex once took the
player's gold and did nothing — the effect plumbing existed and the far end was never connected. The
harness measures outcomes, so it never noticed. There are now three checks it cannot pass while
disconnected: no equipment may declare an empty effect, buying any piece must change the derived
stats, and buying any Codex node must change the bonuses. Plus a behavioural test that each
previously-dead bonus does something observable in play.
