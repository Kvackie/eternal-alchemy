/**
 * Roster: heroes, missions and favour.
 *
 * The supply picker is the important part of this screen. It is where your own
 * potions stop being stock and become equipment — so it shows what each bottle
 * buys you in odds, and it never hides the fact that supplies are spent whatever
 * the mission returns.
 */

import {
  button,
  chip,
  collapsible,
  el,
  emptyNote,
  goldText,
  gradeBadge,
  ingredientIcon,
  liveCountdown,
  liveMeter,
  matchesSearch,
  meter,
  panelHeader,
  portrait,
  potionIcon,
  searchField,
  outcomeCard,
  row,
  slot,
  slotGrid,
  stat,
} from '../components';
import { showHeroInfo } from '../heroInfo';
import { findLabel, showMissionReward } from '../missionReward';
import { showIngredientInfo } from '../ingredientInfo';
import { showPotionInfo } from '../potionInfo';
import { formatDuration, formatPercent, t } from '@/i18n';
import { getHeroDef, heroesConfig, type LootEntry } from '@/sim/config';
import type { FindKind } from '@/sim/types';
import {
  HEALING_RECIPE,
  favourBandOf,
  effectiveLevel,
  isAvailable,
  isInjured,
  recruitCostOf,
} from '@/sim/heroes';
import { rankOf } from '@/sim/progression';
import type { Simulation } from '@/sim/sim';
import { changed, toast } from '@/ui/bus';

/** Finds listed for a destination — a sample of the place, not its full table. */
const FINDS_SHOWN = 12;

/** Draws from the loot table on a mission that did not go badly. */
const LOOT_DRAWS = 2;

/**
 * Which sections are folded shut.
 *
 * Module state rather than the DOM's, because the panel is rebuilt on every
 * change — and shut rather than open, so the default stays "show me everything"
 * and only a deliberate fold is remembered.
 */
const folded = new Set<string>();

function fold(id: string): () => void {
  return () => {
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    changed();
  };
}

/** What the supply search box is narrowed to. Module state, like the folds. */
let supplyQuery = '';

let selectedHeroes: string[] = [];
let selectedSupplies: string[] = [];
let selectedBiome: string | null = null;

export function resetRosterSelection(): void {
  supplyQuery = '';
  selectedHeroes = [];
  selectedSupplies = [];
  selectedBiome = null;
}

export function renderRoster(sim: Simulation): HTMLElement {
  const body = el('div', { class: 'panel-body' });

  // Drop anyone from the selection who has since left or been hurt.
  selectedHeroes = selectedHeroes.filter((id) => {
    const hero = sim.world.heroes.find((entry) => entry.id === id);
    return hero !== undefined && isAvailable(hero, sim.now);
  });
  selectedSupplies = selectedSupplies.filter((uid) =>
    sim.world.bottled.some((item) => item.uid === uid),
  );

  // Parties waiting to be greeted go first: they are the one thing on this
  // screen that is asking something of the player rather than reporting.
  body.append(renderClaims(sim));
  body.append(renderMissionsUnderway(sim));
  body.append(renderHeroes(sim));
  if (sim.world.heroes.length > 0) {
    body.append(renderDestinations(sim));
    body.append(renderSupplies(sim));
    body.append(renderSendButton(sim));
  }

  /*
   * Two windows, not one panel with a column in it.
   *
   * The tavern is its own thing — a place you visit between expeditions, not a
   * step in sending one — and as a section inside the roster it inherited the
   * roster's scroll, so browsing 45 faces dragged the send button off screen.
   * Given its own panel it scrolls on its own and can lay its faces out on a
   * grid that suits them rather than one sized for the sequence beside it.
   */
  return el('div', { class: 'panel-pair' }, [
    el('div', { class: 'panel panel-roomy' }, [
      panelHeader(t('roster.title'), t('roster.subtitle')),
      body,
    ]),
    renderTavern(sim),
  ]);
}

/**
 * Parties home and unclaimed.
 *
 * One card per party with a single button, because the haul is deliberately not
 * shown here — the point of the claim is that opening it is the moment you find
 * out. What the card does say is who came back and where from, so a player with
 * three parties out knows which one they are about to open.
 */
function renderClaims(sim: Simulation): HTMLElement {
  if (sim.pendingClaims.length === 0) return el('span');

  const rows = sim.pendingClaims.map((outcome) =>
    row({
      variant: 'mission is-home',
      title: t(`biome.${outcome.biomeId}`),
      sub: [
        chip(t('roster.home'), 'good'),
        chip(outcome.heroIds.map((id) => t(`hero.${id}`)).join(', ')),
      ],
      actions: [
        button(t('roster.claim'), () => showMissionReward(sim, outcome.missionId), {
          variant: 'gold',
        }),
      ],
    }),
  );

  return el('section', { class: 'missions' }, [
    el('span', { class: 'field-label', text: t('roster.returned') }),
    ...rows,
  ]);
}

function renderMissionsUnderway(sim: Simulation): HTMLElement {
  if (sim.world.missions.length === 0) return el('span');

  const rows = sim.world.missions.map((mission) => {
    /*
     * The clock is marked, not redrawn.
     *
     * `data-countdown-*` and `data-progress-*` are what the shell patches each
     * frame, which is what keeps the timer moving without rebuilding the panel
     * — and rebuilding the panel is what used to make this screen unclickable
     * the moment a party was out.
     */
    const clock = liveCountdown(mission.returnsAt, sim.now, {
      key: 'roster.returns',
      className: 'chip plain',
    });
    const bar = liveMeter(mission.startedAt, mission.returnsAt, sim.now);

    return row({
      variant: 'mission',
      title: t(`biome.${mission.biomeId}`),
      sub: [clock, chip(mission.heroIds.map((id) => t(`hero.${id}`)).join(', '))],
      extra: [bar],
    });
  });

  return el('section', { class: 'missions' }, [
    el('span', { class: 'field-label', text: t('roster.underway') }),
    ...rows,
  ]);
}

function renderHeroes(sim: Simulation): HTMLElement {
  if (sim.world.heroes.length === 0) {
    return el('section', { class: 'heroes' }, [
      el('span', { class: 'field-label', text: t('roster.heroes') }),
      emptyNote(t('roster.heroes.empty')),
    ]);
  }

  /*
   * Only the people you can actually do something with.
   *
   * Anyone out — walking, or home and not yet greeted — is already shown above,
   * on their own expedition's card. Listing them again meant a shop with five
   * parties out scrolled past fifteen inert rows to reach the three heroes it
   * could still send. Injured heroes stay: they are here, and they can be healed.
   */
  const here = sim.world.heroes.filter((hero) => !hero.onMission);
  if (here.length === 0) {
    return collapsible({
      className: 'heroes',
      title: t('roster.heroes'),
      open: !folded.has('heroes'),
      onToggle: fold('heroes'),
      body: [emptyNote(t('roster.heroes.allOut'))],
    });
  }

  const rows = here.map((hero) => {
    const def = getHeroDef(hero.id);
    const band = favourBandOf(hero.favour);
    const hurt = isInjured(hero, sim.now);
    const selected = selectedHeroes.includes(hero.id);

    const toggle = () => {
      selectedHeroes = selected
        ? selectedHeroes.filter((id) => id !== hero.id)
        : [...selectedHeroes, hero.id].slice(0, heroesConfig.partySize);
      changed();
    };

    /*
     * The card opens the person; the button picks them.
     *
     * Tapping someone briefly toggled selection instead, which is the wrong
     * meaning for a tap on a face — the same gesture in the tavern has to open
     * a hero, and a roster where tapping does something different from a tavern
     * where it does another is two rules to remember. Choosing who goes stays
     * on its own button, where it is also the only thing that can be undone by
     * pressing the same place twice.
     */
    const open = () => showHeroInfo(sim, hero.id, hero);

    const sub: Array<Node | string> = [
      chip(t('roster.level', { level: effectiveLevel(hero) })),
      chip(t(`favour.${band.id}`), band.id === 'wary' ? 'plain' : 'good'),
      chip(t(`biome.${def.affinity}`)),
    ];
    if (hurt) {
      sub.push(
        liveCountdown(hero.injuredUntil ?? 0, sim.now, {
          key: 'roster.injured',
          className: 'chip warn',
        }),
      );
    }
    const actions: HTMLElement[] = [];
    if (hurt) {
      // The cheapest remedy on hand, the way a barter spends the cheapest
      // bottles: healing asks for a potion, not for the best one you have.
      const remedy = sim.world.bottled
        .filter((item) => item.recipeId === HEALING_RECIPE)
        .reduce<(typeof sim.world.bottled)[number] | undefined>(
          (best, item) => (best === undefined || item.fairValue < best.fairValue ? item : best),
          undefined,
        );
      actions.push(
        button(
          t('roster.heal'),
          () => {
            if (remedy && sim.heal(hero.id, remedy.uid)) {
              toast(t('roster.healed', { hero: t(`hero.${hero.id}`) }));
              changed();
            }
          },
          { small: true, variant: 'ghost', disabled: !remedy },
        ),
      );
    } else {
      /*
       * One width for both labels.
       *
       * "Leave behind" is wider than "Take along", so the button grew on
       * selection and shoved the favour bar and the chips left — the whole row
       * twitched every time you picked someone. The class fixes a minimum wide
       * enough for either word, so only the text inside it changes.
       */
      /*
       * A full party offers nobody else.
       *
       * The press used to go through and do nothing — the selection is capped
       * at the party size, so a fourth pick was sliced straight back off — which
       * reads as a broken button rather than as a rule.
       */
      const partyFull = !selected && selectedHeroes.length >= heroesConfig.partySize;
      const pick = button(selected ? t('roster.deselect') : t('roster.select'), toggle, {
        small: true,
        variant: selected ? 'amber' : 'ghost',
        disabled: partyFull,
        title: partyFull ? t('roster.partyFull', { count: heroesConfig.partySize }) : undefined,
      });
      pick.classList.add('hero-pick');
      pick.setAttribute('aria-pressed', String(selected));
      actions.push(pick);
    }

    const face = portrait('hero', hero.id);

    return row({
      variant: face ? 'hero has-portrait' : 'hero',
      icon: face ?? undefined,
      title: t(`hero.${hero.id}`),
      sub,
      extra: [el('div', { class: 'favour-bar' }, [meter(hero.favour / 100)])],
      actions,
      selected,
      data: { pickable: 'true', ...(hurt ? { hurt: 'true' } : {}) },
      onClick: open,
    });
  });

  // No slot count here: it is a fact about hiring, and hiring happens in the
  // tavern beside this. Said in both places it was noise in one of them.
  // Said where it can be read, not only in the greyed buttons' tooltips, which
  // a touchscreen never shows.
  // Only while someone is actually being turned away.
  const full =
    selectedHeroes.length >= heroesConfig.partySize &&
    here.some((hero) => isAvailable(hero, sim.now) && !selectedHeroes.includes(hero.id));
  return collapsible({
    className: 'heroes',
    title: t('roster.heroes'),
    open: !folded.has('heroes'),
    onToggle: fold('heroes'),
    body: [
      ...(full
        ? [
            el('p', {
              class: 'field-note',
              text: t('roster.partyFull', { count: heroesConfig.partySize }),
            }),
          ]
        : []),
      ...rows,
    ],
  });
}

function renderDestinations(sim: Simulation): HTMLElement {
  const rank = rankOf(sim.world);

  const tiles = heroesConfig.biomes.map((biome) => {
    const locked = rank < biome.requiresRank;
    return slot({
      id: biome.id,
      icon: el('span', { class: 'slot-glyph', text: '🧭' }),
      label: t(`biome.${biome.id}`),
      caption: locked ? t('market.reason.rank') : formatDuration(biome.durationMs),
      selected: selectedBiome === biome.id,
      disabled: locked,
      onActivate: () => {
        selectedBiome = selectedBiome === biome.id ? null : biome.id;
        changed();
      },
    });
  });

  const body: HTMLElement[] = [slotGrid(tiles)];

  /*
   * What the chosen place actually yields, and how often.
   *
   * A destination was a name and a duration, which makes the choice between
   * them arbitrary — the only real difference is what comes back, and that was
   * only discoverable by going. Each find shows its own art and its own odds,
   * and opens the same details panel the Grounds uses, so an unfamiliar
   * ingredient is one tap from an explanation rather than a name to look up.
   */
  const chosen = heroesConfig.biomes.find((biome) => biome.id === selectedBiome);
  if (chosen) {
    /*
     * The rare table only opens if the rare-find roll lands, and that roll
     * answers to the party — level, favour, a lucky hero, what they are
     * carrying. So once heroes are picked the real estimate is used, and only
     * the bare biome number stands in before that.
     */
    const rareChance =
      selectedHeroes.length > 0
        ? sim.estimate(chosen.id, selectedHeroes, selectedSupplies).rareFind
        : chosen.baseRareFind;

    const finds = [
      ...odds(chosen.loot, (share) => 1 - (1 - share) ** LOOT_DRAWS),
      ...odds(chosen.rare, (share) => share * rareChance),
    ]
      .sort((a, b) => b.chance - a.chance)
      .slice(0, FINDS_SHOWN)
      .map((entry) => {
        const name = findLabel(entry.kind, entry.ingredientId);
        const node = el('button', { class: 'find', type: 'button' }, [
          ingredientIcon(entry.ingredientId, 34),
          el('span', { class: 'find-name', text: name }),
          el('span', { class: 'find-odds', text: formatPercent(entry.chance) }),
        ]);
        node.setAttribute('aria-label', name);
        node.addEventListener('click', () => showIngredientInfo(sim, entry.ingredientId));
        return node;
      });

    body.push(
      // What the place is like, where it can actually be read. It was the
      // chosen tile's `title`, which is to say: nowhere, on a phone.
      el('p', { class: 'field-note', text: t(`biome.${chosen.id}.blurb`) }),
      el('span', { class: 'field-label', text: t('roster.finds') }),
      el('div', { class: 'find-row' }, finds),
    );
  }

  return collapsible({
    className: 'destinations',
    title: t('roster.destination'),
    note: chosen ? t(`biome.${chosen.id}`) : undefined,
    open: !folded.has('destinations'),
    onToggle: fold('destinations'),
    body,
  });
}

/**
 * Each entry's share of its own table, turned into a chance of seeing it.
 *
 * Weights are relative within a table, so a share is only meaningful once
 * divided by the total — and what the player wants is not the share but the
 * probability the mission actually comes back holding one, which is what the
 * caller's function supplies.
 */
function odds(
  table: ReadonlyArray<LootEntry>,
  chanceOf: (share: number) => number,
): Array<{ kind?: FindKind; ingredientId: string; chance: number }> {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return [];
  return table.map((entry) => ({
    kind: entry.kind,
    ingredientId: entry.ingredientId,
    chance: chanceOf(entry.weight / total),
  }));
}

/**
 * Bottles that are the same bottle, as one tile.
 *
 * Two potions the mission maths cannot tell apart should not be two decisions.
 * The key is everything that tells two bottles apart — recipe, grade and
 * potency — so a stack is safe to spend from in any order.
 *
 * Without this a well-stocked shop laid out several hundred near-identical
 * icons, and finding the right one meant reading all of them.
 */
function supplyStacks(sim: Simulation) {
  const stacks = new Map<string, { items: typeof sim.world.bottled; sort: string }>();

  for (const item of sim.world.bottled) {
    const key = `${item.recipeId}:${item.grade}:${item.potencyTier}`;
    const stack = stacks.get(key);
    if (stack) stack.items.push(item);
    else stacks.set(key, { items: [item], sort: `${item.grade}${t(`recipe.${item.recipeId}`)}` });
  }

  return [...stacks.values()].sort((a, b) => a.sort.localeCompare(b.sort));
}

function renderSupplies(sim: Simulation): HTMLElement {
  const slots = heroesConfig.supplies.slots;

  /*
   * Filtered where the list is built, not by hiding tiles afterwards.
   *
   * A shop late in a run holds a couple of hundred kinds of bottle, and the
   * question this box answers — "have I got any Umbra potions" — is about the
   * whole rack. The shell puts the caret back after the rebuild each keystroke
   * causes; see `captureFocus`.
   */
  const stacks = supplyStacks(sim).filter((stack) => {
    const first = stack.items[0]!;
    return matchesSearch(supplyQuery, t(`recipe.${first.recipeId}`), first.grade);
  });

  const tiles = stacks.map((stack) => {
    const first = stack.items[0]!;
    const taken = stack.items.filter((item) => selectedSupplies.includes(item.uid));

    const caption: Array<Node | string> = [gradeBadge(first.grade), goldText(first.fairValue)];
    if (taken.length > 0) {
      caption.push(el('span', { class: 'supply-taken', text: `×${taken.length}` }));
    }

    /*
     * The tile is a door; the stepper is the decision.
     *
     * Tapping a bottle used to pack it, which meant the only way to look at
     * something was to commit to it — and a bottle carries a grade and a purity
     * that decide how much it is worth to a party. Reading and
     * choosing are separate gestures now, the way they already are in the
     * tavern.
     */
    const tile = slot({
      id: first.uid,
      icon: potionIcon(first.recipeId),
      label: t(`recipe.${first.recipeId}`),
      caption,
      count: stack.items.length,
      selected: taken.length > 0,
      onActivate: () => showPotionInfo(sim, first, stack.items.length),
    });

    const spare = stack.items.find((item) => !selectedSupplies.includes(item.uid));
    const canAdd = spare !== undefined && selectedSupplies.length < slots;

    const step = (label: string, title: string, enabled: boolean, run: () => void) => {
      const node = el('button', { class: 'supply-step', type: 'button', title, text: label });
      node.setAttribute('aria-label', title);
      node.disabled = !enabled;
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        run();
        changed();
      });
      return node;
    };

    return el('div', { class: 'supply-tile' }, [
      tile,
      el('div', { class: 'supply-steps' }, [
        step('−', t('roster.supplies.remove'), taken.length > 0, () => {
          const last = taken[taken.length - 1]!;
          selectedSupplies = selectedSupplies.filter((uid) => uid !== last.uid);
        }),
        el('span', { class: 'supply-step-count num', text: String(taken.length) }),
        step('+', t('roster.supplies.add'), canAdd, () => {
          /*
           * Guarded rather than appended.
           *
           * `spare` is the bottle this button was drawn for, so a press that
           * arrives twice — which a touchscreen does when the panel is rebuilt
           * under the finger — asks to pack the same bottle again. Appending
           * blindly put its uid in the list twice: the tile still read "1", but
           * two of the three slots were gone and the party counted one bottle's
           * grade bonus twice.
           */
          if (spare && !selectedSupplies.includes(spare.uid)) {
            selectedSupplies = [...selectedSupplies, spare.uid];
          }
        }),
      ]),
    ]);
  });

  const search = searchField({
    name: 'roster-supplies',
    value: supplyQuery,
    placeholder: t('roster.supplies.search'),
    onInput: (query) => {
      supplyQuery = query;
      changed();
    },
  });

  // "Nothing matches" and "you have no bottles" are different facts, and only
  // one of them is worth an instruction about brewing.
  const empty = supplyQuery.trim() ? t('common.search.none') : t('roster.supplies.empty');

  return collapsible({
    className: 'supplies',
    title: t('roster.supplies'),
    note: t('roster.supplies.hint', { slots }),
    open: !folded.has('supplies'),
    onToggle: fold('supplies'),
    body: [search, slotGrid(tiles, empty)],
  });
}

function renderSendButton(sim: Simulation): HTMLElement {
  const ready = selectedBiome !== null && selectedHeroes.length > 0;
  const section = el('section', { class: 'send' });

  /*
   * Nothing said until there is something to say.
   *
   * The hint that stood here — "Choose who goes and where" — restated the two
   * sections directly above it, in a box that exists to report odds. An empty
   * readout is quieter and just as clear: the Send button is already disabled,
   * which is the same information without a sentence.
   */
  if (ready) {
    const estimate = sim.estimate(selectedBiome!, selectedHeroes, selectedSupplies);
    section.append(
      outcomeCard({
        name: t(`biome.${selectedBiome}`),
        chips: [chip(formatDuration(estimate.durationMs))],
        body: [
          stat(t('roster.success'), formatPercent(estimate.success), 'good'),
          stat(t('roster.rareFind'), formatPercent(estimate.rareFind)),
          stat(
            t('roster.injury'),
            formatPercent(estimate.injury),
            estimate.injury > 0.2 ? 'bad' : undefined,
          ),
          ...(estimate.favouriteSupplied
            ? [stat(t('roster.favourite'), t('roster.favourite.yes'), 'good')]
            : []),
        ],
      }),
    );
  }

  /*
   * The one thing this whole screen builds toward, sized like it.
   *
   * It sat right-aligned in a `row-actions` strip at small-button size, the
   * same weight as "Heal" — which puts the commitment of three heroes and three
   * potions on the same footing as tidying up. Centred, larger and gold: gold
   * is used for the thing you are working toward, and nothing else on the
   * screen is competing for it.
   */
  section.append(
    el('div', { class: 'send-action' }, [
      button(
        t('roster.send'),
        () => {
          if (!selectedBiome) return;
          if (sim.send(selectedBiome, selectedHeroes, selectedSupplies)) {
            toast(t('roster.sent'));
            resetRosterSelection();
            changed();
          }
        },
        { disabled: !ready, variant: 'gold' },
      ),
    ]),
  );

  return section;
}

/*
 * Forty-five faces need an order, and usually a shorter list.
 *
 * Two different questions, so two different controls. Price and level are
 * *orderings* and both are asked in both directions — the cheapest I can take
 * on, or the best I can afford — so the active one flips rather than being one
 * fixed opinion about which end matters. Favoured ground is not an ordering at
 * all: nobody wants heroes grouped by area, they want the ones who know the
 * place they are about to send a party, so it filters.
 */
const TAVERN_SORTS = ['price', 'level'] as const;
type TavernSort = (typeof TAVERN_SORTS)[number];

let tavernSort: TavernSort = 'price';
let tavernDir: 'asc' | 'desc' = 'asc';
/** Biome id, or null for everyone. */
let tavernArea: string | null = null;

function sortTavern(defs: typeof heroesConfig.roster): typeof heroesConfig.roster {
  const byName = (a: { id: string }, b: { id: string }) =>
    t(`hero.${a.id}`).localeCompare(t(`hero.${b.id}`));

  const filtered = tavernArea ? defs.filter((def) => def.affinity === tavernArea) : defs;

  const sign = tavernDir === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const by =
      tavernSort === 'price'
        ? recruitCostOf(a.id) - recruitCostOf(b.id)
        : a.baseLevel - b.baseLevel;
    // Name breaks ties in reading order whichever way the column runs.
    return by * sign || byName(a, b);
  });
}

function renderTavern(sim: Simulation): HTMLElement {
  const recruitable = sortTavern(
    heroesConfig.roster.filter((def) => !sim.world.heroes.some((hero) => hero.id === def.id)),
  );
  const free = Math.max(0, sim.heroSlots - sim.world.heroes.length);
  const full = free === 0;

  /*
   * A tile opens the person; it does not hire them.
   *
   * One tap used to cost 180 gold and a roster place, on the only control that
   * was also the only way to learn who you were hiring — their face, their
   * ground and their line of description all lived in a `title` attribute,
   * which a touchscreen never shows at all. The tile is now a door, and the
   * money is spent behind it.
   */
  /*
   * A face, then a name and a price on one line beneath it.
   *
   * The generic tile stacks icon, label and caption, which at portrait size put
   * the name straight over the chin — and left the price on a third line that
   * the card had no room for. A card built for this puts the picture on top and
   * the two facts about it side by side under the frame, where neither covers
   * anything and both read at a glance.
   */
  const cards = recruitable.map((def) => {
    const face = portrait('hero', def.id);
    const card = el('button', { class: 'tavern-card', type: 'button' }, [
      face ?? el('span', { class: 'slot-glyph', text: '🎖' }),
      el('div', { class: 'tavern-card-foot' }, [
        el('span', { class: 'tavern-card-name', text: t(`hero.${def.id}`) }),
        full
          ? el('span', { class: 'tavern-card-price', text: t('roster.full') })
          : goldText(recruitCostOf(def.id), 'tavern-card-price'),
      ]),
    ]);
    card.addEventListener('click', () => showHeroInfo(sim, def.id, null));
    return card;
  });

  const chip_ = (label: string, active: boolean, onClick: () => void) => {
    const node = el('button', { class: 'sort-chip', type: 'button', text: label });
    node.setAttribute('aria-pressed', String(active));
    node.addEventListener('click', () => {
      onClick();
      changed();
    });
    return node;
  };

  const sorts = el(
    'div',
    { class: 'sort-row' },
    TAVERN_SORTS.map((id) => {
      const active = tavernSort === id;
      // The arrow is on the active one only — a column that is not sorting
      // anything has no direction to advertise.
      const label = `${t(`roster.sort.${id}`)}${active ? (tavernDir === 'asc' ? ' ↑' : ' ↓') : ''}`;
      return chip_(label, active, () => {
        // Pressing the one already sorting flips it; picking a new one starts
        // at the end a player asks for first — cheapest, and strongest.
        if (active) tavernDir = tavernDir === 'asc' ? 'desc' : 'asc';
        else {
          tavernSort = id;
          tavernDir = id === 'price' ? 'asc' : 'desc';
        }
      });
    }),
  );

  const areas = el('div', { class: 'sort-row' }, [
    chip_(t('roster.sort.allAreas'), tavernArea === null, () => {
      tavernArea = null;
    }),
    ...heroesConfig.biomes.map((biome) =>
      chip_(t(`biome.${biome.id}`), tavernArea === biome.id, () => {
        // Tapping the chosen area again clears it, so the filter is escapable
        // without hunting for "All".
        tavernArea = tavernArea === biome.id ? null : biome.id;
      }),
    ),
  ]);

  const body = el('div', { class: 'panel-body' }, [
    ...(recruitable.length > 0 || tavernArea !== null ? [sorts, areas] : []),
    cards.length > 0
      ? el('div', { class: 'tavern-grid' }, cards)
      : emptyNote(tavernArea ? t('roster.tavern.noneHere') : t('roster.tavern.empty')),
  ]);

  /*
   * What is left, not what is used.
   *
   * "2 of 3 recruited" is a sum the reader has to do before it answers the only
   * question this panel raises — can I take this person on? The remainder says
   * it outright, and at zero it stops being a number and becomes the answer.
   */
  return el('div', { class: 'panel tavern-panel' }, [
    panelHeader(
      t('roster.tavern'),
      full ? t('roster.noSlots') : t('roster.slotsLeft', { count: free }),
    ),
    body,
  ]);
}
