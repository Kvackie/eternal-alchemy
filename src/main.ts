/**
 * Entry point.
 *
 * Loads or creates a world, catches it up on the time that passed while the app
 * was closed, then starts the two halves of the UI and the frame loop.
 */

import './styles/main.css';
import { Simulation } from '@/sim/sim';
import { createWorld } from '@/sim/state';
import { SaveManager } from '@/platform/save';
import { createStorage, storageReady } from '@/platform/storage';
import { createGame } from '@/ui/phaser/game';
import { Shell } from '@/ui/dom/shell';
import { bus, changed, type ScreenId } from '@/ui/bus';
import { config } from '@/sim/config';
import { setLocale } from '@/i18n';
import type { World } from '@/sim/types';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

setLocale('en');

// On a native build this is Capacitor Preferences, which survives an OS cache
// clear that would wipe localStorage — see platform/storage.ts.
const saves = new SaveManager(createStorage(config.save.slots));
await storageReady();

let sim = new Simulation(saves.load() ?? createWorld());

// Catch up before anything renders, so the first frame shows the true state.
const awaySummary = sim.resume();

// The stage must be in the document before Phaser measures it, or the canvas
// initialises at zero size and the RESIZE scale mode never gets a first event.
const stage = document.createElement('div');
stage.id = 'stage';
root.append(stage);

const game = createGame(stage, sim);

/** How fast world time runs against real time. 1 is normal; the debug panel moves it. */
let timeScale = 1;

const shell = new Shell({
  sim,
  saves,
  onScreenChange: (screen: ScreenId) => game.setScreen(screen),
  onRecenter: () => game.recenter(),
  onZoom: (factor: number) => game.zoomBy(factor),
  onNewGame: () => replaceWorld(createWorld()),
  onImport: (world: World) => replaceWorld(world),
  getTimeScale: () => timeScale,
  setTimeScale: (scale) => {
    timeScale = scale;
  },
});

shell.mount(root, stage);

/*
 * Open on the ledger.
 *
 * This used to resume wherever the player left off — the cauldron if any pot
 * still held something, the garden otherwise. The ledger is the better opening
 * because it answers "what happened while I was gone" before asking anything of
 * the player, which is the question you actually arrive with; the pots are one
 * tap away and their state is on the nav badge either way.
 */
shell.setScreen('ledger');

shell.showAway(awaySummary);

// The canvas redraws on any world change; the panels do their own rendering.
bus.on((event) => {
  if (event.type === 'world:changed') {
    game.redraw();
    scheduleSave();
  }
});

/**
 * The frame loop.
 *
 * Real elapsed time drives world time, so the clock keeps its meaning whether
 * the game is running at 60fps or backgrounded at 1. The wheel's own animation
 * is driven by Phaser's update, not from here.
 */
let lastFrame = performance.now();
let lastWorldRedraw = 0;

/** The world view only changes slowly (crops growing, light shifting), so it
 *  redraws a few times a second rather than every frame. The wheel animates on
 *  Phaser's own update loop and is unaffected. */
const WORLD_REDRAW_MS = 250;

function frame(now: number): void {
  const delta = Math.min(1000, now - lastFrame);
  lastFrame = now;

  if (timeScale > 0) {
    sim.advanceBy(delta * timeScale, true);
    if (now - lastWorldRedraw > WORLD_REDRAW_MS) {
      lastWorldRedraw = now;
      game.redraw();
    }
  }

  shell.tick();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// -- persistence -------------------------------------------------------------

let saveTimer: number | undefined;

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, config.save.autosaveDebounceMs);
}

function persist(): void {
  sim.markSeen();
  saves.save(sim.world);
}

// Anchor the real-time stamp on the way out, so the next resume is accurate.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
  else {
    const summary = sim.resume();
    shell.showAway(summary);
    changed();
  }
});

window.addEventListener('pagehide', persist);

function replaceWorld(world: World): void {
  sim = new Simulation(world);
  // The shell and scenes hold a reference to the old simulation, so a full
  // reload is the honest way to swap worlds — and it exercises the load path.
  saves.save(world);
  window.location.reload();
}

