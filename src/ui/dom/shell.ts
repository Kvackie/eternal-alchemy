/**
 * The DOM shell: HUD, navigation, panels, overlays.
 *
 * This is the half of the UI that is text and lists — which is most of a
 * management game. Keeping it in DOM buys text layout, scrolling, screen readers
 * and the 85-150% text scaling commitment for free; each of those would be a
 * week of work in canvas.
 *
 * The shell never touches Phaser directly. It talks to the simulation and the
 * bus, and the game module wires the two halves together.
 */

import { button, clear, el, focusFirstControl } from './components';
import { captureFocus, captureScroll, restoreFocus, restoreScroll } from './scroll';
import { groundsHasScene, renderGrounds } from './panels/grounds';
import { renderCauldron } from './panels/cauldron';
import { closeStation, isStationOpen } from './panels/station';
import { renderShop } from './panels/shop';
import { renderMarket } from './panels/market';
import { renderBoard } from './panels/board';
import { renderRoster, resetRosterSelection } from './panels/roster';
import { renderLedger, resetLedgerPaging } from './panels/ledger';
import { renderSettings } from './panels/settings';
import { renderOnboarding } from './panels/onboarding';
import { countdown, formatDuration, formatGold, formatLongDuration, formatNumber, t } from '@/i18n';
import { activityOf } from '@/sim/cauldrons';
import { dayStateAt } from '@/sim/clock';
import { config } from '@/sim/config';
import { presentCast } from '@/sim/merchants';
import { isMature } from '@/sim/cave';
import { isWorkable } from '@/sim/shaft';
import { bus, changed, type ConfirmRequest, type ScreenId } from '@/ui/bus';
import { debugEnabled } from '@/platform/debugFlag';
import type { AwaySummary, Simulation } from '@/sim/sim';
import type { SaveManager } from '@/platform/save';
import type { World } from '@/sim/types';

export interface ShellDeps {
  sim: Simulation;
  saves: SaveManager;
  onScreenChange: (screen: ScreenId) => void;
  /** Put a dragged or zoomed scene back where it was drawn. */
  onRecenter: () => void;
  /** Above 1 zooms in, below 1 out. */
  onZoom: (factor: number) => void;
  onNewGame: () => void;
  onImport: (world: World) => void;
  getTimeScale: () => number;
  setTimeScale: (scale: number) => void;
}

/**
 * Screens that draw a world behind the panel, and so can be panned and zoomed.
 *
 * The Cauldron left this set when brewing moved into its own station: the bench
 * is a list of pots you own and the station covers the stage, so a painted row
 * of cauldrons behind both was a picture nothing ever looked at.
 *
 * The Market left it for a plainer reason: it had no scene of its own. It
 * borrowed the Shop's, so standing in the market drew your own shelves behind
 * another trader's stock — one picture claiming to be two places. The market is
 * the merchants and what they are selling, which is a list.
 *
 * The Shop left it last, and is expected back. A painted wall of fifty shelves
 * was rebuilt from nothing on every press, and the Shop is the screen where
 * presses happen — measuring the panel alone forced a synchronous layout of the
 * whole thing inside the click handler. It returns when it can be drawn from
 * the shelf grid instead of rebuilt each time.
 */
const SCENE_SCREENS = new Set<ScreenId>(['grounds']);

type StageView = 'split' | 'manage' | 'scene';

/**
 * The stylesheet's breakpoint, in the one place the shell has to agree with it.
 *
 * The stylesheet still decides every measurement; this only decides which two
 * of the three views the toggle moves between, because on a narrow window
 * `split` is not one of them — the panel and the picture cannot both fit, so
 * offering to show both would be offering nothing.
 */
const DESKTOP = '(min-width: 960px)';

function bothFit(): boolean {
  return window.matchMedia(DESKTOP).matches;
}

const SCREENS: Array<{ id: ScreenId; icon: string }> = [
  { id: 'shop', icon: '🏪' },
  { id: 'board', icon: '📋' },
  { id: 'market', icon: '🛒' },
  { id: 'grounds', icon: '🌿' },
  { id: 'cauldron', icon: '⚗️' },
  { id: 'roster', icon: '🎖' },
  { id: 'ledger', icon: '📜' },
  { id: 'settings', icon: '⚙️' },
];

export class Shell {
  private screen: ScreenId = 'ledger';
  private debugOpen = false;
  private away: AwaySummary | null = null;
  private confirming: ConfirmRequest | null = null;
  private uiScale = 1;

  /**
   * Loaded lazily, and only where it has been asked for.
   *
   * A static import would keep the debug panel in the production graph even
   * behind an `import.meta.env.DEV` branch — the dead code goes, the module
   * doesn't. Importing it dynamically is what actually keeps it out.
   */
  private renderDebug: typeof import('@/debug/timePanel').renderDebugPanel | null = null;

  /**
   * How the stage is divided between the picture and the panel.
   *
   * `split` draws both, which only a desktop window has room for; below the
   * breakpoint it renders the same as `manage`, because the two never fit.
   * `manage` gives the panel the whole stage, `scene` gives it to the picture.
   *
   * Only meaningful on a screen that draws a world. It was a single
   * `sceneOnly` boolean while `split` was a desktop-only accident of the
   * stylesheet; making it a state the player can reach is what gives a desktop
   * window a management view instead of a 28rem column beside empty ground.
   */
  private view: StageView = 'split';

  /** The world as it was when the screen was last drawn — see `worldShape`. */
  private drawnShape = '';

  /** Where the caret was before the confirm dialog took it. */
  private confirmReturn: HTMLElement | null = null;

  /*
   * The parts of the open panel that move on their own.
   *
   * Gathered when the panel is built and held until it is built again — see
   * `collectLiveNodes`. Everything else on a screen is drawn once and left
   * alone until something in the world actually changes it.
   */
  private liveClocks: HTMLElement[] = [];

  private liveBars: HTMLElement[] = [];

  private hud = el('div', { class: 'hud' });

  /** The HUD's value nodes, written in place — see `updateHud`. */
  private hudFields: {
    gold: HTMLElement;
    renown: HTMLElement;
    mastery: HTMLElement;
    dot: HTMLElement;
    date: HTMLElement;
    countdown: HTMLElement;
  } | null = null;

  /** What the HUD is currently showing, so a frame that changes nothing writes nothing. */
  private hudShown = {
    gold: Number.NaN,
    renown: Number.NaN,
    mastery: Number.NaN,
    phase: '',
    day: Number.NaN,
    seconds: Number.NaN,
  };
  private panels = el('div', { id: 'panels' });
  private nav = el('nav', { class: 'nav' });
  private toasts = el('div', { class: 'toasts' });

  constructor(private deps: ShellDeps) {}

  /** `stage` is already in the document — Phaser needs it measured before this runs. */
  mount(root: HTMLElement, stage: HTMLElement): void {
    stage.append(this.panels, this.toasts);
    root.prepend(this.hud);
    root.append(this.nav);

    this.uiScale = readStoredScale();
    document.documentElement.style.setProperty('--ui-scale', String(this.uiScale));

    /*
     * Redraw when the window crosses the breakpoint.
     *
     * The view toggle asks `bothFit()` for its label and for what its press
     * should do, and it asks at render time. Nothing on a scene screen forces
     * a render as the window is dragged, so widening past 960px left the
     * button still offering the narrow layout's move — and narrowing past it
     * left "Manage" on a screen the panel already owned, which is the dead
     * press the button's own comment claims to have fixed.
     *
     * `matchMedia` fires on the crossing itself rather than on every pixel of
     * a drag, which is the one moment any of this changes.
     */
    window.matchMedia(DESKTOP).addEventListener('change', () => this.renderPanels());

    // The confirm dialog answers Escape like every other dialog in the game. It
    // is rebuilt with the panels, so the listener lives here rather than on it.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.confirming) this.closeConfirm();
    });

    if (debugEnabled()) this.loadDebugPanel();

    bus.on((event) => {
      switch (event.type) {
        case 'world:changed':
          this.render();
          break;
        case 'screen:changed':
          this.setScreen(event.screen);
          break;
        case 'away':
          this.debugOpen = false;
          this.showAway(event.summary);
          break;
        case 'confirm':
          if (!this.confirming) {
            this.confirmReturn =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          this.confirming = event.request;
          this.renderPanels();
          break;
        case 'debug':
          // Switched on from Settings. Turning it off leaves the module loaded
          // — it is already downloaded, and a reload is not worth forcing — but
          // the toggle and the panel both go.
          if (event.enabled) this.loadDebugPanel();
          else {
            this.renderDebug = null;
            this.debugOpen = false;
            this.renderPanels();
          }
          break;
        case 'toast':
          this.showToast(event.message);
          break;
        default:
          break;
      }
    });

    this.render();
  }

  /** Fetched on demand, so a build nobody asked it for never downloads it. */
  private loadDebugPanel(): void {
    void import('@/debug/timePanel').then((module) => {
      this.renderDebug = module.renderDebugPanel;
      this.renderPanels();
    });
  }

  showAway(summary: AwaySummary): void {
    // Only interrupt for an absence worth reporting.
    if (summary.awayMs < 60_000) return;
    this.away = summary;
    this.render();
  }

  setScreen(screen: ScreenId): void {
    if (screen === 'ledger' && this.screen !== 'ledger') resetLedgerPaging();
    if (this.screen === 'roster' && screen !== 'roster') resetRosterSelection();
    // Leaving the Cauldron leaves the pot: coming back to a station you did not
    // remember opening, on a screen you reached by another route, is a trap.
    if (this.screen === 'cauldron' && screen !== 'cauldron' && isStationOpen()) closeStation();
    // Arriving somewhere with the panel already hidden is arriving at a screen
    // that looks empty, so a chosen view lasts only as long as the screen.
    if (screen !== this.screen) this.view = 'split';
    this.screen = screen;
    this.deps.onScreenChange(screen);
    this.render();
  }

  /**
   * Runs every frame.
   *
   * The HUD clock and any live timer need to tick; the screen is rebuilt only
   * when something it shows has changed — see `worldShape`.
   */
  tick(): void {
    this.updateHud();
    this.updateCountdowns();
    /*
     * Not under a dialog the shell drew itself.
     *
     * Both are rebuilt with the panels, and a rebuild between mousedown and
     * mouseup is a press that lands on nothing. Closing either one renders, and
     * the shape is compared again from there.
     */
    if (this.away || this.confirming) return;
    if (this.worldShape() !== this.drawnShape) this.render();
  }

  /*
   * Move the clocks without rebuilding the panel around them.
   *
   * A full redraw every frame makes a screen unclickable, and not subtly: a
   * click only fires if mousedown and mouseup land on the same element, and at
   * 60 frames a second that element is thrown away and rebuilt between the two.
   * Anything with a running timer became scenery.
   *
   * A countdown is one string, so it is patched where it stands. The element
   * survives, the listeners on its neighbours survive, and the panel is only
   * rebuilt when the world actually changes.
   */
  private updateCountdowns(): void {
    if (this.liveClocks.length === 0 && this.liveBars.length === 0) return;

    const { sim } = this.deps;
    for (const node of this.liveClocks) {
      const at = Number(node.dataset.countdownAt);
      if (!Number.isFinite(at)) continue;
      const time = countdown(at, sim.now);
      const key = node.dataset.countdownKey;
      const next = key ? t(key, { time }) : time;
      // Only when it actually reads differently. These run at frame rate and
      // the text changes about once a second, so writing unconditionally threw
      // away a text node per clock per frame for nothing.
      if (node.textContent !== next) node.textContent = next;
    }

    for (const node of this.liveBars) {
      const from = Number(node.dataset.progressFrom);
      const to = Number(node.dataset.progressTo);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const done = (sim.now - from) / (to - from);
      const width = `${Math.max(0, Math.min(1, done)) * 100}%`;
      if (node.style.width !== width) node.style.width = width;
    }
  }

  /**
   * Find the things that move, once per render rather than once per frame.
   *
   * A clock and a bar are the only parts of a panel that change on their own,
   * and which nodes those are is decided the moment the panel is built. Asking
   * the DOM again every frame — two `querySelectorAll` over a panel that can
   * hold a thousand nodes — was asking a question whose answer could not have
   * changed since the last time it was asked.
   */
  private collectLiveNodes(): void {
    this.liveClocks = [...this.panels.querySelectorAll<HTMLElement>('[data-countdown-at]')];
    this.liveBars = [...this.panels.querySelectorAll<HTMLElement>('[data-progress-from]')];
  }

  /**
   * Is there a picture behind the panel right now?
   *
   * A screen is not enough to answer it: the Grounds draws a garden and nothing
   * for its other two tabs, and the station covers the canvas entirely while a
   * pot is open. Both are asked rather than assumed, because both are the
   * panel's business rather than the shell's.
   */
  private hasScene(): boolean {
    if (!SCENE_SCREENS.has(this.screen) || isStationOpen()) return false;
    return this.screen !== 'grounds' || groundsHasScene();
  }

  /**
   * Everything on screen that can change with nobody pressing anything, as one
   * comparable string.
   *
   * Nothing emits `world:changed` as time passes, so a plot coming ready, a
   * party walking home, a seam regrowing, a contract lapsing or a bottle
   * selling off the shelf left every panel — and every nav badge — saying what
   * it said when it was drawn: no Harvest button, "Back in 0s" with no Claim,
   * a Deliver still offered on a contract that had gone.
   *
   * Redrawing every frame is not the answer, and was tried: a panel torn down
   * and rebuilt sixty times a second cannot be scrolled, and a click only fires
   * when mousedown and mouseup land on the same element, so about one press in
   * six got through. Clocks and bars move in place instead (`updateCountdowns`);
   * this catches the moments something actually changes state.
   *
   * Every part is a fixed fact rather than a remaining duration, so the string
   * reads the same on every frame until something really happens. It is built
   * sixty times a second, so it stays cheap — the market's cast comes from
   * `presentCast` rather than `sim.merchants()`, which prices every visit's
   * whole stock to answer a question about who is standing there.
   */
  private worldShape(): string {
    const { sim } = this.deps;
    const { world, now } = sim;
    const working = world.shaft.workingVeinIds;

    return [
      // Most things that happen on their own write a line in the log: a sale,
      // a brew finishing, a party home, ore brought up, a contract lapsing.
      world.nextLogId,
      // The rest become true with the clock, and write nothing.
      sim.readyToHarvest(),
      world.cave.tiles.filter((tile) => isMature(tile, now)).length,
      world.missions.length,
      sim.pendingClaims.length,
      world.heroes.filter((hero) => hero.injuredUntil !== null && now < hero.injuredUntil).length,
      world.shaft.veins
        .map(
          (vein) =>
            `${vein.remaining}${working.includes(vein.id) ? 'w' : ''}${isWorkable(vein, now) ? '' : 'x'}`,
        )
        .join(','),
      // Days, not milliseconds: the card counts down in days.
      world.contracts
        .map(
          (contract) =>
            `${contract.id}:${Math.ceil(contract.msRemaining / config.clock.dayLengthMs)}`,
        )
        .join(','),
      world.shelf.map((slot) => slot.item?.uid ?? '').join(','),
      world.cauldrons.map((pot) => `${activityOf(pot)}${pot.stored ? 's' : ''}`).join(','),
      presentCast(world)
        .map((visit) => `${visit.merchantId}@${visit.leavesAt}`)
        .join(','),
    ].join('|');
  }

  render(): void {
    this.drawnShape = this.worldShape();
    this.updateHud();
    this.renderNav();
    this.renderPanels();
  }

  // -- HUD ------------------------------------------------------------------

  /**
   * Build the HUD once.
   *
   * Its shape never changes: three figures and a clock, on every screen, for
   * the whole session. What changes is six short strings, and those are written
   * where they stand by `updateHud`.
   */
  private buildHud(): void {
    const gold = el('dd', { class: 'num gold' });
    const renown = el('dd', { class: 'num renown' });
    const mastery = el('dd', { class: 'num mastery' });

    /*
     * The dot is the phase, so the word is gone from the line — but it moves
     * onto the dot rather than out of the build. A coloured circle is a
     * colour-only signal, and this is the same game that gives every essence a
     * glyph so colour is never the only carrier.
     */
    const dot = el('span', { class: 'phase-dot', role: 'img' });
    const date = el('span');
    const countdown = el('span', { class: 'num' });

    clear(this.hud);
    this.hud.append(
      hudStat(t('hud.gold'), gold),
      hudStat(t('hud.renown'), renown),
      // Always, including at zero. Hiding it until the first branch meant the
      // one currency a player has to save toward was invisible for the whole
      // run in which they are saving toward it.
      hudStat(t('hud.mastery'), mastery),
      el('div', { class: 'hud-clock' }, [
        dot,
        date,
        // The same middot the date already uses, so the countdown joins the line
        // rather than floating off the end of it as a separate readout.
        el('span', { class: 'hud-sep', text: '·', 'aria-hidden': 'true' }),
        countdown,
      ]),
    );

    this.hudFields = { gold, renown, mastery, dot, date, countdown };
  }

  /**
   * Write what has changed, and nothing else.
   *
   * This runs every frame, and it used to `clear()` the HUD and build all of it
   * again — fifteen elements and three `Intl` formats, sixty times a second, to
   * move one countdown. Measured while sitting still on any screen: 480 DOM
   * mutations a second, against nothing happening in the world at all.
   *
   * Gold changes when something sells. The date changes at midnight. Only the
   * countdown changes every second, and even that is one string.
   */
  private updateHud(): void {
    if (!this.hudFields) this.buildHud();
    const f = this.hudFields!;

    const { sim } = this.deps;
    const day = dayStateAt(sim.now);
    const remaining = Math.max(0, day.phaseEndsAt - sim.now);

    // Compared as numbers before they are formatted: `Intl` is the expensive
    // half, and the figures behind these are unchanged on almost every frame.
    if (sim.world.gold !== this.hudShown.gold) {
      this.hudShown.gold = sim.world.gold;
      f.gold.textContent = formatGold(sim.world.gold);
    }
    const renown = Math.round(sim.world.renown);
    if (renown !== this.hudShown.renown) {
      this.hudShown.renown = renown;
      f.renown.textContent = formatNumber(renown);
    }
    if (sim.world.mastery !== this.hudShown.mastery) {
      this.hudShown.mastery = sim.world.mastery;
      f.mastery.textContent = formatNumber(sim.world.mastery);
    }

    // The same for the words: which phase and which day are compared as they
    // come, and only a change pays for the translation.
    if (day.phase !== this.hudShown.phase) {
      const phase = t(`phase.${day.phase}`);
      this.hudShown.phase = day.phase;
      f.dot.dataset.phase = day.phase;
      f.dot.title = phase;
      f.dot.setAttribute('aria-label', phase);
    }

    if (day.dayNumber !== this.hudShown.day) {
      this.hudShown.day = day.dayNumber;
      f.date.textContent = `${t('hud.day', { day: day.dayNumber + 1 })} · ${t(`weekday.${day.weekday}`)}`;
    }

    // The clock shows whole seconds, so a second is the most it can change by.
    const seconds = Math.floor(remaining / 1000);
    if (seconds !== this.hudShown.seconds) {
      this.hudShown.seconds = seconds;
      f.countdown.textContent = formatDuration(remaining);
    }
  }

  // -- Nav ------------------------------------------------------------------

  private renderNav(): void {
    /*
     * The nav scrolls as well — sideways on a phone, down the side above the
     * breakpoint — and it is rebuilt with every render for its badges, which
     * includes the ones `tick` asks for when the world changes on its own.
     */
    const scrolls = captureScroll(this.nav);
    clear(this.nav);
    const { sim } = this.deps;

    for (const entry of SCREENS) {
      const node = el('button', { type: 'button' }, [
        el('span', { text: entry.icon, 'aria-hidden': 'true' }),
        el('span', { text: t(`nav.${entry.id}`) }),
      ]);
      node.setAttribute('aria-current', String(entry.id === this.screen));

      // Badges only for things that are genuinely waiting on the player, and
      // that will stop waiting: a bottled brew, and a merchant about to leave.
      if (entry.id === 'cauldron') {
        // Every pot, not only the one last opened: a brew finished in the second
        // cauldron is waiting just the same.
        const done = sim.world.cauldrons.filter((pot) => pot.pendingBrew).length;
        if (done > 0) node.append(el('span', { class: 'badge', text: String(done) }));
      }
      if (entry.id === 'market') {
        const here = presentCast(sim.world).length;
        if (here > 0) node.append(el('span', { class: 'badge', text: String(here) }));
      }
      if (entry.id === 'grounds') {
        const ready = sim.readyToHarvest();
        if (ready > 0) node.append(el('span', { class: 'badge', text: String(ready) }));
      }
      if (entry.id === 'roster') {
        /*
         * A party home and unclaimed counts too.
         *
         * Its haul does not enter stores until it is greeted, so without a badge
         * a finished expedition — the longest wait in the game — sat in the
         * doorway with nothing anywhere saying so.
         */
        const resting = sim.world.heroes.filter(
          (hero) => hero.injuredUntil !== null && sim.now < hero.injuredUntil,
        ).length;
        const waiting = sim.pendingClaims.length + resting;
        if (waiting > 0) node.append(el('span', { class: 'badge', text: String(waiting) }));
      }

      node.addEventListener('click', () => this.setScreen(entry.id));
      this.nav.append(node);
    }

    restoreScroll(this.nav, scrolls);
  }

  // -- Panels ---------------------------------------------------------------

  private renderPanels(): void {
    /*
     * Preserve scroll position across the rebuild, or a live-updating screen
     * yanks itself back to the top under the reader's finger — and the panels
     * are rebuilt on every world change, which is most of a press.
     *
     * Which element scrolls is not something this can know. Above the desktop
     * breakpoint it is the panel body; below it the panel itself, or the pair
     * the Roster stacks into; inside the Roster it is a fold; inside the
     * brewing station it is one of five columns and lists. `captureScroll`
     * records whatever has been scrolled, wherever it is, so a scroller added
     * later keeps its place without anything here being told about it.
     */
    const scrolls = captureScroll(this.panels);
    const focus = captureFocus(this.panels);

    clear(this.panels);

    const panel = this.buildPanel();
    this.panels.append(panel);

    /*
     * The checklist's handle floats over the panel rather than sitting in it.
     *
     * The list used to be prepended into `.panel-body`, which made it part of
     * every screen's layout: it took the body's flex gap, pushed the real
     * content down, scrolled away with it, and on a phone held about a third of
     * the screen on all eight screens at once. Lifting it out fixed that and
     * gave it a new way to be in the way — a card over the bottom corner,
     * covering what was under it and catching its taps. What is over the panel
     * now is a pill; the list is a popup it opens.
     */
    const checklist = renderOnboarding(this.deps.sim);
    if (checklist) this.panels.append(checklist);
    this.panels.dataset.checklist = String(checklist !== null);

    // Only where there is a world to recentre. The Ledger and Settings take the
    // whole stage, so the canvas behind them is not showing anything — and nor
    // is the brewing station, which covers it while a pot is open.
    if (this.hasScene()) {
      this.panels.append(this.buildViewControls());
    }

    /*
     * Which of the two this screen is showing.
     *
     * CSS decides what each one means at each width: above the breakpoint
     * `split` docks the panel beside the picture, below it there is no room to
     * and it reads as `manage`.
     */
    const hasScene = this.hasScene();
    this.panels.dataset.scene = String(hasScene);
    this.panels.dataset.view = hasScene ? this.view : 'manage';

    if (this.renderDebug) {
      this.panels.append(this.buildDebugToggle());
      if (this.debugOpen) {
        this.panels.append(
          this.renderDebug({
            sim: this.deps.sim,
            getTimeScale: this.deps.getTimeScale,
            setTimeScale: this.deps.setTimeScale,
            onNewGame: this.deps.onNewGame,
          }),
        );
      }
    }

    /*
     * How much of the bottom corner the checklist is using.
     *
     * The zoom and recentre controls live in that corner too, and on a phone
     * there is not room for both side by side — so they sit above it instead,
     * which takes a number only the layout knows. Read once per render, and
     * only while the checklist is up.
     */
    if (checklist) {
      this.panels.style.setProperty('--checklist-h', `${checklist.offsetHeight}px`);
    } else {
      this.panels.style.removeProperty('--checklist-h');
    }

    if (this.away) this.panels.append(this.buildAwayDialog(this.away));
    const asking = this.confirming ? this.buildConfirmDialog(this.confirming) : null;
    if (asking) this.panels.append(asking);

    // Last, once everything that affects the layout is in place: a scroller put
    // back before its siblings exist has nothing to scroll through yet.
    restoreScroll(this.panels, scrolls);
    restoreFocus(this.panels, focus);
    // A question just asked takes the caret, on its safe answer; one already
    // open keeps whichever button it was on, which `restoreFocus` put back.
    if (asking && !focus?.name.startsWith('confirm-')) focusFirstControl(asking);

    // Whatever moves on this screen, found now rather than every frame.
    this.collectLiveNodes();
  }

  private buildPanel(): HTMLElement {
    const { sim } = this.deps;
    switch (this.screen) {
      case 'grounds':
        return renderGrounds(sim);
      case 'cauldron':
        return renderCauldron(sim);
      case 'shop':
        return renderShop(sim);
      case 'board':
        return renderBoard(sim);
      case 'market':
        return renderMarket(sim);
      case 'roster':
        return renderRoster(sim);
      case 'ledger':
        return renderLedger(sim);
      case 'settings':
        return renderSettings({
          sim,
          saves: this.deps.saves,
          uiScale: this.uiScale,
          setUiScale: (scale) => this.setUiScale(scale),
          onImport: this.deps.onImport,
          onNewGame: this.deps.onNewGame,
        });
    }
  }

  private setUiScale(scale: number): void {
    this.uiScale = scale;
    document.documentElement.style.setProperty('--ui-scale', String(scale));
    try {
      localStorage.setItem('eternal-alchemy/ui-scale', String(scale));
    } catch {
      /* storage unavailable; the choice simply doesn't persist */
    }
    changed();
  }

  // -- Overlays -------------------------------------------------------------

  private buildAwayDialog(summary: AwaySummary): HTMLElement {
    const lines: HTMLElement[] = [
      el('p', { text: t('away.duration', { time: formatLongDuration(summary.awayMs) }) }),
      el('p', {
        text:
          summary.sales.length > 0
            ? t('away.gold', {
                gold: formatGold(summary.goldEarned),
                count: summary.sales.length,
              })
            : t('away.noSales'),
      }),
    ];

    if (summary.cropsReady > 0) {
      lines.push(el('p', { text: t('away.crops', { count: summary.cropsReady }) }));
    }
    if (summary.brewReady) {
      lines.push(el('p', { text: t('away.brew') }));
    }
    if (summary.partiesHome > 0) {
      lines.push(el('p', { text: t('away.parties', { count: summary.partiesHome }) }));
    }

    return el('div', { class: 'overlay' }, [
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: t('away.title') }),
        ...lines,
        el('div', { class: 'dialog-actions' }, [
          button(t('away.collect'), () => {
            this.away = null;
            this.render();
          }),
        ]),
      ]),
    ]);
  }

  /**
   * A question with a way out of it.
   *
   * "Cancel" comes first and carries the quiet styling, because the dangerous
   * answer should not be the one your thumb is already resting on — and the
   * dialog closes itself either way, so a mis-tap on the backdrop is not a
   * decision.
   */
  private buildConfirmDialog(request: ConfirmRequest): HTMLElement {
    const close = () => this.closeConfirm();

    const overlay = el('div', { class: 'overlay' }, [
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: request.title }),
        el('p', { text: request.body }),
        el('div', { class: 'dialog-actions' }, [
          keepFocus(button(t('common.cancel'), close, { variant: 'quiet' }), 'confirm-cancel'),
          keepFocus(
            button(
              request.confirm,
              () => {
                close();
                request.onConfirm();
              },
              { variant: request.danger ? 'danger' : 'warm' },
            ),
            'confirm-go',
          ),
        ]),
      ]),
    ]);

    // A tap on the ground around the card is a way out, not a way through.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    return overlay;
  }

  private closeConfirm(): void {
    this.confirming = null;
    this.renderPanels();
    if (this.confirmReturn?.isConnected) this.confirmReturn.focus({ preventScroll: true });
    this.confirmReturn = null;
  }

  /**
   * Zoom out, zoom in, and put the world back.
   *
   * Always present on a screen that draws a world, rather than appearing only
   * once the view is off centre: a control that materialises when you are
   * already lost is one you have to discover at the worst moment, and a scene
   * you cannot see all of is exactly when you want the zoom.
   */
  private buildViewControls(): HTMLElement {
    const zoom = (label: string, factor: number, title: string) => {
      const node = el('button', { class: 'view-button', type: 'button', title, text: label });
      // The face is "+" or "−"; the tooltip is the only thing that says what
      // it does, and a tooltip is not a name.
      node.setAttribute('aria-label', title);
      node.addEventListener('click', () => this.deps.onZoom(factor));
      return node;
    };

    const reset = el('button', {
      class: 'view-button view-recenter',
      type: 'button',
      title: t('world.recenter'),
      text: t('world.recenter'),
    });
    reset.addEventListener('click', () => this.deps.onRecenter());

    /*
     * The scene and the panel, taking turns.
     *
     * A phone is not tall enough to show a shop and manage it at the same time:
     * the panel is docked over the lower two thirds, which leaves the scene a
     * strip too short to see what you own and the panel a window too short to
     * work in. Rather than shrink both, this hands the whole stage to one of
     * them. Hidden above the desktop breakpoint, where they already fit
     * together and swapping would only take something away.
     */
    /*
     * The label names the screen, not the mechanism.
     *
     * "Full view" and "Manage" describe what the button does to the layout,
     * which is the one thing a player has no reason to care about. Naming the
     * place — View Shop, Manage Grounds — says what you will be looking at, and
     * it stays true on all three: a single hardcoded word would be wrong on two
     * of them.
     */
    const place = t(`nav.${this.screen}`);

    /*
     * One button, two meanings, and the same two words at either width.
     *
     * "Manage" always hands the stage to the panel. "View" always shows the
     * place — which on a phone means the panel goes away, and on a desktop
     * means the picture comes back beside it. Both answer "show me the
     * garden", which is what the word is for; the difference is only in how
     * much room the window had to begin with.
     */
    /*
     * Below the breakpoint `split` is drawn as `manage`, so it has to read as
     * `manage` too. Taking the state at face value made the first press on a
     * phone a press that changed nothing: the button offered to do what the
     * screen was already doing.
     */
    const managing = this.view === 'manage' || (this.view === 'split' && !bothFit());
    const peek = el('button', {
      class: 'view-button view-peek',
      type: 'button',
      text: managing
        ? t('world.viewScreen', { screen: place })
        : t('world.manageScreen', { screen: place }),
    });
    /*
     * No `aria-pressed`.
     *
     * This is a button whose name changes to describe what pressing it will
     * do, the way Play and Pause do — and for those, a pressed state is the
     * wrong control. It read "View Grounds, pressed" at exactly the moment the
     * garden was *not* showing, which is a sentence that means the opposite of
     * what is on screen. The label alone says it, and says it right.
     */
    peek.addEventListener('click', () => {
      this.view = managing ? (bothFit() ? 'split' : 'scene') : 'manage';
      this.renderPanels();
    });

    return el('div', { class: 'view-controls' }, [
      zoom('−', 1 / 1.25, t('world.zoomOut')),
      zoom('+', 1.25, t('world.zoomIn')),
      reset,
      peek,
    ]);
  }

  private buildDebugToggle(): HTMLElement {
    const node = el('button', {
      class: 'debug-toggle',
      type: 'button',
      text: this.debugOpen ? t('debug.close') : t('debug.title'),
    });
    node.addEventListener('click', () => {
      this.debugOpen = !this.debugOpen;
      this.renderPanels();
    });
    return node;
  }

  private showToast(message: string): void {
    const node = el('div', { class: 'toast', text: message });
    this.toasts.append(node);
    setTimeout(() => node.remove(), 2200);
  }
}

/** Named for the shell's focus memory, so the caret survives a rebuild — see `captureFocus`. */
function keepFocus<T extends HTMLElement>(node: T, name: string): T {
  node.dataset.keepFocus = name;
  return node;
}

/** A label and the node that carries its figure — see `buildHud`. */
function hudStat(label: string, value: HTMLElement): HTMLElement {
  return el('dl', { class: 'hud-stat' }, [el('dt', { text: label }), value]);
}

function readStoredScale(): number {
  try {
    const raw = localStorage.getItem('eternal-alchemy/ui-scale');
    const value = raw === null ? 1 : Number.parseFloat(raw);
    return Number.isFinite(value) && value >= 0.85 && value <= 1.5 ? value : 1;
  } catch {
    return 1;
  }
}
