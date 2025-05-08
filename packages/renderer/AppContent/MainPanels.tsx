import EditSubtitles from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import { useTaskStore } from '../state';

export default function MainPanels() {
  const setMergeStage = useTaskStore(s => s.setMerge);
  const setMergeOperationId = (id: string | null) =>
    useTaskStore.getState().setMerge({ id });

  return (
    <>
      <GenerateSubtitles />

      {/* EditSubtitles now owns nearly everything via stores */}
      <EditSubtitles
        setMergeStage={stage => setMergeStage({ stage })}
        onSetMergeOperationId={setMergeOperationId}
        onStartPngRenderRequest={options =>
          import('../clients/subtitle-renderer-client').then(m =>
            m.default.startPngRender(options)
          )
        }
      />
    </>
  );
}
