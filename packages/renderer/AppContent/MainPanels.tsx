import EditSubtitles from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import { useSubStore, useTaskStore, useUIStore } from '../state';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import type { RenderSubtitlesOptions } from '@shared-types/app';
import { useCallback, useEffect } from 'react';
import { i18n } from '../i18n';
import { css } from '@emotion/css';
import {
  colors,
  metaPillStyles,
  shellBodyStyles,
  subtleSurfaceCardStyles,
} from '../styles';
import { useTranslation } from 'react-i18next';
import { logButton } from '../utils/logger';
import {
  borderRadius,
  fontWeight,
  spacing,
} from '../components/design-system/tokens.js';

export default function MainPanels() {
  const { t } = useTranslation();
  // Keep both sections mounted; panel open states live in the global UI store.
  const isGenerateOpen = useUIStore(s => s.showGeneratePanel);
  const isEditOpen = useUIStore(s => s.showEditPanel);
  const hasMountedSubtitles = useSubStore(s => s.order.length > 0);
  const subtitleSourceId = useSubStore(s => s.sourceId);
  const setGenerateOpen = (v: boolean) =>
    useUIStore.getState().setGeneratePanelOpen(v);
  const setEditOpen = (v: boolean) => useUIStore.getState().setEditPanelOpen(v);

  const setMergeStage = useTaskStore(s => s.setMerge);
  const setMergeOperationId = (id: string | null) =>
    useTaskStore.getState().setMerge({ id });

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

  useEffect(() => {
    if (!hasMountedSubtitles) return;
    // Product rule: once subtitles are mounted, the editor should surface,
    // including highlight-owned transcription flows.
    // Highlight workflows keep the editor read-only rather than collapsed.
    useUIStore.getState().setEditPanelOpen(true);
  }, [hasMountedSubtitles, subtitleSourceId]);

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
              <div className={overlayIconStyles}>01</div>
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
              <span className={overlayPill}>{t('input.fromDevice')}</span>
              <span className={overlayPill}>{t('input.fromWeb')}</span>
            </div>
          </div>
        )}
      </div>

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
              <div className={overlayIconStyles}>02</div>
              <div>
                <div className={overlayTitleStyles}>{t('cta.edit.title')}</div>
                <div className={overlaySubtitleStyles}>
                  {t('cta.edit.subtitle')}
                </div>
              </div>
            </div>
            <div className={overlayPillsRowStyles}>
              <span className={overlayPill}>{t('cta.edit.pillOpen')}</span>
              <span className={overlayPill}>{t('cta.edit.pillMerge')}</span>
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
  margin-bottom: ${spacing.md};
`;

const ctaOverlayCard = css`
  ${subtleSurfaceCardStyles}
  width: 100%;
  max-width: 100%;
  min-height: 190px;
  padding: ${spacing['2xl']};
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${spacing.lg};
  cursor: pointer;
  user-select: none;
  color: ${colors.text};
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &:hover {
    border-color: ${colors.primary};
    box-shadow: 0 12px 28px rgba(5, 10, 19, 0.24);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 3px ${colors.primary}33;
  }
`;

const overlayHeaderStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.lg};
  width: 100%;
`;

const overlayIconStyles = css`
  width: 54px;
  height: 54px;
  border-radius: ${borderRadius.lg};
  border: 1px solid rgba(125, 167, 255, 0.28);
  background: linear-gradient(
    135deg,
    rgba(125, 167, 255, 0.16),
    rgba(125, 167, 255, 0.04)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${colors.primaryLight};
  font-size: 0.95rem;
  font-weight: ${fontWeight.bold};
  letter-spacing: 0.12em;
`;

const overlayTitleStyles = css`
  font-size: clamp(1.25rem, 1.9vw, 1.65rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  margin-top: ${spacing.sm};
  letter-spacing: -0.02em;
`;

const overlaySubtitleStyles = css`
  ${shellBodyStyles}
  margin-top: ${spacing.sm};
  max-width: 560px;
`;

const overlayPillsRowStyles = css`
  display: flex;
  gap: ${spacing.sm};
  flex-wrap: wrap;
  justify-content: flex-start;
`;

const overlayPill = metaPillStyles;
