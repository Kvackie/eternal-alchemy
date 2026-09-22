/**
 * Phaser bootstrap and the bridge between the two halves of the UI.
 *
 * The canvas renders the world; the DOM renders the panels. Neither calls the
 * other — this module owns the wiring, which is the only place that knows both
 * exist.
 */

import Phaser from 'phaser';
import { WorldScene } from './scenes/WorldScene';
import { palette } from '@/ui/theme';
import type { ScreenId } from '@/ui/bus';
import type { Simulation } from '@/sim/sim';

export interface GameHandle {
  setScreen: (screen: ScreenId) => void;
  /** `layoutChanged` when the panel has been rebuilt — see `WorldScene.redraw`. */
  redraw: (layoutChanged?: boolean) => void;
  /** Put a dragged or zoomed scene back where it was drawn. */
  recenter: () => void;
  /** Above 1 zooms in, below 1 out. */
  zoomBy: (factor: number) => void;
  destroy: () => void;
}

export function createGame(parent: HTMLElement, sim: Simulation): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: palette.bgPage,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    // Phaser draws no text-heavy UI, so the canvas can stay cheap.
    render: { antialias: true, powerPreference: 'low-power' },
    scene: [WorldScene],
  });

  game.scene.start(WorldScene.KEY, { sim });

  const world = () => {
    const scene = game.scene.getScene(WorldScene.KEY) as WorldScene | null;
    // Present but not yet created is not usable: `create` is what builds the
    // container everything else draws into.
    return scene?.sys.isActive() ? scene : null;
  };

  /*
   * A screen asked for before the scene exists.
   *
   * Phaser boots asynchronously, so the first `setScreen` — the one that decides
   * whether you land on the cauldron or the garden — arrives while
   * `getScene` still returns nothing, and used to be dropped on the floor. The
   * DOM panel then showed one screen while the canvas drew another, which stayed
   * wrong until something happened to change screens twice.
   */
  let pending: ScreenId | null = null;

  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    if (pending === null) return;
    const scene = world();
    if (!scene) return;
    scene.setScreen(pending);
    pending = null;
  });

  return {
    setScreen: (screen) => {
      const scene = world();
      if (scene) scene.setScreen(screen);
      else pending = screen;
    },
    redraw: (layoutChanged?: boolean) => world()?.redraw(layoutChanged),
    recenter: () => world()?.recenter(),
    zoomBy: (factor) => world()?.zoomBy(factor),
    destroy: () => game.destroy(true),
  };
}
