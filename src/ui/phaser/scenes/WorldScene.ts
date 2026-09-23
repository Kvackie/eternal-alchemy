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
import { ensureTexture, generatePlaceholders, preloadArt } from '../placeholders';
import { artUrlIf, hasArt } from '@/ui/art';
import { palette, phaseTint } from '@/ui/theme';
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
import { harvestSize, isReady } from '@/sim/garden';
import type { ScreenId } from '@/ui/bus';
import type { Simulation } from '@/sim/sim';

/**
 * The screens with something behind the panel.
 *
 * One, for now. The Cauldron left when brewing moved into its own station, and
 * the Market never had a scene of its own — it borrowed the Shop's, so standing
 * in the market drew your own shelves behind another trader's stock.
 *
 * The Shop left last and is expected back. A painted wall of fifty shelves was
 * rebuilt from nothing, text objects and all, on every press — and the Shop is
 * the screen where presses happen. It returns when it can be drawn from the
 * shelf grid instead of rebuilt each time.
 *
 * Named here rather than inferred, because `redraw` has to know whether to draw
 * before it measures: measuring means asking the panel where it is, and the
 * panel has just been rebuilt.
 */
const DRAWN_SCREENS = new Set<ScreenId>(['grounds']);

export class WorldScene extends Phaser.Scene {
  static readonly KEY = 'world';

  private sim!: Simulation;
  private screen: ScreenId = 'grounds';

  /** The garden as last drawn — see `redraw`. Cleared to force a redraw. */
  private drawn = '';

  /** The panel's box as last seen — see `watchPanel`. */
  private panelBox = '';
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

    this.sky = this.add.rectangle(0, 0, 10, 10, palette.bgPage).setOrigin(0);
    this.content = this.add.container(0, 0);
    this.lighting = this.add
      .rectangle(0, 0, 10, 10, 0xffffff, 0)
      .setOrigin(0)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    // A resize changes the layout without changing the world, and `redraw`
    // compares against the world — so the record of what was drawn is thrown
    // away rather than argued with.
    this.scale.on('resize', () => {
      this.drawn = '';
      this.redraw();
    });
    this.watchPanel();
    this.enablePanning();
    // The first screen gets the same prefetch a later switch would.
    this.prefetchFor(this.screen);
    this.redraw();
  }

  /**
   * Redraw when the panel moves, because the panel decides where the world goes.
   *
   * `contentArea` lays the scene out in whatever the panel leaves over, and the
   * panel is rebuilt by code that knows nothing about this scene. Watching the
   * DOM for that is the only signal that does not depend on the order two
   * unrelated modules happen to run in — which is exactly what went wrong
   * before: the scene was told the screen had changed *before* the new screen's
   * panel existed to be measured, so the first draw was laid out against the
   * whole stage and, with nothing to correct it, stayed there. A quarter of the
   * garden sat behind the panel for the rest of the session.
   *
   * The box is compared rather than the rebuild counted. A press rebuilds the
   * panel without moving it, and relaying out the garden for that would undo
   * the point of drawing it once. One measurement per rebuild is the cost, and
   * a rebuild is already a measurement's worth of work.
   */
  private watchPanel(): void {
    const panels = document.getElementById('panels');
    if (!panels || typeof MutationObserver === 'undefined') return;

    const observer = new MutationObserver(() => {
      if (this.panelMoved()) this.redraw(true);
    });
    observer.observe(panels, { childList: true });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => observer.disconnect());
  }

  /** Has the panel's box changed since the scene last looked? */
  private panelMoved(): boolean {
    const rect = document.querySelector<HTMLElement>('.panel')?.getBoundingClientRect();
    const box = rect
      ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
      : '';

    if (box === this.panelBox) return false;
    this.panelBox = box;
    return true;
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
    for (const id of new Set(ingredientIds)) {
      this.wantTexture(`ingredient:${id}`, artUrlIf('ingredient', id));
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
    /*
     * `true`, because a texture landing is exactly the case the signature
     * cannot see: nothing in the world changed, only what there is to draw it
     * with. Without it a bed kept its placeholder until the crop crossed into
     * its next twentieth of growth — over a minute for most crops — which is
     * the same stale-placeholder symptom `generatePlaceholders` was written to
     * cure.
     */
    return ensureTexture(this, key, url, () => this.redraw(true));
  }

  /** Called whenever the world changes; cheap enough at this scale to rebuild. */
  /**
   * Draw the world.
   *
   * `layoutChanged` is for the callers who know the panel has been rebuilt —
   * the scene is laid out around wherever the panel is, and the signature below
   * is made of the world rather than of the page, so it cannot notice that the
   * shape of the free area has moved under it.
   */
  redraw(layoutChanged = false): void {
    if (!this.content) return;
    if (layoutChanged) this.drawn = '';

    const { width, height } = this.scale.gameSize;
    this.sky.setSize(width, height);
    this.lighting.setSize(width, height);

    /*
     * A screen that draws nothing measures nothing.
     *
     * `contentArea` asks the panel where it is, and asking runs head-first into
     * a panel the shell has just rebuilt — so the browser lays the whole thing
     * out there and then, synchronously, inside the click handler. On the Shop
     * at fifty shelves that one call was an eighth of the frame budget, spent
     * on a screen with nothing behind it. See `DRAWN_SCREENS`.
     */
    if (!DRAWN_SCREENS.has(this.screen)) {
      /*
       * And what was drawn has to go.
       *
       * The teardown used to be the unconditional first line of this method;
       * moving it under the signature check left this branch returning without
       * it, so walking from the Grounds to the Shop left the garden painted on
       * the canvas — and the canvas is behind every panel, so two beds sat in
       * plain sight either side of a panel that does not fill the stage. It is
       * the same "one picture claiming to be two places" this file already
       * records for the market borrowing the shop's drawing.
       *
       * Guarded, so the four-times-a-second call does not keep clearing a
       * container that is already empty.
       */
      if (this.drawn !== '') {
        this.content.removeAll(true);
        this.drawn = '';
      }
      this.applyLighting();
      return;
    }

    /*
     * Redraw the picture only when the picture has changed.
     *
     * `redraw` is called four times a second by the frame loop as well as on
     * every world change, and it tears the whole scene down and builds it again
     * — every bed, every plant, every heap of earth. Almost none of that is
     * different from the last time: a crop's growth is the only continuously
     * moving thing in it, and a twenty-five minute crop grows by two parts in a
     * hundred thousand between one of those calls and the next.
     *
     * So growth is counted in twentieths. The garden is redrawn when a bed is
     * planted or harvested, when a crop crosses into its next twentieth, when
     * the window changes shape, and whenever the panel beside it is rebuilt —
     * and left alone the rest of the time.
     *
     * That last one is not optional. The signature is made of the world, so it
     * cannot see the panel move; without it the very first draw — taken before
     * the panel existed to be measured, and so laid out against the whole
     * stage — was the one that stuck, and a quarter of the garden sat behind
     * the panel for the rest of the session.
     *
     * The light is not part of this. It moves continuously and costs two
     * property writes on one rectangle, so it is applied below on every call.
     */
    const signature = this.gardenSignature();
    if (signature === this.drawn) {
      this.applyLighting();
      return;
    }

    this.drawn = signature;
    this.content.removeAll(true);
    this.drawGarden(this.contentArea());

    /*
     * Re-check the pan against what was just drawn.
     *
     * The clamp used to run only while dragging, so anything that changed the
     * scene's size afterwards — bottling the brew in the fourth cauldron,
     * resizing the window, the panel growing — could leave a pan that had been
     * legal stranded well outside the new bounds, with no way back.
     *
     * It sits under the signature check rather than above it because it
     * measures: `applyView` asks for the content area, and `clampPan` asks
     * again, so a pan that nothing has moved cost two `getBoundingClientRect`
     * calls against the panel, four times a second, for the whole session.
     */
    this.applyView();
    this.applyLighting();
  }

  /**
   * What the garden currently looks like, as one comparable string.
   *
   * Everything the drawing reads, and nothing it does not: how many beds there
   * are, what is in each, whether it can be picked, how full it will be, and
   * how far along it is to the nearest twentieth. The canvas size is in it too,
   * because the beds are laid out to fit the space.
   *
   * Deliberately not the panel's measured rectangle — measuring is a
   * `getBoundingClientRect` against a panel the shell has just rebuilt, which
   * is the thing this check exists to avoid doing four times a second.
   */
  private gardenSignature(): string {
    const { width, height } = this.scale.gameSize;
    const parts = [`${Math.round(width)}x${Math.round(height)}`];

    for (const plot of this.sim.world.plots) {
      const crop = plot.crop;
      if (!crop) {
        parts.push('-');
        continue;
      }
      const span = Math.max(1, crop.readyAt - crop.plantedAt);
      const growth = Math.min(1, (this.sim.now - crop.plantedAt) / span);
      parts.push(
        [
          crop.cropId,
          Math.floor(growth * 20),
          isReady(plot, this.sim.now) ? 'r' : '-',
          harvestSize(plot),
        ].join(':'),
      );
    }

    return parts.join('|');
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

    const count = Math.max(1, Math.min(9, harvestSize(plot)));

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
      const halo = this.add.circle(x, y, Math.max(innerW, innerH) * 0.5, palette.good, 0.1);
      this.content.addAt(halo, Math.max(0, this.content.length - count * 2));
    }

  }



}

