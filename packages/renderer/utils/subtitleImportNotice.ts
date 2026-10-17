import { i18n } from '../i18n';
import { useUrlStore } from '../state/url-store';

/** Tell the user when an imported SRT had cues whose timing couldn't be read. */
export function reportUnreadableCues(count: number | null | undefined): void {
  if (!count || count <= 0) return;
  useUrlStore
    .getState()
    .setValidationError(
      i18n.t(
        'subtitles.unreadableCues',
        '{{count}} lines in this file could not be read and were left out. Check their timecodes.',
        { count }
      )
    );
}
