import EditSubtitles from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import { useTaskStore } from '../state';
import subtitleRendererClient from '../clients/subtitle-renderer-client';
import type { RenderSubtitlesOptions } from '@shared-types/app';
import { useCallback } from 'react';
import { i18n } from '../i18n';

export default function MainPanels() {
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

  return (
    <>
      <GenerateSubtitles />
      <EditSubtitles
        setMergeStage={s => setMergeStage({ stage: s })}
        onSetMergeOperationId={setMergeOperationId}
        onStartPngRenderRequest={handleRenderRequest}
      />
    </>
  );
}

function isRenderOpts(o: unknown): o is RenderSubtitlesOptions {
  return !!o && typeof o === 'object' && 'operationId' in o;
}
