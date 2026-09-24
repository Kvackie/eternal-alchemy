/**
 * Which build this is, as a line of text.
 *
 * Shown in the HUD on every screen, so a report of a bug or a screenshot says
 * which deploy it came from without anyone having to ask.
 */

import { t } from '@/i18n';

/**
 * "24 Sep 2026", in UTC so every viewer sees the day it was built.
 *
 * Assembled from parts: en-GB's short September is "Sept", the one month
 * that breaks the three-letter column.
 */
const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

function buildDate(iso: string): string {
  const at = new Date(iso);
  return `${at.getUTCDate()} ${monthName.format(at)} ${at.getUTCFullYear()}`;
}

export function versionLabel(): string {
  return t('hud.version', {
    version: __BUILD__.version,
    commit: __BUILD__.commit,
    date: buildDate(__BUILD__.date),
  });
}
