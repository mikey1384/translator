import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import type { TFunction } from 'i18next';
import type {
  HighlightAspectMode,
  TranscriptHighlight,
} from '@shared-types/app';
import { ERROR_CODES } from '../../../shared/constants';
import { useCreditStore } from '../../state';
import {
  cutCombinedHighlights,
  cutHighlightClip,
  onCombinedHighlightCutProgress,
  onHighlightCutProgress,
} from '../../ipc/subtitles';
import { save as saveFile } from '../../ipc/file';
import {
  buildHighlightFilename,
  getHighlightKey,
  type HighlightClipCutState,
} from './TranscriptSummaryPanel.helpers';
import type { CombineCutState } from './TranscriptSummaryLogic.types';

type UseTranscriptHighlightsFlowParams = {
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  t: TFunction;
};

type UseTranscriptHighlightsFlowResult = {
  combineCutState: CombineCutState;
  combineMode: boolean;
  downloadStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  handleCutCombined: () => Promise<void>;
  handleCutHighlightClip: (highlight: TranscriptHighlight) => Promise<void>;
  handleDownloadCombined: (outputPath: string) => Promise<void>;
  handleDownloadHighlight: (
    highlight: TranscriptHighlight,
    index: number
  ) => Promise<void>;
  handleDragStart: (event: DragEvent, index: number) => void;
  handleDrop: (event: DragEvent, targetIndex: number) => void;
  handleToggleHighlightSelect: (
    highlight: TranscriptHighlight,
    checked: boolean
  ) => void;
  highlightAspectMode: HighlightAspectMode;
  highlights: TranscriptHighlight[];
  highlightCutState: Record<string, HighlightClipCutState>;
  mergeHighlightUpdates: (incoming?: TranscriptHighlight[] | null) => void;
  orderedSelection: TranscriptHighlight[];
  resetHighlightsState: () => void;
  selectedHighlights: Set<string>;
  setCombineMode: Dispatch<SetStateAction<boolean>>;
  setHighlightAspectMode: Dispatch<SetStateAction<HighlightAspectMode>>;
  videoAvailableForHighlights: boolean;
};

export default function useTranscriptHighlightsFlow({
  fallbackVideoPath,
  originalVideoPath,
  setError,
  t,
}: UseTranscriptHighlightsFlowParams): UseTranscriptHighlightsFlowResult {
  const [highlights, setHighlights] = useState<TranscriptHighlight[]>([]);
  const [downloadStatus, setDownloadStatus] = useState<
    Record<string, 'idle' | 'saving' | 'saved' | 'error'>
  >({});
  const [highlightCutState, setHighlightCutState] = useState<
    Record<string, HighlightClipCutState>
  >({});
  const [highlightAspectMode, setHighlightAspectMode] =
    useState<HighlightAspectMode>('vertical');
  const [combineMode, setCombineMode] = useState(false);
  const [selectedHighlights, setSelectedHighlights] = useState<Set<string>>(
    new Set()
  );
  const [orderedSelection, setOrderedSelection] = useState<
    TranscriptHighlight[]
  >([]);
  const [combineCutState, setCombineCutState] = useState<CombineCutState>({
    status: 'idle',
    percent: 0,
  });

  const downloadTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {}
  );

  const videoAvailableForHighlights = Boolean(
    originalVideoPath || fallbackVideoPath
  );

  const mergeHighlightUpdates = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      setHighlights(prev => {
        const map = new Map<string, TranscriptHighlight>();
        prev.forEach(highlight =>
          map.set(getHighlightKey(highlight), highlight)
        );
        incoming.forEach(highlight => {
          const key = getHighlightKey(highlight);
          const existing = map.get(key);
          map.set(key, existing ? { ...existing, ...highlight } : highlight);
        });
        return Array.from(map.values()).sort((a, b) => a.start - b.start);
      });
    },
    []
  );

  const resetHighlightsState = useCallback(() => {
    Object.values(downloadTimers.current).forEach(timer => clearTimeout(timer));
    downloadTimers.current = {};
    setHighlights([]);
    setDownloadStatus({});
    setHighlightCutState({});
    setSelectedHighlights(new Set());
    setOrderedSelection([]);
    setCombineCutState({ status: 'idle', percent: 0 });
  }, []);

  useEffect(() => {
    return () => {
      Object.values(downloadTimers.current).forEach(timer =>
        clearTimeout(timer)
      );
      downloadTimers.current = {};
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onHighlightCutProgress(progress => {
      const highlight = progress.highlight as TranscriptHighlight | undefined;
      const highlightId =
        progress.highlightId || (highlight ? getHighlightKey(highlight) : null);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));

      if (highlightId) {
        setHighlightCutState(prev => {
          const prevState = prev[highlightId] || {
            status: 'idle',
            percent: 0,
          };
          let status: HighlightClipCutState['status'] = prevState.status;
          const stageText = String(progress.stage || '').toLowerCase();
          if (stageText.includes('ready')) {
            status = 'ready';
          } else if (stageText.includes('cancel')) {
            status = 'cancelled';
          } else if (stageText.includes('error')) {
            status = 'error';
          } else if (stageText) {
            status = 'cutting';
          }

          const nextState: HighlightClipCutState = {
            status,
            percent: status === 'ready' ? 100 : clampedPercent,
            error: progress.error || undefined,
            operationId: progress.operationId,
          };

          return {
            ...prev,
            [highlightId]: nextState,
          };
        });
      }

      if (highlight) {
        mergeHighlightUpdates([highlight]);
        const key = getHighlightKey(highlight);
        setDownloadStatus(prev => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }

      if (progress.error) {
        if (progress.error === ERROR_CODES.INSUFFICIENT_CREDITS) {
          setError(t('summary.insufficientCredits'));
          useCreditStore
            .getState()
            .refresh()
            .catch(() => void 0);
        } else {
          setError(
            t('summary.downloadHighlightFailed', {
              message: progress.error,
            })
          );
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [mergeHighlightUpdates, setError, t]);

  const handleDownloadHighlight = useCallback(
    async (highlight: TranscriptHighlight, index: number) => {
      if (!highlight?.videoPath) return;
      const key = getHighlightKey(highlight);

      setDownloadStatus(prev => ({ ...prev, [key]: 'saving' }));

      try {
        const defaultName = buildHighlightFilename(highlight, index);
        const result = await saveFile({
          sourcePath: highlight.videoPath,
          defaultPath: defaultName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          title: t('summary.saveHighlightDialogTitle', 'Save highlight clip'),
        });

        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || 'Unknown error');
        }

        setDownloadStatus(prev => ({ ...prev, [key]: 'saved' }));
        if (downloadTimers.current[key]) {
          clearTimeout(downloadTimers.current[key]);
        }
        downloadTimers.current[key] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete downloadTimers.current[key];
        }, 4000);
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] save highlight failed', err);
        setDownloadStatus(prev => ({ ...prev, [key]: 'error' }));
        if (downloadTimers.current[key]) {
          clearTimeout(downloadTimers.current[key]);
        }
        downloadTimers.current[key] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          delete downloadTimers.current[key];
        }, 5000);

        setError(
          t('summary.downloadHighlightFailed', {
            message: err?.message || String(err),
          })
        );
      }
    },
    [setError, t]
  );

  const handleCutHighlightClip = useCallback(
    async (highlight: TranscriptHighlight) => {
      const videoPath = originalVideoPath || fallbackVideoPath;
      if (!videoPath) {
        setError(
          t(
            'summary.noVideoForHighlights',
            'Open the source video to cut highlight clips.'
          )
        );
        return;
      }

      const key = getHighlightKey(highlight);
      const existingState = highlightCutState[key];
      if (existingState?.status === 'cutting') {
        return;
      }

      const operationId = `highlight-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      setHighlightCutState(prev => ({
        ...prev,
        [key]: { status: 'cutting', percent: 0, operationId },
      }));
      setError(null);

      try {
        const result = await cutHighlightClip({
          videoPath,
          highlight,
          operationId,
          aspectMode: highlightAspectMode,
        });

        if (result?.error) {
          throw new Error(result.error);
        }

        if (result?.cancelled) {
          setHighlightCutState(prev => ({
            ...prev,
            [key]: { status: 'cancelled', percent: 0 },
          }));
          return;
        }

        if (result?.highlight) {
          const updated = result.highlight as TranscriptHighlight;
          setHighlights(prev => {
            const map = new Map<string, TranscriptHighlight>();
            prev.forEach(item => map.set(getHighlightKey(item), item));
            const existing = map.get(key);
            map.set(key, existing ? { ...existing, ...updated } : updated);
            return Array.from(map.values()).sort((a, b) => a.start - b.start);
          });
        }

        setHighlightCutState(prev => ({
          ...prev,
          [key]: { status: 'ready', percent: 100 },
        }));
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] cut highlight failed', err);
        const message = err?.message || String(err);
        setHighlightCutState(prev => ({
          ...prev,
          [key]: { status: 'error', percent: 0, error: message },
        }));
        setError(
          t('summary.downloadHighlightFailed', {
            message,
          })
        );
      }
    },
    [
      fallbackVideoPath,
      highlightAspectMode,
      highlightCutState,
      originalVideoPath,
      setError,
      t,
    ]
  );

  const handleDragStart = useCallback((event: DragEvent, index: number) => {
    event.dataTransfer.setData('text/plain', String(index));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((event: DragEvent, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
    if (sourceIndex === targetIndex || isNaN(sourceIndex)) return;

    setOrderedSelection(prev => {
      const nextOrder = [...prev];
      const [removed] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, removed);
      return nextOrder;
    });
  }, []);

  const handleToggleHighlightSelect = useCallback(
    (highlight: TranscriptHighlight, checked: boolean) => {
      const key = getHighlightKey(highlight);
      setSelectedHighlights(prev => {
        const nextSet = new Set(prev);
        if (checked) {
          nextSet.add(key);
        } else {
          nextSet.delete(key);
        }
        return nextSet;
      });

      if (checked) {
        setOrderedSelection(prev => [...prev, highlight]);
      } else {
        setOrderedSelection(prev =>
          prev.filter(item => getHighlightKey(item) !== key)
        );
      }
    },
    []
  );

  const handleCutCombined = useCallback(async () => {
    if (orderedSelection.length < 2) return;

    const videoPath = originalVideoPath || fallbackVideoPath;
    if (!videoPath) {
      setError(
        t(
          'summary.noVideoForHighlights',
          'Open the source video to cut highlight clips.'
        )
      );
      return;
    }

    const operationId = `combined-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    setCombineCutState({
      status: 'cutting',
      percent: 0,
      operationId,
    });
    setError(null);

    try {
      const result = await cutCombinedHighlights({
        videoPath,
        highlights: orderedSelection,
        operationId,
        aspectMode: highlightAspectMode,
      });

      if (result?.error) throw new Error(result.error);
      if (result?.cancelled) {
        setCombineCutState({ status: 'cancelled', percent: 0 });
        return;
      }

      setCombineCutState({
        status: 'ready',
        percent: 100,
        outputPath: result.videoPath,
      });
    } catch (err: any) {
      console.error('[TranscriptSummaryPanel] cut combined failed', err);
      setCombineCutState({
        status: 'error',
        percent: 0,
        error: err?.message,
      });
      setError(
        t('summary.combinedCutFailed', {
          defaultValue: 'Failed to cut combined highlights: {{message}}',
          message: err?.message || String(err),
        })
      );
    }
  }, [
    fallbackVideoPath,
    highlightAspectMode,
    orderedSelection,
    originalVideoPath,
    setError,
    t,
  ]);

  const handleDownloadCombined = useCallback(
    async (outputPath: string) => {
      try {
        const defaultName = `combined-highlights-${Date.now()}.mp4`;
        const result = await saveFile({
          sourcePath: outputPath,
          defaultPath: defaultName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          title: t(
            'summary.saveCombinedDialogTitle',
            'Save combined highlight clip'
          ),
        });

        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || 'Unknown error');
        }
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] save combined failed', err);
        setError(
          t('summary.downloadHighlightFailed', {
            message: err?.message || String(err),
          })
        );
      }
    },
    [setError, t]
  );

  useEffect(() => {
    if (!combineCutState.operationId) return;

    const unsubscribe = onCombinedHighlightCutProgress(progress => {
      if (progress.operationId !== combineCutState.operationId) return;

      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const stageText = String(progress.stage || '').toLowerCase();

      let status: CombineCutState['status'] = 'cutting';
      if (stageText.includes('ready')) status = 'ready';
      else if (stageText.includes('cancel')) status = 'cancelled';
      else if (stageText.includes('error')) status = 'error';

      setCombineCutState(prev => ({
        ...prev,
        status,
        percent: pct,
        error: progress.error,
      }));

      if (progress.error) {
        setError(
          t('summary.combinedCutFailed', {
            defaultValue: 'Failed to cut combined highlights: {{message}}',
            message: progress.error,
          })
        );
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combineCutState.operationId, setError, t]);

  useEffect(() => {
    if (!combineMode) {
      setSelectedHighlights(new Set());
      setOrderedSelection([]);
      setCombineCutState({ status: 'idle', percent: 0 });
    }
  }, [combineMode]);

  return {
    combineCutState,
    combineMode,
    downloadStatus,
    handleCutCombined,
    handleCutHighlightClip,
    handleDownloadCombined,
    handleDownloadHighlight,
    handleDragStart,
    handleDrop,
    handleToggleHighlightSelect,
    highlightAspectMode,
    highlights,
    highlightCutState,
    mergeHighlightUpdates,
    orderedSelection,
    resetHighlightsState,
    selectedHighlights,
    setCombineMode,
    setHighlightAspectMode,
    videoAvailableForHighlights,
  };
}
