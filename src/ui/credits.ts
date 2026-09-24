/**
 * Who made what the game is built from, for the Credits page.
 *
 * Data, not prose: the names, licences and links are facts that must match
 * what ships, so they live beside the code that ships them. The icon authors
 * are read from the icon data itself, so adding an icon by someone new cannot
 * leave them uncredited.
 */

import { iconsByAuthor } from '@/ui/icons';

export interface Credit {
  /** What it is — a typeface, an icon set, an engine. */
  work: string;
  by: string;
  licence: string;
  licenceUrl: string;
  /** Where it came from. */
  source: string;
  /** Anything worth adding, such as which pieces were used. */
  detail?: string;
}

export interface CreditGroup {
  /** i18n key for the group's heading. */
  heading: string;
  credits: Credit[];
}

const OFL = 'SIL Open Font License 1.1';

export function credits(): CreditGroup[] {
  return [
    {
      heading: 'credits.fonts',
      credits: [
        {
          work: 'Cinzel',
          by: 'Natanael Gama, The Cinzel Project Authors',
          licence: OFL,
          // Shipped beside the game, as the licence asks.
          licenceUrl: 'licenses/Cinzel-OFL.txt',
          source: 'https://github.com/NDISCOVER/Cinzel',
        },
        {
          work: 'Alegreya Sans',
          by: 'Juan Pablo del Peral, Huerta Tipográfica',
          licence: OFL,
          licenceUrl: 'licenses/AlegreyaSans-OFL.txt',
          source: 'https://github.com/huertatipografica/Alegreya-Sans',
        },
      ],
    },
    {
      heading: 'credits.icons',
      credits: iconsByAuthor().map((author) => ({
        work: 'game-icons.net',
        by: author.name,
        licence: 'CC BY 3.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
        source: author.url,
        detail: author.icons.join(', '),
      })),
    },
    {
      heading: 'credits.engine',
      credits: [
        {
          work: 'Phaser',
          by: 'Richard Davey, Phaser Studio Inc.',
          licence: 'MIT',
          licenceUrl: 'https://github.com/phaserjs/phaser/blob/master/LICENSE.md',
          source: 'https://phaser.io',
        },
      ],
    },
  ];
}
