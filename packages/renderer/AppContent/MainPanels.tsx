import EditSubtitles from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import TranscriptSummaryPanel from '../components/TranscriptSummaryPanel';
import { useTaskStore, useUIStore, useSubStore } from '../state';
import type { SrtSegment } from '@shared-types/app';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import type { RenderSubtitlesOptions } from '@shared-types/app';
import { useCallback } from 'react';
import { i18n } from '../i18n';
import { css } from '@emotion/css';
import { colors } from '../styles';
import { useTranslation } from 'react-i18next';
import { logButton } from '../utils/logger';

export default function MainPanels() {
  const { t } = useTranslation();
  // Keep both sections mounted; panel open states are persisted in global UI store
  const isGenerateOpen = useUIStore(s => s.showGeneratePanel);
  const isEditOpen = useUIStore(s => s.showEditPanel);
  const setGenerateOpen = (v: boolean) =>
    useUIStore.getState().setGeneratePanelOpen(v);
  const setEditOpen = (v: boolean) => useUIStore.getState().setEditPanelOpen(v);

  const setMergeStage = useTaskStore(s => s.setMerge);
  const setMergeOperationId = (id: string | null) =>
    useTaskStore.getState().setMerge({ id });
  const summarySegments = useSubStore(s =>
    s.order.map(id => s.segments[id]).filter((seg): seg is SrtSegment => !!seg)
  );
  const hasTranscript = summarySegments.length > 0;

  const handleRenderRequest = useCallback((options: unknown) => {
    if (!isRenderOpts(options)) {
      const error = new Error(i18n.t('common.error.invalidRenderOptions'));
      useTaskStore.getState().setMerge({ stage: `Error: ${error.message}` });
      return Promise.reject(error);
    }
    return subtitleRendererClient.renderSubtitles(options).catch(e => {
      useTaskStore.getState().setMerge({ stage: `Error: ${e.message}` });
      throw e;
    });
  }, []);

  const onKeyToggle = (
    e: React.KeyboardEvent<HTMLDivElement>,
    open: () => void
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  return (
    <>
      {/* Generate Subtitles transforming container */}
      <div className={panelBlockStyles}>
        {/* Underlying content (always rendered) */}
        <div style={{ display: isGenerateOpen ? 'block' : 'none' }}>
          <GenerateSubtitles />
        </div>

        {/* CTA overlay (acts as the container button) */}
        {!isGenerateOpen && (
          <div
            role="button"
            tabIndex={0}
            className={css(ctaOverlayCard)}
            onClick={() => {
              logButton('open_generate_panel');
              setGenerateOpen(true);
            }}
            onKeyDown={e =>
              onKeyToggle(e, () => {
                logButton('open_generate_panel');
                setGenerateOpen(true);
              })
            }
          >
            <div className={overlayHeaderStyles}>
              <div className={overlayIconStyles}>🎬</div>
              <div>
                <div className={overlayTitleStyles}>
                  {t('cta.generate.title')}
                </div>
                <div className={overlaySubtitleStyles}>
                  {t('cta.generate.subtitle')}
                </div>
              </div>
            </div>
            <div className={overlayPillsRowStyles}>
              <span className={overlayPill}>
                <span>💾</span> {t('input.fromDevice')}
              </span>
              <span className={overlayPill}>
                <span>🌐</span> {t('input.fromWeb')}
              </span>
            </div>
          </div>
        )}
      </div>

      {hasTranscript && (
        <div className={panelBlockStyles}>
          <TranscriptSummaryPanel segments={summarySegments} />
        </div>
      )}

      {/* Edit Subtitles transforming container */}
      <div className={panelBlockStyles}>
        {/* Underlying content (always rendered) */}
        <div style={{ display: isEditOpen ? 'block' : 'none' }}>
          <EditSubtitles
            setMergeStage={s => setMergeStage({ stage: s })}
            onSetMergeOperationId={setMergeOperationId}
            onStartPngRenderRequest={handleRenderRequest}
          />
        </div>

        {/* CTA overlay (acts as the container button) */}
        {!isEditOpen && (
          <div
            role="button"
            tabIndex={0}
            className={css(ctaOverlayCard)}
            onClick={() => {
              logButton('open_edit_panel');
              setEditOpen(true);
            }}
            onKeyDown={e =>
              onKeyToggle(e, () => {
                logButton('open_edit_panel');
                setEditOpen(true);
              })
            }
          >
            <div className={overlayHeaderStyles}>
              <div className={overlayIconStyles}>📝</div>
              <div>
                <div className={overlayTitleStyles}>{t('cta.edit.title')}</div>
                <div className={overlaySubtitleStyles}>
                  {t('cta.edit.subtitle')}
                </div>
              </div>
            </div>
            <div className={overlayPillsRowStyles}>
              <span className={overlayPill}>
                <span>📄</span> {t('cta.edit.pillOpen')}
              </span>
              <span className={overlayPill}>
                <span>🎥</span> {t('cta.edit.pillMerge')}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function isRenderOpts(o: unknown): o is RenderSubtitlesOptions {
  return !!o && typeof o === 'object' && 'operationId' in o;
}

// Styles: card-like CTA matching theme
const panelBlockStyles = css`
  position: relative;
  width: 100%;
  margin-bottom: 12px;
`;

const ctaOverlayCard = css`
  width: 100%;
  max-width: 100%;
  min-height: 160px;
  padding: 20px 24px;
  border-radius: 12px;
  border: 2px solid ${colors.border};
  background-color: ${colors.surface};
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  cursor: pointer;
  user-select: none;
  color: ${colors.text};
  text-align: center;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.08s ease;

  &:hover {
    border-color: ${colors.primary};
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px ${colors.primary}33;
  }
`;

const overlayHeaderStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const overlayIconStyles = css`
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background-color: ${colors.primary};
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.2rem;
  font-weight: bold;
`;

const overlayTitleStyles = css`
  font-size: 1.1rem;
  font-weight: 700;
  color: ${colors.text};
`;

const overlaySubtitleStyles = css`
  font-size: 0.85rem;
  color: ${colors.gray};
`;

const overlayPillsRowStyles = css`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
`;

const overlayPill = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background-color: ${colors.backgroundLight};
  border: 1px solid ${colors.border};
  color: ${colors.text};
  font-size: 0.8rem;
`;
