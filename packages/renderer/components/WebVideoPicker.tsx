import { useEffect } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import Button from './Button';
import { useWebVideoStore } from '../state/web-video-store';
import { useUrlStore } from '../state/url-store';
import { formatDurationSeconds } from '../utils/formatUnits';
import { colors } from '../styles';

const list = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 50vh;
  overflow: auto;
`;
const row = css`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px;
  border: 1px solid ${colors.border};
  border-radius: 10px;
  background: transparent;
  color: ${colors.text};
  text-align: start;
  cursor: pointer;
  &:hover,
  &:focus-visible {
    border-color: ${colors.primaryLight};
    background: rgba(255, 255, 255, 0.04);
  }
  img {
    width: 100px;
    height: 58px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
  }
  span {
    min-width: 0;
  }
  strong {
    display: block;
    font-size: 14px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    margin-top: 5px;
    color: ${colors.textDim};
  }
`;

export default function WebVideoPicker() {
  const { t, i18n } = useTranslation();
  const picker = useWebVideoStore(state => state.picker);
  const choose = useWebVideoStore(state => state.choose);
  const operationId = useUrlStore(state => state.download.id);
  const stage = useUrlStore(state => state.download.stage);
  useEffect(() => {
    if (picker && (picker.operationId !== operationId || stage === 'Cancelled'))
      choose(null);
  }, [picker, operationId, stage, choose]);
  return (
    <Modal
      open={Boolean(picker)}
      title={t('input.webVideo.choose', 'Choose a video')}
      titleId="web-video-title"
      onClose={() => choose(null)}
      actions={
        <Button variant="secondary" onClick={() => choose(null)}>
          {t('common.cancel', 'Cancel')}
        </Button>
      }
    >
      <div className={list}>
        {picker?.candidates.map((video, index) => (
          <button
            className={row}
            key={video.id}
            onClick={() => choose(video.id)}
          >
            {video.thumbnailUrl && (
              <img
                src={video.thumbnailUrl}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={event => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}
            <span>
              <strong>
                {video.title ||
                  t('input.webVideo.video', 'Video {{number}}', {
                    number: index + 1,
                  })}
              </strong>
              <small>
                {[
                  video.durationSec
                    ? formatDurationSeconds(video.durationSec, i18n.language)
                    : null,
                  video.height ? `${video.height}p` : null,
                  t('input.webVideo.video', 'Video {{number}}', {
                    number: index + 1,
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
