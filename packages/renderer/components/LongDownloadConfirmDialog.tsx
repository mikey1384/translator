import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Modal from './Modal';
import VideoCostLine from './VideoCostLine';
import { resolveLongDownload, useModalStore } from '../state/modal-store';
import { formatDurationSeconds } from '../utils/formatUnits';
import { colors } from '../styles';

const bodyStyles = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  line-height: 1.5;
`;

const factsStyles = css`
  color: ${colors.textDim};
`;

function formatBytes(bytes: number, locale: string): string {
  const gigabytes = bytes / 1_000_000_000;
  const [value, unit] =
    gigabytes >= 1
      ? [gigabytes, 'gigabyte']
      : [Math.max(1, bytes / 1_000_000), 'megabyte'];
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      maximumFractionDigits: gigabytes >= 1 ? 1 : 0,
    }).format(value);
  } catch {
    return `${value.toFixed(1)} ${unit === 'gigabyte' ? 'GB' : 'MB'}`;
  }
}

/**
 * Asked before downloading a very long video: how long it is, about how big
 * the file will be, and what subtitling it would cost.
 */
export default function LongDownloadConfirmDialog() {
  const { t, i18n } = useTranslation();
  const details = useModalStore(s => s.longDownload);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const duration =
    details?.durationSec && details.durationSec > 0
      ? formatDurationSeconds(details.durationSec, locale)
      : null;
  const size =
    details?.estimatedBytes && details.estimatedBytes > 0
      ? formatBytes(details.estimatedBytes, locale)
      : null;

  return (
    <Modal
      open={details !== null}
      title={t('input.longDownload.title', 'Download a long video?')}
      titleId="long-download-title"
      onClose={() => resolveLongDownload(false)}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => resolveLongDownload(false)}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" onClick={() => resolveLongDownload(true)}>
            {t('input.longDownload.confirm', 'Download')}
          </Button>
        </>
      }
    >
      <div className={bodyStyles}>
        <div>
          {t(
            'input.longDownload.body',
            'This video is long, so the download can take a while and use a lot of disk space. A lower download quality makes it faster and smaller.'
          )}
        </div>
        {duration || size ? (
          <div className={factsStyles}>
            {[
              duration
                ? t('input.longDownload.duration', 'Length: {{duration}}', {
                    duration,
                  })
                : null,
              size
                ? t('input.longDownload.size', 'About {{size}}', { size })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : null}
        {details?.durationSec ? (
          <VideoCostLine durationSec={details.durationSec} />
        ) : null}
      </div>
    </Modal>
  );
}
