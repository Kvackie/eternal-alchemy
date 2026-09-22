/**
 * Who a hero is, before you decide anything about them.
 *
 * Recruiting used to happen on a single tap of a tavern tile — 180 gold and a
 * roster place gone on the same click that was the only way to find out who you
 * were looking at. The face, the affinity and the blurb were all in a `title`
 * attribute, which is to say invisible on a touchscreen and slow everywhere
 * else.
 *
 * So the tap opens the person instead, and the commitment is a second,
 * deliberate press. The same panel serves both directions: for someone in the
 * tavern it offers to take them on, and for someone already on the roster it
 * offers to let them go. Nothing else about it changes, because nothing else
 * about them changes.
 */

import {
  button,
  chip,
  el,
  infoActions,
  infoFacts,
  infoHead,
  modal,
  portrait,
  potionIcon,
  stat,
} from './components';
import { countdown, formatGold, t } from '@/i18n';
import { getHeroDef } from '@/sim/config';
import { effectiveLevel, favourBandOf, isInjured, recruitCostOf } from '@/sim/heroes';
import type { Simulation } from '@/sim/sim';
import type { Hero } from '@/sim/types';
import { changed, toast } from '@/ui/bus';

/**
 * The dialog, for a hero on the roster or one still in the tavern.
 *
 * `hero` is null for a recruit: everything shown then comes from the definition,
 * since an unrecruited hero has no favour, no injuries and no record.
 */
export function showHeroInfo(sim: Simulation, heroId: string, hero: Hero | null): void {
  // Built inside the modal because the buttons in it — hire, dismiss, heal —
  // close the dialog, so they need the way out that `modal` hands them.
  modal({ content: (dismiss) => [buildHeroInfo(sim, heroId, hero, dismiss)] });
}

function buildHeroInfo(
  sim: Simulation,
  heroId: string,
  hero: Hero | null,
  dismiss: () => void,
): HTMLElement {
  const def = getHeroDef(heroId);

  const face = portrait('hero', heroId);

  const tags: HTMLElement[] = [];
  if (hero) {
    const band = favourBandOf(hero.favour);
    tags.push(chip(t('roster.level', { level: effectiveLevel(hero) })));
    tags.push(chip(t(`favour.${band.id}`), band.id === 'wary' ? 'plain' : 'good'));
    if (hero.onMission) tags.push(chip(t('roster.away'), 'warn'));
    if (isInjured(hero, sim.now)) {
      tags.push(
        chip(
          t('roster.injured', {
            time: countdown((hero.injuredUntil ?? 0), sim.now),
          }),
          'warn',
        ),
      );
    }
  } else {
    tags.push(chip(t('roster.level', { level: def.baseLevel })));
  }
  for (const trait of def.traits) tags.push(chip(t(`heroTrait.${trait}`)));

  const facts = infoFacts([
    stat(t('heroInfo.affinity'), t(`biome.${def.affinity}`)),
    stat(t('heroInfo.favourite'), [
      potionIcon(def.favourite, 16),
      el('span', { text: t(`recipe.${def.favourite}`) }),
    ]),
    ...(hero ? [stat(t('heroInfo.missions'), String(hero.missionsCompleted))] : []),
  ]);

  const actions: HTMLElement[] = [];

  /*
   * Why a button is greyed out, written where it can be read.
   *
   * It was the button's `title`, and a tooltip on a disabled control is the
   * least reachable thing in a user interface: a touchscreen never shows one,
   * and several browsers suppress it on a disabled element even with a mouse.
   * So "you cannot afford this" was information the game had and never gave.
   */
  const reasons: string[] = [];
  if (hero) {
    const away = hero.onMission;
    actions.push(
      button(
        t('heroInfo.dismiss'),
        () => {
          if (sim.dismissHero(heroId)) {
            toast(t('heroInfo.dismissed', { hero: t(`hero.${heroId}`) }));
            dismiss();
            changed();
          }
        },
        { variant: 'warm', disabled: away },
      ),
    );
    if (away) reasons.push(t('roster.away'));
  } else {
    const full = sim.world.heroes.length >= sim.heroSlots;
    const cost = recruitCostOf(heroId);
    const poor = sim.world.gold < cost;
    actions.push(
      button(
        t('heroInfo.recruit', { cost: formatGold(cost) }),
        () => {
          if (sim.recruitHero(heroId)) {
            toast(t('roster.recruited', { hero: t(`hero.${heroId}`) }));
            dismiss();
            changed();
          }
        },
        { disabled: full || poor },
      ),
    );
    if (full) reasons.push(t('roster.full'));
    else if (poor) reasons.push(t('heroInfo.tooPoor'));
  }
  const body = el('div', { class: 'hero-info' }, [
    // Unframed: a portrait is already a picture with an edge of its own.
    infoHead({ art: face, framed: false, title: t(`hero.${heroId}`), chips: tags }),

    el('p', { class: 'hero-info-blurb', text: t(`hero.${heroId}.blurb`) }),

    facts,

    ...reasons.map((reason) => el('p', { class: 'field-note dialog-reason', text: reason })),
    // Cancel rather than Close: this dialog offers to take someone on or let
    // them go, so backing out of it is backing out of a decision.
    infoActions({ dismiss, before: actions, closeLabel: t('common.cancel') }),
  ]);

  return body;
}
