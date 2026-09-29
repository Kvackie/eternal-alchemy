# Art drop zone

Put source art here at **whatever size you have**. A build step normalises it into
`public/art/` at the exact sizes the game asks for, so nothing here needs resizing by
hand — that is the point of the folder.

Nothing in `art/` ships. Only the normalised output in `public/art/` is bundled, as WebP
at twice the size the game draws each picture, so it stays sharp on a 2× or 3× phone
screen.

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
- Dark-friendly. The game's ground is `#120D18` (plum-black) and the palette is brass,
  parchment and verdigris — see `src/ui/theme.ts`. Very dark art disappears; the placeholder décor
  taught us that the hard way.

---

## `ingredients/` — 128 × 128 target

The most valuable batch: these appear in the garden, the cave, the cauldron, every
inventory tile and every merchant stall.

There are 151 ingredients — 60 herbs, 30 fungi, 40 minerals and 21 exotics — and every
one has art. The last four to get it took unused pictures from the same packs, renamed to
their ids: Featherfern was `shadefern`, Windwort `wispcoil`, Gloamroot `ghostroot` and
Gloomcap `inkcap`.

The ids, and the essence each one carries, are in `src/data/ingredients.json`; which
id fills which strength on the scale is decided by `scripts/gen-ingredients.js`.
Each ingredient has a dominant essence that decides its placeholder tint (Ignis red,
Aqua blue, Terra gold, Aer violet, Umbra grey). Painted art doesn't have to follow
those colours, but a picture that reads as fiery on an Umbra ingredient will fight
the rest of the UI, which labels it Umbra everywhere else.

## `potions/` — 128 × 192 target

A potion picture is named for the bottle, not the recipe: each of the 31 recipes in
`src/data/recipes.json` names the picture it uses in its `art` field, so a new bottle
is wired in by pointing a recipe at it.

## `scene/` — the world view

| File | Target | Notes |
| --- | --- | --- |
| `plot.png` | 384 × 384 | Empty tilled soil. Crops draw on top and scale with growth. |
| `cauldron.png` | 384 × 384 | Pot only. The liquid surface is a tinted ellipse drawn over it. |
| `shelf.png` | 512 × 96 | A board. Bottles stand on it; it repeats horizontally. |
| `bottle.png` | 128 × 192 | **Neutral/greyscale** — tinted at runtime by the potion's blend. |

## `decor/` — 18 furnishings, 256 × 256 target

Drawn in the Shop's furnishing picker, and behind the shelves once the shop view returns.
Sizes vary by spot; the normaliser handles it, so just keep the piece roughly proportioned
to its slot. The ids are `src/data/decor.json`'s:

| Spot | Files |
| --- | --- |
| wall | `verdantBanner.png`, `crimsonBanner.png`, `tealBanner.png`, `azureBanner.png`, `roseBanner.png`, `violetBanner.png`, `goldBanner.png` |
| window | `pottedFern.png`, `sproutingUrn.png` |
| counter | `mortarAndPestle.png`, `hourglass.png`, `goldGoblet.png` |
| nook | `cutDiamond.png`, `boneChalice.png`, `skullChalice.png` |
| floor | `coinSacks.png`, `lockedChest.png`, `coinStack.png` |

## `portraits/` — 256 × 320 target, one face each

Faces keep their own aspect and are not trimmed: the picture is scaled to cover the box
from the top, so a bust framed with the head near the top of the file lands right. One
folder per kind, and the kinds are separate — the hero and the customer both called
`maren` are different people with different files.

- `merchants/`: `bramm.png`, `vessa.png`, `hesk.png`, `ashwalker.png`
- `heroes/`: one per id in `src/data/heroes.json`, all forty-five
- `customers/`: `maren.png`, `hollis.png`, `sisterAvel.png`, `lordVallis.png`,
  `theQuietMan.png` — one portrait each. The haggle shows the customer's stance as a
  label and a line beside the face, not as a pose, so a customer needs no more art
  than a merchant does.

Merchant and customer faces are built only for ids the data names, so a spare pack
portrait left beside them stays in `art/` and never reaches `public/`; the heroes'
folder is built in full.

---

## Where it stands

Every ingredient, potion, furnishing, board, scene piece and face the data names has
art. A new id is wired in by dropping a file with its name into the right folder and
running `node scripts/art-build.js`; one file on its own is enough to check the pipeline
end to end.
