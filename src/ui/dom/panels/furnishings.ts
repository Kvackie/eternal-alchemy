/**
 * The furnishings: five spots, and what stands in each.
 *
 * Décor has to be placed to do anything, and the shop has fewer spots than
 * there are pieces, so this is where the collection becomes a choice. A spot
 * is a row — its picture, its name, what is out and how many pieces could be
 * — and tapping it opens the pieces made for it. Buying a piece for a spot
 * something already stands in leaves the standing piece alone; the swap is
 * made here, on purpose.
 *
 * Drawn on the Shop's floor, under the shelves, which is where the pieces
 * stand. Its own module so the Shop, already the busiest panel, does not grow
 * by another dialog.
 */

import {
  button,
  chip,
  el,
  modal,
  row,
  sectionHead,
  slot,
  slotGlyph,
  slotGrid,
} from '../components';
import { formatGold, t } from '@/i18n';
import { artUrlIf } from '@/ui/art';
import { goodsNotes } from '../goods';
import { changed, toast } from '@/ui/bus';

import type { SpotView } from '@/sim/decor';
import type { Simulation } from '@/sim/sim';

export function renderDecor(sim: Simulation): HTMLElement {
  const rows = sim.decorSpots().map((view) => {
    const placedArt = view.placed ? artUrlIf('decor', view.placed.id) : null;
    const owned = view.options.filter((option) => option.owned).length;

    return row({
      variant: 'spot',
      key: `spot-${view.spot}`,
      icon: placedArt
        ? el('img', { class: 'decor-thumb', src: placedArt, alt: '', width: '40', height: '40' })
        : slotGlyph('decor'),
      title: t(`decor.spot.${view.spot}`),
      sub: [
        chip(view.placed ? t(`decor.${view.placed.id}`) : t('decor.spot.empty')),
        ...(owned > 0 ? [chip(t('shop.decor.owned', { count: owned }))] : []),
      ],
      onClick: () => openDecorPicker(sim, view),
    });
  });

  return el('section', { class: 'decor' }, [
    sectionHead(t('shop.decor'), t('shop.decor.hint')),
    ...rows,
  ]);
}

/** What stands in this spot? Every piece made for it, owned or not. */
function openDecorPicker(sim: Simulation, view: SpotView): void {
  modal({
    content: (dismiss) => [
      el('h2', { text: t('shop.decor.pick', { spot: t(`decor.spot.${view.spot}`) }) }),
      slotGrid(
        view.options.map(({ def, owned }) => {
          const placed = view.placed?.id === def.id;
          const art = artUrlIf('decor', def.id);
          const notes = goodsNotes('decor', def.id);
          return slot({
            id: def.id,
            icon: art
              ? el('img', { class: 'art-icon', src: art, alt: '', width: '34', height: '34' })
              : slotGlyph('decor'),
            label: t(`decor.${def.id}`),
            /*
             * The figures, which is what a choice needs: the picker is the one
             * screen where you decide between a banner worth +10% footfall and
             * one worth +44%. A piece not yet bought says what it would cost.
             */
            caption: placed
              ? t('shop.decor.out')
              : owned
                ? (notes[0] ?? t(`decor.${def.id}.detail`))
                : t('decor.notOwned', { cost: formatGold(def.cost) }),
            selected: placed,
            dimmed: !owned,
            title: [t(`decor.${def.id}.detail`), ...notes].join('\n'),
            onActivate:
              owned && !placed
                ? () => {
                    dismiss();
                    if (sim.place(def.id)) {
                      toast(t('shop.decor.placed', { item: t(`decor.${def.id}`) }));
                      changed();
                    }
                  }
                : undefined,
          });
        }),
      ),
      el('div', { class: 'dialog-actions' }, [
        ...(view.placed
          ? [
              button(
                t('shop.decor.takeDown'),
                () => {
                  dismiss();
                  const name = t(`decor.${view.placed!.id}`);
                  if (sim.clearSpot(view.spot)) {
                    toast(t('shop.decor.cleared', { item: name }));
                    changed();
                  }
                },
                { variant: 'quiet' },
              ),
            ]
          : []),
        button(t('common.close'), dismiss, { variant: 'quiet' }),
      ]),
    ],
  });
}
