import EditSubtitles from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import { useSubStore, useTaskStore, useUIStore, useVideoStore } from '../state';
import HomeStage from '../components/home/HomeStage';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import type { RenderSubtitlesOptions } from '@shared-types/app';
import { useCallback, useEffect } from 'react';
import { i18n } from '../i18n';
import { css } from '@emotion/css';
import { spacing } from '../components/design-system/tokens.js';
import {
  workspaceSubsAreaStyles,
  workspaceToolsAreaStyles,
} from '../components/workspace/workspace-styles';

export default function MainPanels({
  inWorkspace = false,
}: {
  /** Video workspace: the editor lives in the subtitles column and the
   * generate panel inside the collapsed "All tools" area. */
  inWorkspace?: boolean;
}) {
  // Keep both sections mounted; panel open states live in the global UI store.
  const isGenerateOpen = useUIStore(s => s.showGeneratePanel);
  const isEditOpen = useUIStore(s => s.showEditPanel);
  const editMode = useUIStore(s => s.subtitleEditMode);
  const toolsOpen = useUIStore(s => s.workspaceToolsOpen);
  const hasMountedSubtitles = useSubStore(s => s.order.length > 0);
  const subtitleSourceId = useSubStore(s => s.sourceId);
  const hasMountedVideo = useVideoStore(s => Boolean(s.url || s.path));

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

  useEffect(() => {
    if (!hasMountedSubtitles) return;
    // Product rule: once subtitles are mounted, the editor should surface,
    // including highlight-owned transcription flows.
    // Highlight workflows keep the editor read-only rather than collapsed.
    useUIStore.getState().setEditPanelOpen(true);
  }, [hasMountedSubtitles, subtitleSourceId]);

  // A mounted video (from anywhere, e.g. an agent or a recent item) leaves
  // home for the workspace where its next step lives.
  useEffect(() => {
    if (!hasMountedVideo) return;
    const ui = useUIStore.getState();
    if (!ui.showGeneratePanel && !ui.showEditPanel)
      ui.setGeneratePanelOpen(true);
  }, [hasMountedVideo]);

  const showHome = !inWorkspace && !isGenerateOpen && !isEditOpen;
  const showGenerate = inWorkspace ? toolsOpen : isGenerateOpen;
  const showEditor = inWorkspace ? editMode : isEditOpen;

  return (
    <>
      {showHome ? <HomeStage /> : null}

      {/* Both panels stay mounted in the same place in every layout: the home
          action and running jobs live inside them. */}
      <div
        className={
          inWorkspace
            ? `${panelBlockStyles} ${workspaceToolsAreaStyles}`
            : panelBlockStyles
        }
        data-translator-destination="create"
        style={{ display: showGenerate ? 'block' : 'none' }}
      >
        <GenerateSubtitles />
      </div>

      <div
        className={
          inWorkspace
            ? `${panelBlockStyles} ${workspaceSubsAreaStyles}`
            : panelBlockStyles
        }
        data-translator-destination="editor"
        style={{ display: showEditor ? 'block' : 'none' }}
      >
        <EditSubtitles
          setMergeStage={s => setMergeStage({ stage: s })}
          onSetMergeOperationId={setMergeOperationId}
          onStartPngRenderRequest={handleRenderRequest}
          listHidden={inWorkspace && !editMode}
        />
      </div>
    </>
  );
}

function isRenderOpts(o: unknown): o is RenderSubtitlesOptions {
  return !!o && typeof o === 'object' && 'operationId' in o;
}

const panelBlockStyles = css`
  position: relative;
  width: 100%;
  margin-bottom: ${spacing.md};
`;
