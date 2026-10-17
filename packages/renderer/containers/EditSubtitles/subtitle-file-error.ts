import {
  classifyError,
  formatUserFacingError,
} from '../../utils/userFacingError';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Opening or saving an .srt fails with raw main-process text ("ENOENT: no
 * such file…", "Failed to save subtitle document."). Show a sentence in the
 * UI language instead; the raw text belongs in the logs.
 */
export function subtitleFileErrorMessage(
  error: unknown,
  t: Translate,
  action: 'open' | 'save'
): string {
  const text = String(
    (error as { message?: unknown } | null)?.message ?? error ?? ''
  );
  if (
    /\bE(ACCES|PERM|ROFS)\b|permission denied|operation not permitted/i.test(
      text
    )
  ) {
    return action === 'open'
      ? t('subtitles.fileError.openPermission', {
          defaultValue:
            'Translator isn’t allowed to read that file. Check its permissions, or copy it to another folder and try again.',
        })
      : t('dialogs.exportSaveFailedPermission', {
          defaultValue: 'You don’t have permission to save in this folder.',
        });
  }
  if (
    action === 'open' &&
    /\bENOENT\b|no such file|not found|does not exist/i.test(text)
  ) {
    return t('subtitles.fileError.openMissing', {
      defaultValue:
        'That subtitle file isn’t there anymore. It may have been moved or deleted.',
    });
  }
  // A full disk, worded the way the rest of the app words it.
  const classified = classifyError(text, { task: 'export' });
  if (classified.kind === 'disk-space') {
    return formatUserFacingError(classified, t);
  }
  return action === 'open'
    ? t('subtitles.fileError.openFailed', {
        defaultValue:
          'Translator couldn’t open that subtitle file. Make sure it is an .srt file and try again.',
      })
    : t('subtitles.fileError.saveFailed', {
        defaultValue:
          'Translator couldn’t save the subtitles. Try again, or choose “Save Subtitles As…” to pick another folder.',
      });
}
