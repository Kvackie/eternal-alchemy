/**
 * The world view behind the panels.
 *
 * One scene with four compositions rather than four scenes, because the day/night
 * lighting, the placeholder atlas and the resize handling are shared and would
 * otherwise be written four times.
 *
 * Lighting is a tint overlay over a single painted layer — the entire day/night
 * art budget, as the design doc committed.
 */

import Phaser from 'phaser';
import { blendColor, ensureTexture, generatePlaceholders, preloadArt } from '../placeholders';
import { artUrlIf, hasArt } from '@/ui/art';
import { essenceColors, palette, phaseTint } from '@/ui/theme';
import { dayStateAt, phaseProgress } from '@/sim/clock';

/**
 * How far out and in the world may be zoomed, and by how much per wheel notch.
 *
 * Out far enough to take in a shop of a hundred shelves or a garden of
 * twenty-five beds in one view — 0.4 stopped well short of that and left the
 * far rows to be hunted for by dragging. In far enough to read a single bottle's
 * label.
 */
const ZOOM_MIN = 0.12;
const ZOOM_MAX = 3.5;
const ZOOM_STEP = 1.15;

/** How far past the scene's own edges the view may be dragged, as a share of it. */
const PAN_OVERSCROLL = 0.5;

function axisPan(offset: number, from: number, to: number, min: number, max: number): number {
  /*
   * Room to move past the scene, not just within it.
   *
   * Pinning the content the moment it fits meant a bench of cauldrons could not
   * be shifted at all — you could never put a pot where you wanted it on screen,
   * only where the layout happened to place it. Half a viewport of overscroll in
   * every direction is enough to move the scene off to one side and look at it,
   * and the Recentre button is always there to undo it.
   */
  const slack = (max - min) * PAN_OVERSCROLL;
  const room = max - min;
  const size = to - from;

  // Fits: free to slide either way by the slack alone.
  if (size <= room) return Phaser.Math.Clamp(offset, -slack, slack);

  // Overflows: the usual scroll range, opened up by the same slack.
  return Phaser.Math.Clamp(offset, max - to - slack, min - from + slack);
}
import { config, getRecipe } from '@/sim/config';
import { harvestSize, isReady } from '@/sim/garden';
import { formatGold, t } from '@/i18n';
import { bus, type ScreenId } from '@/ui/bus';
import type { Simulation } from '@/sim/sim';

/**
 * Placeholder colour for a furnishing.
 *
 * Keyed on the piece rather than the spot so an upgrade visibly reads as an
 * upgrade — a gilded sign should not look like the painted one it replaced.
 */
/**
 * Where each spot's art sits, relative to the shop's centre.
 *
 * `x` is a fraction of the shop's width so the layout holds at any size; `y` and
 * the box are pixels, because a banner should not grow to the size of a phone.
 */
const DECOR_BOX: Record<string, { x: number; y: number; w: number; h: number }> = {
  wall: { x: 0, y: -78, w: 74, h: 74 },
  window: { x: -0.38, y: -34, w: 62, h: 62 },
  counter: { x: 0.3, y: 70, w: 54, h: 54 },
  nook: { x: 0.4, y: -8, w: 48, h: 48 },
  floor: { x: -0.28, y: 92, w: 56, h: 56 },
};

function decorTone(decorId: string): number {
  // Literals rather than the UI palette: these have to carry against the dark
  // ground at low alpha, which the surface tones do not.
  const tones: Record<string, number> = {
    paintedSign: 0x6f9c74,
    gildedSign: palette.amber,
    displayCase: essenceColors.aqua,
    lanternDisplay: 0xf0c368,
    polishedCounter: 0x8a6a4a,
    alchemistsBench: 0xb08654,
    curioCabinet: essenceColors.umbra,
    incenseBurner: essenceColors.ignis,
    wovenRug: 0xa2564a,
    mosaicFloor: essenceColors.aer,
  };
  return tones[decorId] ?? palette.ink2;
}

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private sim!: Simulation;
  private screen: ScreenId = 'grounds';
  private content!: Phaser.GameObjects.Container;
  private lighting!: Phaser.GameObjects.Rectangle;
  private sky!: Phaser.GameObjects.Rectangle;

  constructor() {
    super(WorldScene.KEY);
  }

  init(data: { sim: Simulation }): void {
    this.sim = data.sim;
  }

  preload(): void {
    preloadArt(this);
  }

  create(): void {
    // Placeholders fill only the gaps: `texture()` declines to overwrite, so any
    // sprite the loader brought in keeps its painted art.
    generatePlaceholders(this);

    this.sky = this.add.rectangle(0, 0, 10, 10, palette.ground).setOrigin(0);
    this.content = this.add.container(0, 0);
    this.lighting = this.add
      .rectangle(0, 0, 10, 10, 0xffffff, 0)
      .setOrigin(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    this.scale.on('resize', () => this.redraw());
    this.enablePanning();
    // The first screen gets the same prefetch a later switch would.
    this.prefetchFor(this.screen);
    this.redraw();
  }

  /**
   * Drag the world around.
   *
   * A garden of sixteen beds or a shelving unit six high does not fit the strip
   * left over beside a panel, and shrinking everything until it does makes the
   * art unreadable. Letting the scene move means it can be drawn at a size worth
   * looking at and still be seen in full.
   *
   * Nothing in the world is clickable — every interaction lives in the DOM panel
   * — so a drag can be a drag with nothing to disambiguate against.
   */
  private enablePanning(): void {
    let dragging = false;
    let originX = 0;
    let originY = 0;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      dragging = true;
      originX = pointer.x - this.panX;
      originY = pointer.y - this.panY;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!dragging || !pointer.isDown) return;
      this.panX = pointer.x - originX;
      this.panY = pointer.y - originY;
      this.applyView();
    });

    const stop = () => {
      dragging = false;
    };
    this.input.on('pointerup', stop);
    this.input.on('pointerupoutside', stop);
    this.input.on('gameout', stop);

    // The wheel zooms, which is what every map in the world does.
    this.input.on(
      'wheel',
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.zoomBy(dy > 0 ? 1 / ZOOM_STEP : ZOOM_STEP);
      },
    );
  }

  /**
   * Put the world where the pan and the zoom say it should be.
   *
   * Pan and zoom are kept as separate numbers and composed here rather than
   * being read back off the container, because scaling a container happens about
   * its origin — the canvas corner — so a naive `setScale` walks the whole scene
   * toward the top-left. The `cx * (1 - zoom)` term is what holds the middle of
   * the visible area still while the world grows or shrinks around it.
   */
  private applyView(): void {
    if (!this.content) return;
    const area = this.contentArea();
    this.content.setScale(this.zoom);
    this.content.setPosition(
      area.cx * (1 - this.zoom) + this.panX,
      area.cy * (1 - this.zoom) + this.panY,
    );
    this.clampPan();
  }

  /**
   * Keep the world within reach of the visible area.
   *
   * The rule is the one a scroll pane uses: you may drag until an edge of the
   * content meets the matching edge of the free area, and no further — and if
   * the content already fits, you may not drag at all, because there is nowhere
   * to drag it to.
   *
   * The old rule allowed the content's own overflow PLUS thirty per cent of the
   * viewport in every direction, so a small scene — four cauldrons, say, which
   * overflow nothing — could still be shoved most of the way off screen and
   * left there.
   */
  private clampPan(): void {
    if (!this.content) return;
    const area = this.contentArea();
    const bounds = this.content.getBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    // The content's extent with the pan taken back out, so the sums below do
    // not chase their own tail. Zoom is already baked into `bounds`.
    const clampedX = axisPan(
      this.panX,
      bounds.left - this.panX,
      bounds.right - this.panX,
      area.cx - area.width / 2,
      area.cx + area.width / 2,
    );
    const clampedY = axisPan(
      this.panY,
      bounds.top - this.panY,
      bounds.bottom - this.panY,
      area.cy - area.height / 2,
      area.cy + area.height / 2,
    );

    if (clampedX === this.panX && clampedY === this.panY) return;
    this.panX = clampedX;
    this.panY = clampedY;
    this.content.setPosition(
      area.cx * (1 - this.zoom) + this.panX,
      area.cy * (1 - this.zoom) + this.panY,
    );
  }

  /**
   * How far the world is dragged, and how far it is zoomed.
   *
   * Held here rather than read back off the container, because the container's
   * own position is the two composed — see `applyView`.
   *
   * Zoom scales the CONTENT, not the camera: the camera also carries the
   * lighting overlay, which is sized to the canvas rather than to the scene, so
   * zooming it out would shrink the tint away from the edges of the screen.
   */
  private panX = 0;
  private panY = 0;
  private zoom = 1;

  zoomBy(factor: number): void {
    if (!this.content) return;
    this.zoom = Phaser.Math.Clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    this.applyView();
  }

  /** Put the world back: centred, and at its natural size. */
  recenter(): void {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.applyView();
  }

  /**
   * Ask for everything this screen is about to draw, in one go.
   *
   * Without it, sprites are discovered one at a time *during* drawing: the frame
   * paints a placeholder, a request goes out, and the art pops in a moment
   * later — once per crop, per unit, per bottle. Requesting up front means one
   * batch before the first paint, so a screen usually arrives already dressed.
   *
   * It is a prefetch, not a barrier. Anything slow still falls back to its
   * placeholder and swaps in when it lands.
   */
  private prefetchFor(screen: ScreenId): void {
    const ingredientIds: string[] = [];
    const potionIds: string[] = [];

    if (screen === 'grounds') {
      for (const plot of this.sim.world.plots) {
        if (plot.crop) ingredientIds.push(plot.crop.cropId);
      }
    }
    if (screen === 'cauldron') {
      // Every pot's contents: the cauldron screen shows them all.
      for (const pot of this.sim.cauldrons) {
        for (const unit of pot.contents.units) ingredientIds.push(unit.ingredientId);
      }
    }
    if (screen === 'shop' || screen === 'market') {
      for (const slot of this.sim.world.shelf) {
        if (slot.item) potionIds.push(slot.item.recipeId);
      }
    }

    for (const id of new Set(ingredientIds)) {
      this.wantTexture(`ingredient:${id}`, artUrlIf('ingredient', id));
    }
    for (const id of new Set(potionIds)) {
      this.wantTexture(`potion:${id}`, artUrlIf('potion', id));
    }
  }

  setScreen(screen: ScreenId): void {
    this.screen = screen;
    // A view belongs to the screen it was made on; carrying it to the next one
    // would open the cauldron already scrolled off the edge and half zoomed in.
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1;
    this.prefetchFor(screen);
    this.redraw();
  }

  override update(): void {
    this.applyLighting();
  }

  /**
   * Ask for a sprite this frame wants, and redraw when it arrives.
   *
   * Returns false the first time, so the caller falls back to its placeholder
   * rather than waiting — the world is never blank while art is in flight.
   */
  private wantTexture(key: string, url: string | null): boolean {
    return ensureTexture(this, key, url, () => this.redraw());
  }

  /** Called whenever the world changes; cheap enough at this scale to rebuild. */
  redraw(): void {
    if (!this.content) return;
    this.content.removeAll(true);

    const { width, height } = this.scale.gameSize;
    this.sky.setSize(width, height);
    this.lighting.setSize(width, height);

    const area = this.contentArea();

    switch (this.screen) {
      case 'grounds':
        this.drawGarden(area);
        break;
      case 'shop':
        this.drawShop(area);
        break;
      case 'market':
        // The market's own stall art arrives with the merchants' portraits;
        // until then the shop interior stands in.
        this.drawShop(area);
        break;
      case 'ledger':
      case 'settings':
        // Both are full-width documents; the canvas stays out of their way.
        break;
    }

    /*
     * Re-check the pan against what was just drawn.
     *
     * The clamp used to run only while dragging, so anything that changed the
     * scene's size afterwards — bottling the brew in the fourth cauldron,
     * resizing the window, the panel growing — could leave a pan that had been
     * legal stranded well outside the new bounds, with no way back.
     */
    this.applyView();
    this.applyLighting();
  }

  /**
   * Where the world gets to live, given that the panel covers part of the canvas.
   *
   * MEASURED, not inferred. This used to mirror the CSS breakpoint by comparing
   * the canvas width against 960 — but the canvas is narrower than the window by
   * the nav rail, so between roughly 960 and 1050 the stylesheet docked the panel
   * to the right while this still believed it was along the bottom, and the whole
   * scene was drawn underneath it.
   *
   * Asking the panel where it actually is cannot disagree with the stylesheet,
   * whatever the breakpoint, the text scale, or the rail width happen to be.
   */
  private contentArea(): { cx: number; cy: number; width: number; height: number } {
    const { width, height } = this.scale.gameSize;
    const canvas = this.game.canvas;
    const stage = canvas?.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>('.panel');
    const rect = panel?.getBoundingClientRect();

    const fallback = { cx: width / 2, cy: height / 2, width, height };
    if (!stage || !rect || stage.width <= 0 || stage.height <= 0) return fallback;
    if (rect.width <= 0 || rect.height <= 0) return fallback;

    // DOM pixels to game pixels; they differ under device scaling.
    const sx = width / stage.width;
    const sy = height / stage.height;
    const px = (rect.left - stage.left) * sx;
    const py = (rect.top - stage.top) * sy;
    const pw = rect.width * sx;
    const ph = rect.height * sy;

    let left = 0;
    let right = width;
    let top = 0;
    let bottom = height;

    /*
     * The panel takes the edge it is against, decided by which side has room
     * left over — not by where the panel's own corner falls.
     *
     * The corner test was `px > width / 2`: is the panel's LEFT edge past the
     * middle of the canvas? That holds only while the panel is narrower than
     * half the canvas. The panel is sized in rem, so at 150% text it is 672px
     * against a 1146px canvas — docked hard right, but starting at 453, left of
     * the midpoint. The test therefore decided it was a LEFT-hand panel and
     * handed the scene the 21px strip to its right, whose centre is off the
     * canvas entirely. Every cauldron was drawn past the edge of the screen.
     *
     * Comparing the two gaps cannot get this wrong at any width or text scale.
     */
    const gapLeft = px;
    const gapRight = width - (px + pw);
    const gapTop = py;
    const gapBottom = height - (py + ph);
    const spansWidth = pw > width * 0.85;

    if (spansWidth) {
      if (gapTop >= gapBottom) bottom = Math.max(0, py);
      else top = Math.min(height, py + ph);
    } else if (gapLeft >= gapRight) {
      right = Math.max(0, px);
    } else {
      left = Math.min(width, px + pw);
    }

    /*
     * A slot too small to stand a pot in is not a slot.
     *
     * Rather than clamp a sliver up to a token size — which leaves its centre
     * outside the canvas — fall back to the whole stage and let the scene draw
     * behind the panel. Half-covered beats entirely off-screen.
     */
    const w = right - left;
    const h = bottom - top;
    if (w < width * 0.25 || h < height * 0.25) return fallback;

    return { cx: left + w / 2, cy: top + h / 2, width: w, height: h };
  }

  /**
   * The one rule the day cycle imposes on rendering: a tint whose colour and
   * strength come from the phase, eased across the phase boundary so dusk
   * doesn't snap to night.
   */
  private applyLighting(): void {
    if (!this.lighting) return;
    const day = dayStateAt(this.sim.now);
    const current = phaseTint[day.phase] ?? phaseTint.day!;
    const progress = phaseProgress(this.sim.now);

    const order = ['dawn', 'day', 'dusk', 'night'];
    const nextPhase = order[(order.indexOf(day.phase) + 1) % order.length] ?? 'day';
    const next = phaseTint[nextPhase] ?? current;

    // Blend into the next phase over the last quarter, for a continuous sky.
    const mix = progress > 0.75 ? (progress - 0.75) * 4 : 0;
    const alpha = current.alpha + (next.alpha - current.alpha) * mix;
    const color = mix > 0.5 ? next.color : current.color;

    this.lighting.setFillStyle(color, 1);
    this.lighting.setAlpha(alpha);
  }

  // -- compositions ---------------------------------------------------------

  private drawGarden(area: { cx: number; cy: number; width: number; height: number }): void {
    const plots = this.sim.world.plots;
    const gap = 12;

    // The painted bed is square; the drawn placeholder was 4:3. Follow the art,
    // since squashing a framed bed to landscape bends its wooden edging.
    const aspect = this.textures.exists('plot') && hasArt('scene', 'plot') ? 1 : 0.72;

    /*
     * Fill the space rather than fitting a fixed grid into it.
     *
     * A hard four columns and a 150px cap meant a wide screen showed four small
     * beds in a sea of empty ground, and a narrow one squeezed two into a strip.
     * Choosing the column count from the free area's shape — and letting a bed
     * grow to fill what is left — uses whatever room there is, and the scene can
     * be dragged when there genuinely is not enough.
     */
    const targetAspect = Math.max(0.4, area.width / Math.max(1, area.height));
    let columns = Math.max(1, Math.round(Math.sqrt(plots.length * targetAspect)));
    columns = Math.min(columns, plots.length);
    const rows = Math.ceil(plots.length / columns);

    const fitW = (area.width - 40) / columns - gap;
    const fitH = ((area.height - 32) / rows - gap) / aspect;
    const tileW = Math.max(64, Math.min(190, fitW, fitH));
    const tileH = tileW * aspect;

    const startX = area.cx - ((columns - 1) * (tileW + gap)) / 2;
    const startY = area.cy - ((rows - 1) * (tileH + gap)) / 2;

    /*
     * No scattered soil.
     *
     * A heap beside every bed was meant to make the ground look worked. At four
     * beds it read as texture; at twenty-five it is fifty loose mounds across
     * the garden with nothing to do with anything, and the eye cannot tell them
     * from the ones that mark a planted crop. The mounds that mean something —
     * one under each growing plant — are drawn in `drawPlanting`.
     */

    plots.forEach((plot, index) => {
      const col = index % columns;
      const rowIndex = Math.floor(index / columns);
      const x = startX + col * (tileW + gap);
      const y = startY + rowIndex * (tileH + gap);

      const tile = this.add.image(x, y, 'plot').setDisplaySize(tileW, tileH);
      this.content.add(tile);

      if (plot.crop) {
        this.drawPlanting(plot, x, y, tileW, tileH);
      }
    });
  }

  /**
   * The crop in one bed, as a row of plants rather than a single giant one.
   *
   * A bed used to hold one sprite scaled to most of the frame, which read as a
   * poster of a plant rather than a planting. Drawing one plant per unit you
   * will harvest makes the bed say what it is worth at a glance — a tended bed
   * on its right soil is visibly fuller than a neglected one.
   *
   * The grid is balanced to the bed's shape and kept inside the wooden fence,
   * and every plant gets its own small heap of earth.
   */
  private drawPlanting(
    plot: (typeof this.sim.world.plots)[number],
    x: number,
    y: number,
    tileW: number,
    tileH: number,
  ): void {
    const crop = plot.crop;
    if (!crop) return;

    const ready = isReady(plot, this.sim.now);
    const elapsed = this.sim.now - crop.plantedAt;
    const span = Math.max(1, crop.readyAt - crop.plantedAt);
    const growth = Math.min(1, elapsed / span);

    const count = Math.max(1, Math.min(9, harvestSize(this.sim.world, plot)));

    /** Inside the fence: the painted frame takes roughly a sixth of each edge. */
    const innerW = tileW * 0.68;
    const innerH = tileH * 0.68;

    // Balanced to the bed's proportions, so three plants make a row and four a
    // square rather than a queue.
    const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * (innerW / innerH)))));
    const rows = Math.ceil(count / cols);

    const cellW = innerW / cols;
    const cellH = innerH / rows;
    const cell = Math.min(cellW, cellH);

    this.wantTexture(`ingredient:${crop.cropId}`, artUrlIf('ingredient', crop.cropId));

    // A badge is a UI token standing in for a picture; at plant size it reads as
    // a sign staked in the soil, so it is drawn smaller than painted art.
    const painted = hasArt('ingredient', crop.cropId);
    const size = cell * (painted ? 0.44 + growth * 0.22 : 0.3 + growth * 0.14);
    const moundW = cell * (0.62 + growth * 0.16);

    /*
     * A fixed wobble per position, so a bed of four does not look stamped from
     * one die — and so the same bed wobbles the same way on every frame.
     *
     * Seeded from the crop, not from a constant: every bed in the garden used
     * the same 7717 and so leaned in exactly the same places, which is the very
     * stamping the wobble is here to break up.
     */
    let seed = 7717;
    for (let i = 0; i < crop.cropId.length; i += 1) {
      seed = (seed * 31 + crop.cropId.charCodeAt(i)) & 0x7fffffff;
    }
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };

    for (let i = 0; i < count; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Rows are centred individually, so a short last row sits in the middle.
      const inRow = Math.min(cols, count - row * cols);
      const px = x + (col - (inRow - 1) / 2) * cellW + jitter() * cell * 0.1;
      const groundY = y + (row - (rows - 1) / 2) * cellH + cell * 0.14;

      /*
       * A shadow, then the heap, then the plant standing in it.
       *
       * The heap alone was invisible: brown earth on brown earth. The shadow
       * beneath is what lifts it off the bed and makes it read as a mound rather
       * than a smudge.
       */
      if (this.textures.exists('dirtMound')) {
        const shade = this.add.ellipse(
          px,
          groundY + moundW * 0.16,
          moundW * 1.05,
          moundW * 0.34,
          0x000000,
          0.32,
        );
        this.content.add(shade);

        const mound = this.add
          .image(px, groundY, 'dirtMound')
          .setDisplaySize(moundW, moundW * 0.6);
        this.content.add(mound);
      }

      /*
       * Lean, then wobble.
       *
       * The old ±7° moved a 28px sprite by about two pixels: rotated in
       * principle, identical to the eye. A bed now FANS — the plants at the
       * edges lean away from the middle the way a real one grows out toward the
       * light — with a per-plant wobble on top so no two sit the same.
       */
      const half = Math.max(1, (inRow - 1) / 2);
      const spread = inRow > 1 ? (col - (inRow - 1) / 2) / half : 0;
      const lean = spread * 13 + jitter() * 16;

      // Anchored by its foot, planted just inside the heap's crown rather than
      // balanced on top of it. Rotation pivots on that foot, so a leaning plant
      // stays rooted in its mound instead of swinging out of it.
      const sprite = this.add
        .image(px, groundY + moundW * 0.06, `ingredient:${crop.cropId}`)
        .setOrigin(0.5, 1)
        .setDisplaySize(size, size)
        .setAngle(lean)
        .setAlpha(ready ? 1 : 0.6 + growth * 0.4);
      this.content.add(sprite);
    }

    if (ready) {
      const halo = this.add.circle(x, y, Math.max(innerW, innerH) * 0.5, palette.verd, 0.1);
      this.content.addAt(halo, Math.max(0, this.content.length - count * 2));
    }

    if (crop.tended) {
      const mark = this.add.circle(x + tileW * 0.34, y - tileH * 0.32, 4, palette.amber, 1);
      this.content.add(mark);
    }
  }


  /**
   * The furnishings, each in its own place in the room.
   *
   * Painted art is drawn where the spot's box says; anything without art falls
   * back to a tinted block of roughly the right shape and size, so a bought
   * piece still visibly changes the room rather than doing nothing until the
   * art lands. The tint is keyed on the piece rather than the spot, so an
   * upgrade reads as an upgrade.
   */
  private drawDecor(area: { cx: number; cy: number; width: number; height: number }): void {
    const { cx, cy, width } = area;
    const room = Math.min(width - 40, 460);

    for (const view of this.sim.decorSpots()) {
      if (!view.placed) continue;

      const key = `decor:${view.placed.id}`;
      if (this.textures.exists(key)) {
        const box = DECOR_BOX[view.spot];
        if (box) {
          const shrink = Math.min(1, area.height / 260);
          const node = this.add
            .image(cx + room * box.x, cy + box.y * shrink, key)
            .setDisplaySize(box.w * shrink, box.h * shrink);
          this.content.add(node);
          continue;
        }
      }

      const tone = decorTone(view.placed.id);
      switch (view.spot) {
        case 'wall':
          this.content.add(this.add.rectangle(cx, cy - 74, room * 0.34, 20, tone, 0.75));
          break;
        case 'window':
          this.content.add(this.add.rectangle(cx - room * 0.38, cy - 30, 40, 54, tone, 0.55));
          break;
        case 'counter':
          this.content.add(this.add.rectangle(cx, cy + 76, room * 0.62, 10, tone, 0.8));
          break;
        case 'nook':
          this.content.add(this.add.rectangle(cx + room * 0.4, cy - 6, 26, 40, tone, 0.6));
          break;
        case 'floor':
          this.content.add(this.add.ellipse(cx, cy + 96, room * 0.7, 26, tone, 0.4));
          break;
        default:
          break;
      }
    }
  }

  private drawShop(area: { cx: number; cy: number; width: number; height: number }): void {
    // Furnishings first, so the shelves stand in front of them.
    this.drawDecor(area);

    /*
     * A shelving unit, built upward.
     *
     * Laying every shelf in one row meant each new one made all of them
     * narrower — six shelves and the bottles were thumbnails. Stacking keeps a
     * bottle the same size however many shelves you own, and it looks like
     * furniture rather than a row of planks: two posts, boards between them,
     * rising from the floor.
     */
    const slots = this.sim.world.shelf;

    /*
     * How many rows the space can actually hold decides the shape.
     *
     * On a phone the world is a band about a third of the screen tall, and a
     * fixed two-row unit simply hid its top row behind the panel. Rows are
     * budgeted from the height available and the columns follow, so the unit
     * stacks where there is room to stack and spreads where there is not.
     */
    /*
     * A wall of shelves, laid out as a grid.
     *
     * A shop can own a great many — the aim is something like ten by ten — so
     * this picks a column count from the free area's shape and lets the grid run
     * as deep as it needs. What does not fit on screen is reached by dragging;
     * shrinking a hundred shelves until they all fit would make every bottle a
     * speck.
     */
    const aspect = Math.max(0.4, area.width / Math.max(1, area.height));
    const cols = Math.max(1, Math.min(slots.length, Math.round(Math.sqrt(slots.length * aspect))));
    const rows = Math.ceil(slots.length / cols);

    const spacing = Math.max(64, Math.min(118, (area.width - 40) / cols));
    const rowHeight = Math.max(96, Math.min(126, (area.height - 24) / rows));

    const startX = area.cx - ((cols - 1) * spacing) / 2;
    // Row 0 at the top, reading like any other grid.
    const startY = area.cy - ((rows - 1) * rowHeight) / 2;

    /*
     * The cell is divided top-down: bottle, then board, then a band reserved for
     * the label. Deriving the bottle's height from what is left over — rather
     * than sizing it independently and hoping — is what stops a tall bottle
     * sitting on top of its own price.
     */
    const TEXT_BAND = 26;
    const boardH = Math.min(26, rowHeight * 0.2);
    const bottleH = Math.max(24, Math.min(74, rowHeight - TEXT_BAND - boardH - 8, spacing * 0.8));
    const bottleW = bottleH * 0.66;

    slots.forEach((slot, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * spacing;
      const shelfY = startY + row * rowHeight;

      /*
       * The plank is anchored by its TOP, which is the board's surface — so the
       * number the bottles stand on and the number the board is drawn at are the
       * same one, and they cannot drift apart.
       */
      const cellTop = shelfY - rowHeight / 2;
      const boardY = cellTop + bottleH + 4;
      const key = `shelf:${slot.quality}`;
      const plank = this.add
        .image(x, boardY, this.textures.exists(key) ? key : 'shelf')
        .setOrigin(0.5, 0);
      plank.setDisplaySize(spacing - 4, boardH);
      this.content.add(plank);

      if (!slot.item) {
        const ghost = this.add
          .rectangle(x, boardY, bottleW * 0.7, bottleH * 0.8, palette.surface2, 0.28)
          .setOrigin(0.5, 1);
        this.content.add(ghost);
        return;
      }

      /*
       * The recipe's own painted bottle where there is one. Only when there
       * isn't does this fall back to the generic shape tinted by essence — a
       * tint is a poor stand-in for a picture, but it still says at a glance
       * that a shelf of tonics is not a shelf of draughts.
       */
      // Stood ON the board — its foot at the board's top edge — rather than
      // centred on the line, which is what makes a bottle look placed.
      const potionKey = `potion:${slot.item.recipeId}`;
      // Standing ON the surface: the board's top is `boardY`, plus a pixel so
      // the bottle's base overlaps the wood rather than hovering over its edge.
      const footY = boardY + 1;
      if (this.wantTexture(potionKey, artUrlIf('potion', slot.item.recipeId))) {
        const painted = this.add.image(x, footY, potionKey).setOrigin(0.5, 1);
        painted.setDisplaySize(bottleW, bottleH);
        this.content.add(painted);
      } else {
        const bottle = this.add.image(x, footY, 'bottle').setOrigin(0.5, 1);
        bottle.setDisplaySize(bottleW * 0.95, bottleH * 0.95);
        bottle.setTint(blendColor(getRecipe(slot.item.recipeId).target));
        this.content.add(bottle);
      }

      /*
       * What is on the shelf and what it costs — the two things a shopkeeper
       * glancing at a wall of shelves actually wants. A bare grade letter told
       * you nothing about which shelf held the Night Glass.
       *
       * Long names are trimmed to the cell rather than wrapped, so the grid's
       * rows stay level.
       */
      const name = t(`recipe.${slot.item.recipeId}`);
      const room = Math.max(6, Math.floor((spacing - 8) / 5.4));
      const shown = name.length > room ? `${name.slice(0, room - 1)}…` : name;
      const asking = Math.round(slot.item.fairValue * slot.priceRatio);
      const detail =
        (slot.quantity > 1 ? `x${slot.quantity}  ` : '') + formatGold(asking);

      // Centred on the plank and clear of it, in the band the cell reserved.
      const title = this.add
        .text(x, boardY + boardH + 4, shown, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '10px',
          color: '#cdd6cf',
        })
        .setOrigin(0.5, 0);
      this.content.add(title);

      const price = this.add
        .text(x, boardY + boardH + 16, detail, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '10px',
          color: '#8fd4c3',
        })
        .setOrigin(0.5, 0);
      this.content.add(price);
    });
  }

}

