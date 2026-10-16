import type { TFunction } from 'i18next';

export function renderPreparationStageLabel(
  stage: string,
  t: TFunction
): string {
  const match =
    /^render-tools:(waiting|downloading|installing|ready):(\d+)$/.exec(stage);
  if (!match) return stage;
  if (match[1] === 'downloading') {
    return t('progress.downloadingVideoExportTools', {
      percent: Math.min(100, Number(match[2])),
      defaultValue: 'Downloading video export tools… {{percent}}%',
    });
  }
  return t('progress.preparingVideoExport', 'Preparing video export…');
}
