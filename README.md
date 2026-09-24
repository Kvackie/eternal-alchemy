# Eternal Alchemy

A cozy fantasy potion shop for web and mobile. Grow it, raise it, dig it up or send someone braver
to fetch it — then match essences in the cauldron, bottle it, and price it right.

**M1 — the vertical slice.** Plant → tend → harvest → brew → bottle → stock → price → sell,
including while the app is closed.

**M2 — the other sources.** Merchants, renown ranks and bought equipment; a mushroom cave that
spreads on its own; a mining shaft that depletes and deepens; heroes who take your own potions on
expeditions; and a contract board.

**M3 — depth.** Face-to-face haggling; ranks V–X; and the Long Distillation with its Mastery Codex.
(The greenhouse, bottle forms, and a range of eight vessels and seven seals shipped here too, and
were all taken out again: bottling is one press now.)

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
| `npm run format` | Format every file with Prettier |
| `npm run format:check` | Fail if any file is not formatted — the deploy runs this |
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
  debug/      The time panel. Dev builds, or switched on in Settings.
```

Eight screens: **Shop** (shelves and bottled inventory) · **Board** (contracts) · **Market**
(merchants) · **Grounds** (garden, cave and shaft as sub-tabs) · **Cauldron** (all alchemy) ·
**Roster** (heroes and missions) · **Ledger** (statistics and a paginated event log) · **Settings**.

Two of them draw a world behind the panel and can be panned and zoomed: **Shop** and **Grounds**.
The rest are documents. The Market was among them until it wasn't: it had no art of its own and
borrowed the Shop's, which drew your own shelves behind another trader's stock — one picture
claiming to be two places.

## What a tap on a tile means

The same thing everywhere: **it tells you what the thing is.**

It used to depend on where you were standing. In the market a tap spent money — one unit, at once,
so a stack of twelve was twelve taps and you could not look before you leapt. In the garden it
selected a seed. The only route to what something actually *did* was an 18px dot in the corner of the
tile, which is a hard thing to hit and an easy thing never to notice.

So the tile opens the details, and the details carry the verb: **Buy** with a count beside it and the
total it will cost, **Plant this** for a seed, **Seed this** for a spore. The count is bounded by the
stock and by the purse, so the stepper cannot offer a number the button behind it would refuse.

A board or a furnishing says what it does in sentences rather than badges — what it does to appeal,
to footfall, to a haggler's ceiling — each line read off the definition, so it cannot drift from the
arithmetic.

## The four ways ingredients arrive

Each source gets a different *verb*, or they are four timer farms wearing different art.

| Source | Verb | Yields | Character |
| --- | --- | --- | --- |
| **Garden** | cultivate | Herbs | Every herb grows. Weakest, and ages. |
| **Cave** | tend | Fungi | Every fungus spreads here. You seed a bed; mycelium spreads on its own. Ages twice as fast as a herb. |
| **Shaft** | extract | Minerals | Every mineral is somewhere down it: a new one every five metres, strongest deepest. Never ages. |
| **Heroes** | send | Exotics, and most of the rest | The only route to the exotics, and a source of most other ingredients, seeds and spores — but they eat your potions to get there. |

There are 151 ingredients, and every amount of essence in them sits on one scale: 4, 6, 8, 10, 12,
16, 24, 32, 36 and 48. Each essence has a clean ingredient — that essence and nothing else — at every
step of the scale, and the rest are mixes built from the same numbers. Balancing a ratio is arithmetic
on those numbers, thrown out a little by age: an ingredient is at its stated strength while dewfresh
and loses up to a fifth as it dries.

Seeds and spores come from merchants and expeditions, and back from harvests. A new shop starts with
seeds for one weak clean herb of each essence and one cave species.

## Merchants, ranks and equipment

**Renown is permission; gold is acquisition.** A rank never hands you a capability — it makes one
appear in a merchant's stock, and you still pay. Equipment shows up one rank early, greyed with the
reason, so you learn what a rank is *for* before you reach it.

**A rank also asks for a potion.** Renown opens it, but from Journeyman up the shop must also have
bottled, this run, something good enough for the title — at least a given grade, from a recipe of at
least so many essences, at least so potent. Renown keeps building while it waits; the Ledger shows
what the next rank still wants.

| Rank | Renown | Potion |
| --- | --- | --- |
| II Journeyman | 60 | C, any |
| III Steeped | 180 | B, 2 essences |
| IV Distiller | 420 | A, 2 essences, Common |
| V Chandler | 850 | A, 3 essences, Common |
| VI Adept | 1,600 | S, 3 essences, Greater |
| VII Master | 2,800 | A, 4 essences, Greater |
| VIII Grandmaster | 4,600 | S, 4 essences, Grand |
| IX Luminary | 7,200 | A, 5 essences, Grand |
| X Arch-Alchemist | 11,000 | S, 5 essences, Sovereign |

Merchant presence *and stock* are derived from the world clock — a merchant is in town on the days
their cycle lands on, and their goods come from the visit number and an RNG seeded on `(merchant, day)`. Nothing about a
visit is stored except what you have already bought, so offline catch-up needs no special handling
and a reload cannot reshuffle the shelves.

Each merchant has one trade:

| Merchant | Trade |
| --- | --- |
| **Bramm** | Every herb's seed |
| **Vessa** | Every cave species' spores, and the minerals of the quarry's upper half |
| **Hesk** | The strong minerals of the quarry's lower half, and the tools that make the shop bigger |
| **The Ashwalker** | Exotics |

A stall is eight to ten things. The trade goods are dealt in turn rather than drawn: each visit picks
up round the list where the last left off, so anything a merchant sells turns up within a known number
of visits. The order of that round comes from the world's seed, so every shop's merchants bring their
goods in their own order. The staples beside them — boards, furnishings, equipment — are drawn by the
day alone, the same in every world.

From Distiller, each trade carries a **yield booster** on every visit — Bramm a Garden tonic (1,200g),
Vessa a Cave tonic (1,500g), Hesk a Seam charge (1,800g). Used from its Grounds tab, it doubles the
next harvest of every plot with a crop in, the next picking of every colonised cave bed, or the next
batch from every vein a crew is working (without draining the vein faster) — what the site has going
when it is used, so it cannot be used on a site with nothing going. A site takes one at a time. Trade goods come at twice their
listed count, and half again for every standing tier with the merchant.

Bramm, Vessa and Hesk keep daylight hours. **The Ashwalker trades only at night, and takes no gold** — his
prices are potions of a minimum grade, and he spends your cheapest qualifying bottles first. The
rarest exotics wait on a long acquaintance with him, so an expedition stays the cheaper way to them.

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

There are 31 recipes: one for every set of essences, from a single essence to all five, always in
equal measure. The five single-essence potions are known at the start. The other 26 are in the book
only as a hint — no name, no ratio — until a pot comes out as one. Accepting it is what puts it in
the book.

Only **accepting** teaches. Rejecting stays free precisely so experimenting is free, and a rejected
pot that leaked the answer would make the free option strictly better than committing to one.

## Brewing

Brewing is mixing and nothing else. There is no heat and no method: what goes in the pot is the
whole decision.

**1 · Ingredients.** Tap or drag them into the pot. The blend's essence totals and the capacity meter
update as you go. Nothing is spent yet.

**2 · Outcome.** What you would make right now, with its grade and potency. **Accept** spends the
ingredients and starts the brew timer; **Pour it back** returns every ingredient unchanged.

The outcome carries a **meter**, after the bar Potionomics fills. It names the potency tier, shows
the grade the brew is at now where Potionomics puts its stars, and fills a bar toward the next tier
with how much essence that is. When the pot cannot hold the next tier it marks the pot's rim and
says so (the Clay Bowl holds 60 and Common starts at 61). A bigger brew can land at a different
grade, and the letter follows it as ingredients go in.

Then **Bottle it** once the timer finishes: one press, nothing to choose.

The two numbers of a brew are independent:

| Number | Decided by |
| --- | --- |
| **Grade** | The ratio. Purity is 100 on a recipe's exact ratio and falls to 0 at the edge of its cone, which is halfway to the nearest other recipe. S is 90 and up for a one- or two-essence potion, 94 for three and 97 for four or five, and the other letters rise with it. A blend outside every cone makes nothing and cannot be brewed. |
| **Potency** | The total essence: Minor 1–60, Common 61–110, Greater 111–190, Grand 191–320, Sovereign 321+. |

So a small pot on the ratio is an S, and a Sovereign off it is an F. What makes the ratio hard is
arithmetic — ingredients come in different strengths, and drying weakens them — and what caps the
potency is the cauldron's capacity.

## Debug panel

On by default in `npm run dev`, off by default in a built copy — it grants gold and skips days, so it
is not something every visitor to the deployed site should find. **Settings → Debug menu** is the
switch, and the only one: whichever way it is set wins in either build, so turning it off in
`npm run dev` turns it off. It is imported dynamically, so a build nobody has asked it for never
downloads it.

A crop takes eighteen hours and a contract runs eight in-game days, so this is not optional tooling.

Time scale ×1–×600 · jump to dawn/dusk/night · skip a day · **simulate being away** (runs the real
resume path) · finish all timers · grant gold, renown and ingredients · pin the RNG seed so a bug
reproduces exactly.

## Placeholder art

Generated at runtime from the game's own data — ingredient badges tinted by dominant essence and
stamped with that essence's glyph, bottles tinted by the potion's blend, plots and pots as shapes.
Composition and silhouette are final; only the rendering isn't. In M4 this becomes a build step
writing an atlas, and nothing else changes.

## Look, and credits

An apothecary after dark: plum-black surfaces, parchment text and brass fittings, set in
**Cinzel** (headings, labels, buttons, the nav) and **Alegreya Sans** (everything read). The
surfaces carry a grain drawn by the browser from SVG noise, and framed panels have brass corner
brackets, so nothing about the texture is a shipped image. The palette lives in
`src/styles/main.css` and `src/ui/theme.ts`, and every text colour keeps at least 5:1 contrast
against the surfaces it sits on.

Everything shipped that someone else made is credited in-game under **Settings → Credits**, from
data in `src/ui/credits.ts`:

| What | By | Licence |
| --- | --- | --- |
| Cinzel | Natanael Gama, The Cinzel Project Authors | SIL OFL 1.1 (`public/licenses/`) |
| Alegreya Sans | Juan Pablo del Peral, Huerta Tipográfica | SIL OFL 1.1 (`public/licenses/`) |
| Interface icons | Lorc and Delapouite, game-icons.net | CC BY 3.0 |
| Phaser | Richard Davey, Phaser Studio Inc. | MIT |

The fonts are subset to Latin and bundled as woff2 from `src/assets/fonts/`. The icons are
vendored as SVG in `art/icons/` with the set's licence; `node scripts/gen-icons.js --write`
turns them into `src/data/icons.json`, and a test fails if the two disagree. An icon by a new
author needs that author added to the script, which is what puts them on the Credits page.

## Commitments held from day one

**Colour is never the only signal.** Each of the five essences has a glyph — triangle, droplet,
square, chevron, crescent — used everywhere the colour is.

**Text scales 85–150%** on top of the device setting, which is the practical reason panels are DOM.

**Every string is keyed** in `src/i18n/en.json`, formatted through `Intl`, with layouts assuming
+40% string length. English ships first; adding a language is a translation contract, not an
engineering project.

**Nothing is lost.** Untended crops still yield. Nothing wilts. Bottled potions never degrade. Rejecting
a brew returns every ingredient. A pot left mid-preparation keeps its contents across a reload, and a
save from an older schema is migrated rather than dropped.

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

Audio is out of scope behind a silent bus stub. Saves are local only. No native build has been
compiled or tested on a real device.

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
| A single ingredient graded S | Top grades were tied to potency; since the 31-potion book, grade is the ratio alone by design |
| Contracts appeared to pay *less* than the shelf | My test compared against a hardcoded price; the real ratio was correct at 1.55× |
| Renown reached rank 6 in a week | Measures an impossible ceiling (free restocks, perfect uptime); relabelled |

It also checks the recipe book against itself: that no two recipes have overlapping tolerance cones
(which would make one of them unreachable), and that **every recipe has an ingredient pointing at
it**. That last one caught the Cinderveil Bomb shipping with nothing gatherable within 46° of it,
before it ever reached the game.

And it checks that **nothing sold is inert**. Five upgrades and half the Mastery Codex once took the
player's gold and did nothing — the effect plumbing existed and the far end was never connected. The
harness measures outcomes, so it never noticed. There are now three checks it cannot pass while
disconnected: no equipment may declare an empty effect, buying any piece must change the derived
stats, and buying any Codex node must change the bonuses. Plus a behavioural test that each
previously-dead bonus does something observable in play.
