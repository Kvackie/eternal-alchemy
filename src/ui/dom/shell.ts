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

import { button, clear, el } from './components';
import { renderGrounds } from './panels/grounds';
import { renderCauldron } from './panels/cauldron';
import { closeStation, isStationOpen } from './panels/station';
import { renderShop } from './panels/shop';
import { renderMarket } from './panels/market';
import { renderBoard } from './panels/board';
import { renderRoster, resetRosterSelection } from './panels/roster';
import { renderLedger, resetLedgerPaging } from './panels/ledger';
import { renderSettings } from './panels/settings';
import { renderOnboarding } from './panels/onboarding';
import { formatDuration, formatGold, formatLongDuration, formatNumber, t } from '@/i18n';
import { dayStateAt } from '@/sim/clock';
import { config } from '@/sim/config';
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
 */
const SCENE_SCREENS = new Set<ScreenId>(['grounds', 'shop']);

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
   * The scene, with the panel out of the way.
   *
   * Only meaningful on the three screens that draw a world, and only below the
   * desktop breakpoint — above it the panel and the scene already fit side by
   * side and the toggle is hidden.
   */
  private sceneOnly = false;

  /** The market's cast as it was last drawn — see `marketCastChanged`. */
  private marketCast = '';

  private hud = el('div', { class: 'hud' });
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

    if (debugEnabled()) this.loadDebugPanel();

    bus.on((event) => {
      switch (event.type) {
        case 'world:changed':
          this.render();
          break;
        case 'brew:ready':
          this.setScreen('cauldron');
          break;
        case 'screen:changed':
          this.setScreen(event.screen);
          break;
        case 'away':
          this.debugOpen = false;
          this.showAway(event.summary);
          break;
        case 'confirm':
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
    // that looks empty, so the scene-only view lasts only as long as the screen.
    if (screen !== this.screen) this.sceneOnly = false;
    this.screen = screen;
    this.deps.onScreenChange(screen);
    this.render();
  }

  /**
   * Runs every frame.
   *
   * The HUD clock and any live timer need to tick, and the cauldron's gauge
   * moves continuously while a burner is held — so that screen rebuilds each
   * frame while it is open, and the others only on change.
   */
  tick(): void {
    this.renderHud();
    this.updateCountdowns();
    this.updateTemperature();
    if (this.needsLiveRedraw()) this.renderPanels();
  }

  /**
   * Move the brewing station's gauge without rebuilding the station.
   *
   * A pot cools continuously whether or not anything is being pressed, and
   * nothing on that screen forces a redraw while it does — so the reading went
   * stale and the first tap on a burner made the number jump twenty degrees as
   * the display caught up. Rebuilding every frame is not the answer: that is
   * exactly what made the roster unclickable, because a click needs mousedown
   * and mouseup to land on the same element.
   */
  private updateTemperature(): void {
    const value = this.panels.querySelector<HTMLElement>('[data-live-temp]');
    if (!value) return;

    const { sim } = this.deps;
    const b = config.brewing;
    const temperature = sim.temperature;
    const share = (temperature - b.minTemperature) / (b.maxTemperature - b.minTemperature);
    const percent = Math.min(100, Math.max(0, share * 100));

    value.textContent = `${Math.round(temperature)}°`;

    const fill = this.panels.querySelector<HTMLElement>('[data-live-temp-fill]');
    if (fill) fill.style.width = `${percent}%`;
    const needle = this.panels.querySelector<HTMLElement>('[data-live-temp-needle]');
    if (needle) needle.style.left = `${percent}%`;

    // The fire answers to the same number, so it goes stale in the same way.
    const fire = this.panels.querySelector<HTMLElement>('[data-live-fire]');
    if (fire) fire.style.setProperty('--heat', Math.min(1, Math.max(0, share)).toFixed(3));
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
    const { sim } = this.deps;
    for (const node of this.panels.querySelectorAll<HTMLElement>('[data-countdown-at]')) {
      const at = Number(node.dataset.countdownAt);
      if (!Number.isFinite(at)) continue;
      const time = formatDuration(Math.max(0, at - sim.now));
      const key = node.dataset.countdownKey;
      const next = key ? t(key, { time }) : time;
      // Only when it actually reads differently. These run at frame rate and
      // the text changes about once a second, so writing unconditionally threw
      // away a text node per clock per frame for nothing.
      if (node.textContent !== next) node.textContent = next;
    }

    for (const node of this.panels.querySelectorAll<HTMLElement>('[data-progress-from]')) {
      const from = Number(node.dataset.progressFrom);
      const to = Number(node.dataset.progressTo);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
      const done = (sim.now - from) / (to - from);
      node.style.width = `${Math.max(0, Math.min(1, done)) * 100}%`;
    }
  }

  private needsLiveRedraw(): boolean {
    if (this.away) return false;
    if (this.screen === 'cauldron') {
      return this.deps.sim.burner !== null || this.deps.sim.brewing !== null;
    }
    /*
     * The market redraws when its cast changes, not when its clock moves.
     *
     * This used to return `true` outright, so the panel was torn down and
     * rebuilt every frame to move one number: 366 childList mutations a second,
     * against zero on a screen that does not do this. A click needs mousedown
     * and mouseup to land on the same element, and that element was replaced
     * between them — one tap in six reached a button on this screen.
     *
     * It is the same bug the roster note below describes, and it takes the same
     * cure: the countdowns carry `data-countdown-at` and are retexted in place,
     * so the only thing left worth a rebuild is a merchant arriving or leaving.
     * That still has to be watched from here, because the simulation does not
     * announce it — nothing emits `world:changed` as time passes, so without
     * this check a merchant would sit on the screen after they had gone.
     */
    if (this.screen === 'market') return this.marketCastChanged();

    /*
     * The roster is NOT redrawn live.
     *
     * Its clocks — a party walking home, an injury healing — are patched in
     * place by `updateCountdowns`, because rebuilding the panel underneath them
     * made every button on the screen unclickable for as long as a mission was
     * out. See the note there.
     */
    return false;
  }

  /**
   * Who is at the market, and who is due — as one comparable string.
   *
   * Both halves are needed: a merchant leaving drops out of `merchants()` and
   * reappears in `upcoming()`, and the panel has to follow them across. The
   * timestamps are fixed points rather than remaining durations, so this is
   * stable between frames and only differs when the cast actually changes.
   */
  private marketCastChanged(): boolean {
    const { sim } = this.deps;
    const cast = [
      ...sim.merchants().map((visit) => `${visit.merchantId}@${visit.leavesAt}`),
      ...sim.upcoming().map((entry) => `${entry.merchantId}>${entry.at}`),
    ].join('|');

    if (cast === this.marketCast) return false;
    this.marketCast = cast;
    return true;
  }

  render(): void {
    this.renderHud();
    this.renderNav();
    this.renderPanels();
  }

  // -- HUD ------------------------------------------------------------------

  private renderHud(): void {
    const { sim } = this.deps;
    const day = dayStateAt(sim.now);
    const remaining = Math.max(0, day.phaseEndsAt - sim.now);

    clear(this.hud);
    this.hud.append(
      hudStat(t('hud.gold'), formatGold(sim.world.gold), 'gold'),
      hudStat(t('hud.renown'), formatNumber(Math.round(sim.world.renown)), 'renown'),
      // Always, including at zero. Hiding it until the first branch meant the
      // one currency a player has to save toward was invisible for the whole
      // run in which they are saving toward it.
      hudStat(t('hud.mastery'), formatNumber(sim.world.mastery), 'mastery'),
      el('div', { class: 'hud-clock' }, [
        /*
         * The dot is the phase now, so the word is gone from the line — but it
         * moves onto the dot rather than out of the build. A coloured circle is
         * a colour-only signal, and this is the same game that gives every
         * essence a glyph so colour is never the only carrier.
         */
        el('span', {
          class: 'phase-dot',
          'data-phase': day.phase,
          role: 'img',
          title: t(`phase.${day.phase}`),
          'aria-label': t(`phase.${day.phase}`),
        }),
        el('span', {
          text: `${t('hud.day', { day: day.dayNumber + 1 })} · ${t(`weekday.${day.weekday}`)}`,
        }),
        // The same middot the date already uses, so the countdown joins the line
        // rather than floating off the end of it as a separate readout.
        el('span', { class: 'hud-sep', text: '·', 'aria-hidden': 'true' }),
        el('span', { class: 'num', text: formatDuration(remaining) }),
      ]),
    );
  }

  // -- Nav ------------------------------------------------------------------

  private renderNav(): void {
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
      if (entry.id === 'cauldron' && sim.pendingBrew) {
        node.append(el('span', { class: 'badge', text: '1' }));
      }
      if (entry.id === 'market') {
        const here = sim.merchants().length;
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
  }

  // -- Panels ---------------------------------------------------------------

  private renderPanels(): void {
    /*
     * Preserve scroll position across the rebuild, or a live-updating screen
     * yanks itself back to the top under the reader's finger.
     *
     * Every body, not the first one. The Roster is two panels side by side, and
     * restoring only `querySelector('.panel-body')` meant the tavern — 45 cards
     * deep — jumped to the top whenever anything in the world ticked.
     *
     * The pair counts as well. Below the desktop breakpoint its two panels stack
     * into one page and the pair itself is the scroller, so tracking only the
     * bodies meant picking a hero half way down the Roster threw the page back
     * to the top — on the one screen where choosing is the whole activity.
     */
    const SCROLLERS = '.panel-body, .panel-pair';
    const scrolls = [...this.panels.querySelectorAll(SCROLLERS)].map((node) => node.scrollTop);

    /*
     * Anything that scrolls and is not a panel body keeps its place by name.
     *
     * Positional matching works for panel bodies, which are one per panel and
     * always in the same order. The brewing station is three columns and two
     * lists inside them, and which of those exist changes with what the pot is
     * doing — so they are keyed instead, and a list that is not on screen this
     * time simply has nothing to restore.
     */
    const keyed = new Map<string, number>();
    for (const node of this.panels.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
      keyed.set(node.dataset.keepScroll ?? '', node.scrollTop);
    }

    clear(this.panels);

    const panel = this.buildPanel();
    this.panels.append(panel);

    /*
     * The checklist floats over the panel rather than sitting inside it.
     *
     * It used to be prepended into `.panel-body`, which made it part of every
     * screen's layout: it took the body's flex gap, pushed the real content
     * down, scrolled away with it, and on a phone held about a third of the
     * screen on all eight screens at once. It is still above whatever panel is
     * open — it is just no longer made of the same cloth.
     */
    const checklist = renderOnboarding(this.deps.sim);
    const hasChecklist = checklist.tagName !== 'SPAN';
    if (hasChecklist) this.panels.append(checklist);
    this.panels.dataset.checklist = String(hasChecklist);

    // Positional: the same screen rebuilds to the same shape, and a screen that
    // has changed shape has no position worth restoring anyway.
    this.panels.querySelectorAll(SCROLLERS).forEach((node, index) => {
      const scroll = scrolls[index] ?? 0;
      if (scroll > 0) node.scrollTop = scroll;
    });

    for (const node of this.panels.querySelectorAll<HTMLElement>('[data-keep-scroll]')) {
      const scroll = keyed.get(node.dataset.keepScroll ?? '') ?? 0;
      if (scroll > 0) node.scrollTop = scroll;
    }

    // Only where there is a world to recentre. The Ledger and Settings take the
    // whole stage, so the canvas behind them is not showing anything — and nor
    // is the brewing station, which covers it while a pot is open.
    if (SCENE_SCREENS.has(this.screen) && !isStationOpen()) {
      this.panels.append(this.buildViewControls());
    }

    /*
     * Which of the two this screen is showing.
     *
     * CSS decides whether either means anything: above the desktop breakpoint
     * the panel and the scene both fit, so the flags are ignored and the toggle
     * is hidden. Below it they pick one of two whole-stage views — the scene
     * with no panel, or the panel with no scene.
     */
    const hasScene = SCENE_SCREENS.has(this.screen) && !isStationOpen();
    this.panels.dataset.scene = String(hasScene);
    this.panels.dataset.sceneOnly = String(this.sceneOnly && hasScene);

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
    if (hasChecklist) {
      this.panels.style.setProperty('--checklist-h', `${checklist.offsetHeight}px`);
    } else {
      this.panels.style.removeProperty('--checklist-h');
    }

    if (this.away) this.panels.append(this.buildAwayDialog(this.away));
    if (this.confirming) this.panels.append(this.buildConfirmDialog(this.confirming));
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
            this.deps.sim.acknowledgeSales();
            this.render();
          }),
        ]),
      ]),
    ]);
  }

  /**
   * Zoom out, zoom in, and put the world back.
   *
   * Always present on a screen that draws a world, rather than appearing only
   * once the view is off centre: a control that materialises when you are
   * already lost is one you have to discover at the worst moment, and a scene
   * you cannot see all of is exactly when you want the zoom.
   */
  /**
   * A question with a way out of it.
   *
   * "Cancel" comes first and carries the quiet styling, because the dangerous
   * answer should not be the one your thumb is already resting on — and the
   * dialog closes itself either way, so a mis-tap on the backdrop is not a
   * decision.
   */
  private buildConfirmDialog(request: ConfirmRequest): HTMLElement {
    const close = () => {
      this.confirming = null;
      this.renderPanels();
    };

    const overlay = el('div', { class: 'overlay' }, [
      el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: request.title }),
        el('p', { text: request.body }),
        el('div', { class: 'dialog-actions' }, [
          button(t('common.cancel'), close, { variant: 'quiet' }),
          button(request.confirm, () => {
            close();
            request.onConfirm();
          }, { variant: 'warm' }),
        ]),
      ]),
    ]);

    // A tap on the ground around the card is a way out, not a way through.
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    return overlay;
  }

  private buildViewControls(): HTMLElement {
    const zoom = (label: string, factor: number, title: string) => {
      const node = el('button', { class: 'view-button', type: 'button', title, text: label });
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
    const peek = el('button', {
      class: 'view-button view-peek',
      type: 'button',
      text: this.sceneOnly
        ? t('world.manageScreen', { screen: place })
        : t('world.viewScreen', { screen: place }),
    });
    peek.setAttribute('aria-pressed', String(this.sceneOnly));
    peek.addEventListener('click', () => {
      this.sceneOnly = !this.sceneOnly;
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

function hudStat(label: string, value: string, tone = ''): HTMLElement {
  return el('dl', { class: 'hud-stat' }, [
    el('dt', { text: label }),
    el('dd', { class: `num ${tone}`.trim(), text: value }),
  ]);
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



