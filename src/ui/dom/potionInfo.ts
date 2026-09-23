/**
 * What a bottled potion actually is.
 *
 * A finished bottle carries more than its name and grade — the purity it was
 * poured at, how much essence is in it, what it is stoppered with, and whether
 * that stopper makes it worth more to a hero than to a customer. All of that was
 * decided at the workbench and then never shown again, so a shelf of forty
 * bottles was forty names and a letter.
 *
 * Opened from anywhere a bottle is drawn; the caller decides what tapping means
 * elsewhere on the tile.
 */

import {
  chip,
  gradeBadge,
  infoActions,
  infoFacts,
  infoHead,
  infoNote,
  modal,
  potionIcon,
  stat,
} from './components';
import type { QuantityActionSpec } from './components';
import { formatGold, formatNumber, t } from '@/i18n';
import { getHeroDef } from '@/sim/config';
import type { Simulation } from '@/sim/sim';
import type { BottledItem } from '@/sim/types';

/**
 * Anything about this bottle that is true of *this* bottle.
 *
 * Recipes carry no effect: the Umbra potion and the Ignis–Terra one differ in blend
 * and price and in nothing else, so listing "sells from a shelf" and "packs as
 * supplies" against each one said the same two things on every potion in the
 * game. What is left is the pair of facts that actually vary — somebody on the
 * roster is fond of it, or something on the board is waiting for it.
 *
 * Empty most of the time, and that is correct: no line means no reason beyond
 * its grade and its price.
 */
function notesOn(sim: Simulation, item: BottledItem): string[] {
  const notes: string[] = [];

  const admirers = sim.world.heroes.filter(
    (hero) => getHeroDef(hero.id).favourite === item.recipeId,
  );
  if (admirers.length > 0) {
    notes.push(
      t('potionInfo.use.favourite', {
        heroes: admirers.map((hero) => t(`hero.${hero.id}`)).join(', '),
      }),
    );
  }

  if (sim.world.contracts.some((contract) => contract.terms?.recipeId === item.recipeId)) {
    notes.push(t('potionInfo.use.contract'));
  }

  return notes;
}

/**
 * What a bottle is, and — where there is one — what to do with it.
 *
 * The action is what the tile's own click used to be. It lives here so a tap on
 * a bottle means the same thing as a tap on a seed or a jar of stock: tell me
 * about this, and then let me act on it.
 */
export function showPotionInfo(
  sim: Simulation,
  item: BottledItem,
  count = 1,
  action?: QuantityActionSpec,
): void {
  const facts: HTMLElement[] = [
    stat(t('potionInfo.purity'), `${Math.round(item.purity)} / 100`),
    stat(t('potionInfo.essence'), formatNumber(Math.round(item.totalEssence))),
  ];

  facts.push(stat(t('potionInfo.value'), formatGold(item.fairValue), 'good'));

  modal({
    className: 'potion-info',
    content: (dismiss) => [
      infoHead({
        art: potionIcon(item.recipeId, 44),
        title: t(`recipe.${item.recipeId}`),
        chips: [
          gradeBadge(item.grade),
          chip(t(`potency.${item.potencyTier}`)),
          // Only where there is a stack behind the tile that was tapped.
          ...(count > 1 ? [chip(t('potionInfo.held', { count }))] : []),
        ],
      }),
      infoFacts(facts),
      // Unheaded, under the figures: a remark about the bottle rather than
      // another field of it.
      ...notesOn(sim, item).map(infoNote),
      infoActions({ dismiss, action }),
    ],
  });
}
