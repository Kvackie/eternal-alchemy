/**
 * The counter, drawn: the shop's back wall and counter, whoever is standing at
 * it, the bottle they are haggling over, and the stance they are taking.
 *
 * A composition inside `WorldScene` rather than a scene of its own. Everything
 * a second Phaser scene would have needed — the day/night lighting, the pan and
 * zoom, the panel-shaped content area, the fetch-on-demand textures — already
 * lives there and is per scene, so a second one would have been a second copy
 * of all of it. This module owns only what the counter looks like and when it
 * has changed; the scene owns when to look.
 *
 * Nothing here is clickable. The panel beside it holds every control; this is
 * the picture of what the panel is about.
 */

import Phaser from 'phaser';
import { formatGold, t } from '@/i18n';
import { customersConfig, getRecipe } from '@/sim/config';
import { decorSpots } from '@/sim/decor';
import { findOwnedBottle } from '@/sim/haggle';
import type { Simulation } from '@/sim/sim';
import type { HaggleStance, World } from '@/sim/types';
import { artUrlIf, dominantEssence, hasArt } from '@/ui/art';
import { bus } from '@/ui/bus';
import { essenceColors, palette } from '@/ui/theme';

/** Where the scene may draw: the canvas less whatever the panel covers. */
export interface Area {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** What the view needs from the scene it lives in. */
export interface CounterHost {
  scene: Phaser.Scene;
  content: Phaser.GameObjects.Container;
  /** Ask for a sprite, drawing the placeholder until it lands — see `WorldScene.wantTexture`. */
  wantTexture: (key: string, url: string | null) => boolean;
  /** The picture needs drawing again, whatever the world says. */
  redraw: () => void;
}

/**
 * The stance colours the panel already uses, so the rim light on the face and
 * the bar beside the stance's name in the panel agree — see `.stance[data-stance]`.
 */
const STANCE_COLOR: Record<HaggleStance, number> = {
  sceptical: essenceColors.aqua,
  haughty: essenceColors.aer,
  impatient: essenceColors.ignis,
};

const BODY_FONT = '"Alegreya Sans", "Segoe UI", sans-serif';
const DISPLAY_FONT = 'Cinzel, Georgia, serif';

/** How long an outcome plays before the counter is redrawn without them. */
const BEAT_MS = 600;

/** How many waiting customers stand at the counter before the rest are left to the panel. */
const WAITING_SHOWN = 3;

/** Bottles per drawn shelf board, and boards on the wall. */
const BOARD_ROWS = 2;

/** The wall's own colour, which the fade under a face is painted in. */
const WALL = 0x1e1626;

/** A portrait's width over its height — the build's 256 x 320. */
const BUST_ASPECT = 0.8;

/** How much of a customer stands behind the counter, as a share of their height. */
const BUST_SUNK = 0.16;

const cssHex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The parts of a drawn haggle an outcome moves — see `beat`. */
interface DrawnSession {
  customerId: string;
  customer: Phaser.GameObjects.GameObject[];
  bottle: Phaser.GameObjects.GameObject[];
  bottleX: number;
  bottleY: number;
  bustX: number;
  bustH: number;
  counterY: number;
}

export class CounterView {
  /** The price the panel last said it was asking — see `haggle:ask`. */
  private ask = 0;

  /** An outcome is playing out, and the counter must not be rebuilt under it. */
  private playing = false;

  /** The haggle as last drawn, or null when the last draw had none. */
  private session: DrawnSession | null = null;

  private unsubscribe: () => void;

  constructor(
    private host: CounterHost,
    private sim: Simulation,
  ) {
    this.unsubscribe = bus.on((event) => {
      if (event.type === 'haggle:ask') this.ask = event.ask;
      else if (event.type === 'haggle:closed') this.beat(event.customerId, event.sold);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** While true the scene keeps the last picture, whatever the world now says. */
  busy(): boolean {
    return this.playing;
  }

  /**
   * Everything the counter is about to draw, requested in one go — the same
   * reason `WorldScene.prefetchFor` gives for the garden.
   */
  prefetch(): void {
    const { world } = this.sim;
    const want = (kind: Parameters<typeof artUrlIf>[0], id: string) =>
      this.host.wantTexture(`${kind}:${id}`, artUrlIf(kind, id));

    want('scene', 'namePlank');
    for (const id of this.customersShown()) want(this.faceKind(id), id);

    const item = this.sim.haggle ? findOwnedBottle(world, this.sim.haggle.itemUid)?.item : null;
    if (item) want('potion', getRecipe(item.recipeId).art);

    for (const { quality, item: bottle } of this.shelved(world)) {
      want('shelf', quality);
      want('potion', getRecipe(bottle.recipeId).art);
    }
    for (const spot of decorSpots) {
      const id = world.decor[spot];
      if (id) want('decor', id);
    }
  }

  /**
   * What the counter looks like, as one comparable string.
   *
   * Everything the drawing reads and nothing it does not. Patience and interest
   * are counted in twentieths, since a bar a few pixels wide cannot show finer.
   * Whether the panel is hidden is read off the shell's attribute rather than
   * measured, because this runs four times a second and a measurement forces a
   * layout.
   */
  signature(width: number, height: number): string {
    const { world } = this.sim;
    const session = this.sim.haggle;
    const parts = [
      `${Math.round(width)}x${Math.round(height)}`,
      this.panelHidden() ? 'h' : '',
      String(this.ask),
      this.shelved(world)
        .map(({ quality, item }) => `${quality}:${item.uid}`)
        .join(','),
      decorSpots.map((spot) => world.decor[spot] ?? '-').join(','),
    ];

    if (session) {
      parts.push(
        [
          's',
          session.customerId,
          session.itemUid,
          session.stance,
          Math.round((session.patience / customersConfig.startingPatience) * 20),
          Math.round(Math.min(1, session.interest / 100) * 20),
        ].join(':'),
      );
    } else {
      parts.push(`w:${this.customersShown().join(',')}`);
    }

    return parts.join('|');
  }

  // -- drawing ---------------------------------------------------------------

  draw(area: Area): void {
    this.session = null;

    const { width: W, height: H } = area;
    const left = area.cx - W / 2;
    const top = area.cy - H / 2;
    /*
     * One scale for everything with a natural size — text, a bottle, a tag —
     * so a phone and a wide monitor draw the same room at different sizes
     * rather than a different room.
     */
    const s = Phaser.Math.Clamp(Math.min(W / 720, H / 640), 0.55, 1.5);
    // Lower on a portrait screen, where a counter across the lower third
    // leaves a tall bare front and a cramped wall; across it on a wide one.
    const counterY = top + H * (H > W ? 0.72 : 0.66);
    const colW = W * 0.26;
    const leftX = left + W * 0.04;
    const rightX = left + W * 0.7;

    this.drawWall(left, top, W, H, s);
    const signBottom = this.drawSign(area.cx, top, W, s);
    this.drawWindow(leftX, top + H * 0.09, colW, H * 0.26, s);
    this.drawNook(leftX + colW * 0.15, top + H * 0.4, colW * 0.7, H * 0.17, s);
    this.drawBanner(rightX, top + H * 0.03, colW, H * 0.26, s);
    this.drawShelves(rightX, top + H * 0.36, colW, H * 0.16, s);

    const session = this.sim.haggle;
    const waiting = session ? [] : this.customersShown();

    if (session) {
      // As tall as the room allows, and no wider than leaves the wall either side.
      const bustH = Math.min(H * 0.45, (W * 0.62) / BUST_ASPECT);
      const bustTop = counterY + bustH * BUST_SUNK - bustH;
      const color = STANCE_COLOR[session.stance];
      const customer = this.drawCustomer(session.customerId, area.cx, counterY, bustH, color, 0.3);
      const bubble = this.drawBubble(
        session.stance,
        area.cx,
        { above: bustTop, below: signBottom },
        left,
        W,
        s,
        {
          patience: Math.max(0, session.patience) / customersConfig.startingPatience,
          interest: Math.min(1, session.interest / 100),
        },
      );
      this.drawCounter(left, counterY, W, top + H - counterY, s);

      const item = findOwnedBottle(this.sim.world, session.itemUid)?.item;
      // Beside the customer, not in front of their face.
      const bottleX = Math.max(left + W * 0.16, area.cx - bustH * BUST_ASPECT * 0.62);
      const bottleY = counterY + 10 * s;
      const bottle = item
        ? this.drawBottle(item.recipeId, bottleX, bottleY, Math.min(H * 0.17, 120 * s), s)
        : [];

      this.session = {
        customerId: session.customerId,
        customer: [...customer, ...bubble],
        bottle,
        bottleX,
        bottleY,
        bustX: area.cx,
        bustH,
        counterY,
      };
    } else {
      /*
       * Waiting customers stand along the counter, and up to three fit; the
       * panel lists them all. Sized so a queue of three still shows each face.
       */
      const n = waiting.length;
      waiting.forEach((id, i) => {
        const x = left + W * (0.5 + (i - (n - 1) / 2) * 0.3);
        const bustW = Math.min(BUST_ASPECT * 0.42 * H, n > 1 ? W * 0.3 * 0.95 : W * 0.5);
        const bustH = bustW / BUST_ASPECT;
        this.drawCustomer(id, x, counterY, bustH, 0x3a2a44, 0.25);
        this.drawWaitingTag(x, counterY + bustH * BUST_SUNK - bustH - 8 * s, s);
      });
      this.drawCounter(left, counterY, W, top + H - counterY, s);
      if (n === 0 && this.panelHidden()) this.drawPlaque(area.cx, counterY + H * 0.17, s);
    }

    this.drawDecor('counter', left + W * 0.86, counterY + 10 * s, Math.min(H * 0.14, 100 * s));
    // On the right: the view controls float over the left corner of the stage.
    this.drawDecor('floor', left + W * 0.82, top + H - 6 * s, Math.min(H * 0.15, 110 * s));
  }

  /** A panelled wall, with the lamp's glow on it and a plank grain drawn in lines. */
  private drawWall(left: number, top: number, W: number, H: number, s: number): void {
    const g = this.host.scene.add.graphics();
    g.fillStyle(WALL, 1);
    g.fillRect(left, top, W, H);

    // The lamp: a few soft ellipses rather than a gradient the API has not got.
    for (let i = 4; i >= 1; i -= 1) {
      g.fillStyle(0x4a3552, 0.06);
      g.fillEllipse(left + W / 2, top + H * 0.22, W * 0.3 * i, H * 0.24 * i);
    }

    // Planks: a shadow line and a highlight beside it, every hand's width.
    const plank = Math.max(28, 44 * s);
    for (let x = left + plank; x < left + W; x += plank) {
      g.fillStyle(0x000000, 0.12);
      g.fillRect(x, top, 1.5, H);
      g.fillStyle(0xffffff, 0.025);
      g.fillRect(x + 1.5, top, 1, H);
    }
    this.host.content.add(g);
  }

  /** The shop's sign, hung from the top of the wall. Returns its lower edge. */
  private drawSign(cx: number, top: number, W: number, s: number): number {
    const signW = Math.min(W * 0.42, 250 * s);
    const signH = signW * (134 / 342);
    const y = top + 8 * s + signH / 2;

    const g = this.host.scene.add.graphics();
    g.lineStyle(2, 0x3a2a20, 1);
    g.lineBetween(cx - signW * 0.42, top, cx - signW * 0.42, y - signH / 2);
    g.lineBetween(cx + signW * 0.42, top, cx + signW * 0.42, y - signH / 2);
    this.host.content.add(g);

    if (this.host.wantTexture('scene:namePlank', artUrlIf('scene', 'namePlank'))) {
      this.host.content.add(
        this.host.scene.add.image(cx, y, 'scene:namePlank').setDisplaySize(signW, signH),
      );
    } else {
      const plank = this.host.scene.add.graphics();
      plank.fillStyle(0x5a3a28, 1);
      plank.fillRoundedRect(cx - signW / 2, y - signH / 2, signW, signH, 8 * s);
      plank.lineStyle(2, 0x2a1d16, 1);
      plank.strokeRoundedRect(cx - signW / 2, y - signH / 2, signW, signH, 8 * s);
      this.host.content.add(plank);
    }

    this.host.content.add(
      this.text(cx, y, t('counter.scene.sign'), {
        size: signH * 0.34,
        font: DISPLAY_FONT,
        color: cssHex(palette.text),
      })
        .setOrigin(0.5)
        .setShadow(0, 1, '#000000', 3, false, true),
    );
    return y + signH / 2;
  }

  /** A window on the left wall, with the window piece on its sill. */
  private drawWindow(x: number, y: number, w: number, h: number, s: number): void {
    const g = this.host.scene.add.graphics();
    g.fillStyle(0x3b2a20, 1);
    g.fillRoundedRect(x - 6 * s, y - 6 * s, w + 12 * s, h + 12 * s, 6 * s);
    // Outside: a dusk lavender the lighting pass darkens with the rest.
    g.fillStyle(0x3d3a63, 1);
    g.fillRect(x, y, w, h);
    g.fillStyle(0x6a6396, 0.35);
    g.fillRect(x, y, w, h * 0.4);
    g.fillStyle(0x2a1d16, 1);
    g.fillRect(x + w / 2 - 2 * s, y, 4 * s, h);
    g.fillRect(x, y + h / 2 - 2 * s, w, 4 * s);
    // The sill.
    const sillY = y + h + 6 * s;
    g.fillStyle(0x4a3324, 1);
    g.fillRect(x - 10 * s, sillY, w + 20 * s, 8 * s);
    g.fillStyle(palette.brass, 0.5);
    g.fillRect(x - 10 * s, sillY + 8 * s, w + 20 * s, 1.5);
    this.host.content.add(g);

    this.drawDecor('window', x + w / 2, sillY + 2 * s, w * 0.55);
  }

  /** An arched alcove under the window, for the nook piece. */
  private drawNook(x: number, y: number, w: number, h: number, s: number): void {
    const g = this.host.scene.add.graphics();
    const radius = { tl: w / 2, tr: w / 2, bl: 4 * s, br: 4 * s };
    g.fillStyle(palette.bgInset, 1);
    g.fillRoundedRect(x, y, w, h, radius);
    g.lineStyle(1.5, 0x7d6238, 0.8);
    g.strokeRoundedRect(x, y, w, h, radius);
    this.host.content.add(g);

    this.drawDecor('nook', x + w / 2, y + h - 4 * s, h * 0.72);
  }

  /** A rod on the right wall, and the banner hung from it. */
  private drawBanner(x: number, y: number, w: number, h: number, s: number): void {
    if (!this.sim.world.decor.wall) return;
    const g = this.host.scene.add.graphics();
    g.fillStyle(0x5a4a3a, 1);
    g.fillRect(x, y, w, 4 * s);
    this.host.content.add(g);

    const size = Math.min(w, h);
    const key = this.decorKey('wall');
    if (!key) return;
    this.host.content.add(
      this.host.scene.add
        .image(x + w / 2, y + 2 * s, key)
        .setOrigin(0.5, 0)
        .setDisplaySize(size, size),
    );
  }

  /** Two boards on the right wall, with the shop's own shelved bottles standing on them. */
  private drawShelves(x: number, y: number, w: number, rowH: number, s: number): void {
    const boardW = w + 8 * s;
    const boardH = boardW * (96 / 512);
    const bottleW = Math.min(w / 4.6, 40 * s);
    const bottleH = bottleW * 1.5;
    const perBoard = Math.max(1, Math.floor((w - 8 * s) / (bottleW * 1.05)));
    const shelved = this.shelved(this.sim.world);

    for (let row = 0; row < BOARD_ROWS; row += 1) {
      const boardTop = y + row * rowH;
      const bottles = shelved.slice(row * perBoard, (row + 1) * perBoard);
      const quality = bottles[0]?.quality ?? shelved[0]?.quality ?? 'salvagedBoard';

      const key = `shelf:${quality}`;
      if (this.host.wantTexture(key, artUrlIf('shelf', quality))) {
        this.host.content.add(
          this.host.scene.add
            .image(x + w / 2, boardTop, key)
            .setOrigin(0.5, 0)
            .setDisplaySize(boardW, boardH),
        );
      } else {
        const g = this.host.scene.add.graphics();
        g.fillStyle(0x4a3324, 1);
        g.fillRect(x - 4 * s, boardTop, boardW, boardH * 0.4);
        g.fillStyle(0x2a1d16, 1);
        g.fillRect(x - 4 * s, boardTop + boardH * 0.4, boardW, 2);
        this.host.content.add(g);
      }

      // Before the board rather than after it, in draw order: the board's own
      // plank is its top rows, and the bottles stand on it rather than behind.
      const feetY = boardTop + boardH * 0.14;
      const step = bottles.length > 1 ? (w - 8 * s - bottleW) / (bottles.length - 1) : 0;
      bottles.forEach(({ item }, i) => {
        const bx =
          x + 4 * s + bottleW / 2 + (bottles.length > 1 ? i * step : (w - 8 * s) / 2 - bottleW / 2);
        this.drawPotion(item.recipeId, bx, feetY, bottleW, bottleH);
      });
    }
  }

  /**
   * A customer at the counter: a soft light behind them, the face, and its
   * bottom fading into the counter it stands behind.
   */
  private drawCustomer(
    id: string,
    x: number,
    counterY: number,
    bustH: number,
    glow: number,
    glowAlpha: number,
  ): Phaser.GameObjects.GameObject[] {
    const { scene, content } = this.host;
    const bustW = bustH * BUST_ASPECT;
    const bottom = counterY + bustH * BUST_SUNK;
    const parts: Phaser.GameObjects.GameObject[] = [];

    // Two halos, a wide faint one and a tight bright one, so the colour reads
    // as light on the edges of the face rather than a disc behind it.
    const outer = scene.add.ellipse(
      x,
      bottom - bustH * 0.52,
      bustW * 1.4,
      bustH * 1.1,
      glow,
      glowAlpha * 0.5,
    );
    const inner = scene.add.ellipse(
      x,
      bottom - bustH * 0.5,
      bustW * 1.1,
      bustH * 1.0,
      glow,
      glowAlpha,
    );
    content.add(outer);
    content.add(inner);
    parts.push(outer, inner);

    const kind = this.faceKind(id);
    const key = `${kind}:${id}`;
    if (this.host.wantTexture(key, artUrlIf(kind, id))) {
      const face = scene.add.image(x, bottom, key).setOrigin(0.5, 1).setDisplaySize(bustW, bustH);
      content.add(face);
      parts.push(face);
    } else {
      // A silhouette until the face lands, or for a customer with no picture.
      const g = scene.add.graphics();
      g.fillStyle(palette.bgRaised, 1);
      g.fillCircle(x, bottom - bustH * 0.68, bustW * 0.22);
      g.fillRoundedRect(x - bustW * 0.36, bottom - bustH * 0.42, bustW * 0.72, bustH * 0.42, 12);
      content.add(g);
      parts.push(g);
    }

    // The fade: the wall's colour laid over the chest in steps up to the counter.
    const strips = 5;
    const stripH = bustH * 0.035;
    const fade = scene.add.graphics();
    for (let i = 0; i < strips; i += 1) {
      fade.fillStyle(WALL, 0.09 * (i + 1));
      fade.fillRect(x - bustW * 0.75, counterY - stripH * (strips - i), bustW * 1.5, stripH);
    }
    content.add(fade);
    parts.push(fade);

    return parts;
  }

  /** The counter itself: a wooden top with a brass edge, and a planked front down to the floor. */
  private drawCounter(left: number, y: number, W: number, H: number, s: number): void {
    const g = this.host.scene.add.graphics();
    const lip = 16 * s;
    g.fillStyle(0x4a3324, 1);
    g.fillRect(left, y, W, lip);
    g.fillStyle(0xffffff, 0.06);
    g.fillRect(left, y, W, 3);
    g.fillStyle(palette.brass, 0.85);
    g.fillRect(left, y + lip, W, 2);
    g.fillStyle(0x2a1d17, 1);
    g.fillRect(left, y + lip + 2, W, H - lip - 2);

    const plank = Math.max(40, 64 * s);
    for (let x = left + plank; x < left + W; x += plank) {
      g.fillStyle(0x000000, 0.18);
      g.fillRect(x, y + lip + 2, 2, H - lip - 2);
    }
    g.fillStyle(0x1a1210, 1);
    g.fillRect(left, y + H - 10 * s, W, 10 * s);
    this.host.content.add(g);
  }

  /** The bottle under negotiation, on the counter, with its price on a tag. */
  private drawBottle(
    recipeId: string,
    x: number,
    footY: number,
    h: number,
    s: number,
  ): Phaser.GameObjects.GameObject[] {
    const { scene, content } = this.host;
    const w = h / 1.5;
    const parts: Phaser.GameObjects.GameObject[] = [];

    const shadow = scene.add.ellipse(x, footY, w * 1.3, w * 0.38, 0x000000, 0.35);
    content.add(shadow);
    parts.push(shadow);
    parts.push(this.drawPotion(recipeId, x, footY, w, h));

    // The tag hangs beside the neck on a short string.
    const label = this.text(0, 0, formatGold(this.ask), {
      size: 13 * s,
      font: BODY_FONT,
      color: cssHex(palette.bgPage),
      style: 'bold',
    }).setOrigin(0, 0.5);
    const tagW = label.width + 14 * s;
    const tagH = label.height + 8 * s;
    // On the side away from the customer, so the price never sits on a face.
    const tagX = x - w * 0.55 - 8 * s - tagW;
    const tagY = footY - h * 0.6;

    const g = scene.add.graphics();
    g.lineStyle(1.5, 0xcdbfa5, 0.9);
    g.lineBetween(x, footY - h * 0.88, tagX + tagW - 4 * s, tagY - tagH / 2 + 4 * s);
    g.fillStyle(palette.text, 1);
    g.fillRoundedRect(tagX, tagY - tagH / 2, tagW, tagH, 3 * s);
    g.lineStyle(1.5, palette.brass, 1);
    g.strokeRoundedRect(tagX, tagY - tagH / 2, tagW, tagH, 3 * s);
    g.fillStyle(0x7d6238, 1);
    g.fillCircle(tagX + tagW - 4 * s, tagY - tagH / 2 + 4 * s, 1.5 * s);
    content.add(g);
    label.setPosition(tagX + 7 * s, tagY);
    content.add(label);
    parts.push(g, label);

    return parts;
  }

  /** One potion standing on something, its foot at `footY`. */
  private drawPotion(
    recipeId: string,
    x: number,
    footY: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.GameObject {
    const { scene, content } = this.host;
    const recipe = getRecipe(recipeId);
    const key = `potion:${recipe.art}`;
    if (this.host.wantTexture(key, artUrlIf('potion', recipe.art))) {
      const image = scene.add.image(x, footY, key).setOrigin(0.5, 1).setDisplaySize(w, h);
      content.add(image);
      return image;
    }
    // A flat bottle in the blend's colour until the art lands.
    const g = scene.add.graphics();
    const tint = essenceColors[dominantEssence(recipe.target)];
    g.fillStyle(tint, 0.9);
    g.fillRoundedRect(x - w / 2, footY - h * 0.68, w, h * 0.68, w * 0.2);
    g.fillRect(x - w * 0.18, footY - h * 0.92, w * 0.36, h * 0.26);
    g.fillStyle(0x7d6238, 1);
    g.fillRect(x - w * 0.2, footY - h, w * 0.4, h * 0.1);
    content.add(g);
    return g;
  }

  /**
   * What the customer just said, in a bubble over their head — the stance's
   * name, its line, and how their patience and interest stand.
   */
  private drawBubble(
    stance: HaggleStance,
    cx: number,
    /** The head it speaks from, and the sign it must hang under. */
    anchor: { above: number; below: number },
    left: number,
    W: number,
    s: number,
    bars: { patience: number; interest: number },
  ): Phaser.GameObjects.GameObject[] {
    const { scene, content } = this.host;
    const color = STANCE_COLOR[stance];
    const pad = 10 * s;
    const maxW = Math.min(W * 0.62, 360 * s);

    const label = this.text(0, 0, t(`stance.${stance}`), {
      size: 11 * s,
      font: DISPLAY_FONT,
      color: cssHex(color),
    });
    const line = this.text(0, 0, t(`stance.${stance}.line`), {
      size: 15 * s,
      font: BODY_FONT,
      color: cssHex(palette.text),
      style: 'italic',
      wrap: maxW - pad * 2,
    });

    const barW = Math.min(150 * s, maxW * 0.55);
    const barH = 5 * s;
    const rows = [
      { name: t('haggle.patience'), value: bars.patience, color: palette.warn },
      { name: t('haggle.interest'), value: bars.interest, color: palette.good },
    ].map((row) => ({
      ...row,
      text: this.text(0, 0, row.name, {
        size: 9 * s,
        font: DISPLAY_FONT,
        color: cssHex(palette.textFaint),
      }),
    }));
    const rowH = Math.max(rows[0]!.text.height, barH) + 3 * s;
    const labelW = Math.max(...rows.map((row) => row.text.width)) + 6 * s;

    const innerW = Math.max(label.width, line.width, labelW + barW);
    const boxW = innerW + pad * 2;
    const boxH = pad * 2 + label.height + 2 * s + line.height + 6 * s + rows.length * rowH;
    const boxX = Phaser.Math.Clamp(cx - boxW / 2, left + 6 * s, left + W - boxW - 6 * s);
    // Just over the head, and never up into the sign: where the two collide
    // the bubble comes down over the top of the hair, which is where a bubble
    // goes in any comic.
    const boxY = Math.max(anchor.below + 6 * s, anchor.above - boxH - 10 * s);

    const g = scene.add.graphics();
    g.fillStyle(palette.bgRaised, 0.96);
    g.fillRoundedRect(boxX, boxY, boxW, boxH, 10 * s);
    // The tail, toward the head below.
    g.fillTriangle(
      cx - 8 * s,
      boxY + boxH - 1,
      cx + 8 * s,
      boxY + boxH - 1,
      cx,
      boxY + boxH + 12 * s,
    );
    g.lineStyle(1.5, color, 0.85);
    g.strokeRoundedRect(boxX, boxY, boxW, boxH, 10 * s);
    content.add(g);

    let y = boxY + pad;
    label.setPosition(boxX + pad, y);
    content.add(label);
    y += label.height + 2 * s;
    line.setPosition(boxX + pad, y);
    content.add(line);
    y += line.height + 6 * s;

    const barsG = scene.add.graphics();
    for (const row of rows) {
      row.text.setPosition(boxX + pad, y);
      content.add(row.text);
      const bx = boxX + pad + labelW;
      const by = y + rowH / 2 - barH / 2 - 1.5 * s;
      barsG.fillStyle(palette.bgInset, 1);
      barsG.fillRoundedRect(bx, by, barW, barH, barH / 2);
      barsG.fillStyle(row.color, 1);
      if (row.value > 0)
        barsG.fillRoundedRect(bx, by, Math.max(barH, barW * row.value), barH, barH / 2);
      y += rowH;
    }
    content.add(barsG);

    return [g, label, line, barsG, ...rows.map((row) => row.text)];
  }

  /** A small word over a waiting customer's head. */
  private drawWaitingTag(cx: number, bottom: number, s: number): void {
    const { scene, content } = this.host;
    const label = this.text(0, 0, t('counter.scene.waiting'), {
      size: 12 * s,
      font: BODY_FONT,
      color: cssHex(palette.textDim),
      style: 'italic',
    }).setOrigin(0.5);
    const w = label.width + 16 * s;
    const h = label.height + 8 * s;
    const g = scene.add.graphics();
    g.fillStyle(palette.bgRaised, 0.92);
    g.fillRoundedRect(cx - w / 2, bottom - h, w, h, h / 2);
    g.fillTriangle(cx - 5 * s, bottom - 1, cx + 5 * s, bottom - 1, cx, bottom + 6 * s);
    g.lineStyle(1, palette.border, 1);
    g.strokeRoundedRect(cx - w / 2, bottom - h, w, h, h / 2);
    content.add(g);
    label.setPosition(cx, bottom - h / 2);
    content.add(label);
  }

  /**
   * A plaque on the counter's front when nobody is there — only while the
   * panel is hidden, since the panel's own empty state says the same thing.
   */
  private drawPlaque(cx: number, cy: number, s: number): void {
    const { scene, content } = this.host;
    const label = this.text(0, 0, t('counter.empty'), {
      size: 13 * s,
      font: DISPLAY_FONT,
      color: cssHex(palette.textDim),
    }).setOrigin(0.5);
    const w = label.width + 28 * s;
    const h = label.height + 16 * s;
    const g = scene.add.graphics();
    g.fillStyle(palette.bgRaised, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 4 * s);
    g.lineStyle(1.5, 0x7d6238, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 4 * s);
    g.fillStyle(palette.brass, 1);
    g.fillCircle(cx - w / 2 + 6 * s, cy - h / 2 + 6 * s, 2 * s);
    g.fillCircle(cx + w / 2 - 6 * s, cy - h / 2 + 6 * s, 2 * s);
    content.add(g);
    label.setPosition(cx, cy);
    content.add(label);
  }

  /** The piece standing in a furnishing spot, its foot at `footY`; nothing if the spot is bare. */
  private drawDecor(spot: string, x: number, footY: number, size: number): void {
    const key = this.decorKey(spot);
    if (!key) return;
    this.host.content.add(
      this.host.scene.add.image(x, footY, key).setOrigin(0.5, 1).setDisplaySize(size, size),
    );
  }

  /** The texture for what is placed in a spot, once it has loaded. */
  private decorKey(spot: string): string | null {
    const id = this.sim.world.decor[spot];
    if (!id) return null;
    const key = `decor:${id}`;
    return this.host.wantTexture(key, artUrlIf('decor', id)) ? key : null;
  }

  // -- outcomes --------------------------------------------------------------

  /**
   * How a haggle ended, played on the counter as it was last drawn.
   *
   * A sale sends the bottle across the counter and drops a few coins where it
   * stood; a customer who leaves without one turns away and fades. The scene is
   * held as it is until the beat is over, then redrawn from the world — which
   * by then has nobody at the counter, or the next person in.
   */
  private beat(customerId: string, sold: boolean): void {
    const drawn = this.session;
    if (!drawn || drawn.customerId !== customerId || reducedMotion()) return;
    if (drawn.customer.some((part) => !part.active)) return;

    const { scene } = this.host;
    this.playing = true;
    scene.time.delayedCall(BEAT_MS, () => {
      this.playing = false;
      this.host.redraw();
    });

    if (sold) {
      if (drawn.bottle.length > 0) {
        scene.tweens.add({
          targets: drawn.bottle,
          x: `+=${drawn.bustX - drawn.bottleX}`,
          y: `-=${drawn.bustH * 0.35}`,
          scaleX: '*=0.6',
          scaleY: '*=0.6',
          alpha: 0,
          duration: 420,
          ease: 'Cubic.easeIn',
        });
      }
      for (let i = 0; i < 5; i += 1) {
        const coin = scene.add.circle(
          drawn.bottleX + (i - 2) * 5,
          drawn.bottleY - drawn.bustH * 0.3,
          Math.max(3, drawn.bustH * 0.02),
          palette.brass,
          1,
        );
        coin.setStrokeStyle(1, 0x7d6238, 1);
        this.host.content.add(coin);
        scene.tweens.add({
          targets: coin,
          x: coin.x + (i - 2) * drawn.bustH * 0.06,
          y: drawn.counterY + 8 + (i % 2) * 4,
          duration: 300 + i * 40,
          delay: i * 35,
          ease: 'Bounce.easeOut',
        });
      }
    } else {
      scene.tweens.add({
        targets: drawn.customer,
        x: `+=${drawn.bustH * 0.2}`,
        alpha: 0,
        duration: 450,
        ease: 'Sine.easeIn',
      });
    }
  }

  // -- what the world says --------------------------------------------------

  /** Who is at the counter: the one being served, or the first few waiting. */
  private customersShown(): string[] {
    const session = this.sim.haggle;
    if (session) return [session.customerId];
    return this.sim
      .walkIns()
      .slice(0, WAITING_SHOWN)
      .map((walkIn) => walkIn.customerId);
  }

  /** The counter-sized face where there is one, else the panel's. */
  private faceKind(id: string): 'bust' | 'customer' {
    return hasArt('bust', id) ? 'bust' : 'customer';
  }

  /** The shelved bottles the boards can hold, in shelf order. */
  private shelved(
    world: World,
  ): Array<{ quality: string; item: NonNullable<World['shelf'][number]['item']> }> {
    const out: Array<{ quality: string; item: NonNullable<World['shelf'][number]['item']> }> = [];
    for (const slot of world.shelf) {
      if (slot.item) out.push({ quality: slot.quality, item: slot.item });
      if (out.length >= BOARD_ROWS * 6) break;
    }
    return out;
  }

  /** Is the panel out of the way, so this is the only thing on screen? */
  private panelHidden(): boolean {
    return document.getElementById('panels')?.dataset.view === 'scene';
  }

  private text(
    x: number,
    y: number,
    content: string,
    opts: { size: number; font: string; color: string; style?: string; wrap?: number },
  ): Phaser.GameObjects.Text {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: opts.font,
      fontSize: `${Math.max(8, Math.round(opts.size))}px`,
      color: opts.color,
      fontStyle: opts.style ?? 'normal',
    };
    if (opts.wrap) style.wordWrap = { width: opts.wrap, useAdvancedWrap: true };
    return this.host.scene.add
      .text(x, y, content, style)
      .setResolution(Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  }
}
