# Art drop zone

Put source art here at **whatever size you have**. A build step normalises it into
`public/art/` at the exact sizes the game asks for, so nothing here needs resizing by
hand — that is the point of the folder.

Nothing in `art/` ships. Only the normalised output in `public/art/` is bundled.

## Naming is the contract

Filenames map to ids in `src/data/*.json`. A file whose name doesn't match an id is
ignored, and an id with no file falls back to the generated placeholder — so art can
land a few pieces at a time and the game keeps running either way.

Ids are camelCase and case-sensitive: `galeThistle.png`, not `gale-thistle.png`.

## Format

- **PNG with transparency.** No baked background — the scene supplies its own ground,
  and every sprite is tinted by the day/night lighting pass.
- **Square-ish source, generous margin.** The normaliser trims and centres, but it
  cannot invent edges that were cropped off.
- **At least 2× the target size** in the tables below, so the downscale stays sharp.
  Bigger is fine; oversized files cost nothing but disk here.
- Dark-friendly. The game's ground is `#0F1412` and the palette is muted greens and
  ambers — see `src/ui/theme.ts`. Very dark art disappears; the placeholder décor
  taught us that the hard way.

---

## `ingredients/` — 64 × 64 target

The most valuable batch: these appear in the garden, the cauldron orbit, every
inventory tile and every merchant stall, so eighteen files change nearly every screen.

| Herbs | Fungi | Minerals | Reagents & exotics |
| --- | --- | --- | --- |
| `emberroot.png` | `dewcap.png` | `chalkNodule.png` | `salamanderScale.png` |
| `sunleaf.png` | `gravecrown.png` | `emberstone.png` | `mirefenPearl.png` |
| `galeThistle.png` | `chalkgill.png` | `deepglass.png` | `barrowAsh.png` |
| `moonpetal.png` | | `nullstone.png` | `skyreachFeather.png` |
| `ashfern.png` | | | `cinderwraithAsh.png` |
| | | | `quicksilverTear.png` |

Each ingredient has a dominant essence that currently decides its placeholder tint
(Ignis red, Aqua blue, Terra gold, Aer violet, Umbra grey). Painted art doesn't have to
follow those colours, but a Gravecrown that reads as fiery will fight the rest of the
UI, which labels it Umbra everywhere else.

## `scene/` — the world view

| File | Target | Notes |
| --- | --- | --- |
| `plot.png` | 128 × 96 | Empty tilled soil. Crops draw on top and scale with growth. |
| `cauldron.png` | 192 × 192 | Pot only. The liquid surface is a tinted ellipse drawn over it. |
| `shelf.png` | 256 × 64 | A board. Bottles stand on it; it repeats horizontally. |
| `bottle.png` | 64 × 96 | **Neutral/greyscale** — tinted at runtime by the potion's blend. |

## `decor/` — 10 furnishings

Drawn behind the shelves in the shop view. Sizes vary by spot; the normaliser handles
it, so just keep the piece roughly proportioned to its slot.

| Spot | Files |
| --- | --- |
| wall | `paintedSign.png`, `gildedSign.png` |
| window | `displayCase.png`, `lanternDisplay.png` |
| counter | `polishedCounter.png`, `alchemistsBench.png` |
| nook | `curioCabinet.png`, `incenseBurner.png` |
| floor | `wovenRug.png`, `mosaicFloor.png` |

## `portraits/` — later, and the biggest ask

Not needed to make the game look finished, and by far the largest volume, so this is
last.

- Merchants: `bramm.png`, `vessa.png`, `hesk.png`, `ashwalker.png`
- Heroes: `ilse.png`, `corin.png`, `maren.png`, `tobrin.png`
- Customers: three stance poses each (`<id>-sceptical.png`, `-haughty.png`,
  `-impatient.png`) — the haggle reads the stance off the portrait, so these are the
  only portraits that carry information rather than flavour.

---

## Suggested order

1. **`ingredients/`** — eighteen files, biggest visible change per file.
2. **`scene/`** — four files, and the world view stops being flat shapes.
3. **`decor/`** — ten files, and furnishing the shop becomes worth doing.
4. **`portraits/`** — volume work, safe to leave until the rest is settled.

One ingredient dropped in on its own is enough to check the pipeline end to end.
