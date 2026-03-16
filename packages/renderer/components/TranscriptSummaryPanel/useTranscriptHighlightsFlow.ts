import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  libraryEntryId: string | null;
  originalVideoPath: string | null;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
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
  replaceHighlights: (incoming?: TranscriptHighlight[] | null) => void;
  orderedSelection: TranscriptHighlight[];
  resetHighlightsState: () => void;
  selectedHighlights: Set<string>;
  setCombineMode: Dispatch<SetStateAction<boolean>>;
  setHighlightAspectMode: Dispatch<SetStateAction<HighlightAspectMode>>;
  videoAvailableForHighlights: boolean;
};

type SourceRuntimeArtifacts = {
  combinedOutputPath: string | null;
  combinedSelectionSignature: string | null;
  highlightVideoPaths: Record<string, string>;
};

type HighlightCutOperationMeta = {
  generation: number;
  sourceIdentity: string;
};

function normalizeSourcePathIdentity(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function normalizeSourceValue(value: string | null | undefined): string {
  return String(value || '').trim();
}

function buildHighlightViewSourceIdentity({
  fallbackVideoPath,
  originalVideoPath,
  sourceUrl,
  libraryEntryId,
}: {
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  sourceUrl: string | null;
  libraryEntryId: string | null;
}): string {
  const original = normalizeSourcePathIdentity(originalVideoPath);
  const fallback = normalizeSourcePathIdentity(fallbackVideoPath);
  const url = normalizeSourceValue(sourceUrl);
  const library = normalizeSourceValue(libraryEntryId);
  return `${original}|${fallback}|${url}|${library}`;
}

function buildHighlightArtifactSourceIdentity({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  sourceAssetIdentity,
  sourceUrl,
  libraryEntryId,
  aspectMode,
}: {
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
  libraryEntryId: string | null;
  aspectMode: HighlightAspectMode;
}): string {
  const assetIdentity = normalizeSourceValue(
    sourceAssetIdentity || fallbackVideoAssetIdentity
  );
  const mode = normalizeSourceValue(aspectMode);
  if (assetIdentity) {
    return `asset:${assetIdentity}|mode:${mode}`;
  }
  const url = normalizeSourceValue(sourceUrl);
  const library = normalizeSourceValue(libraryEntryId);
  if (url || library) {
    return `meta:${url}|${library}|mode:${mode}`;
  }
  const fallbackPath = normalizeSourcePathIdentity(fallbackVideoPath);
  if (fallbackPath) {
    return `path:${fallbackPath}|mode:${mode}`;
  }
  return `meta:||mode:${mode}`;
}

function withoutVideoPath(highlight: TranscriptHighlight): TranscriptHighlight {
  const { videoPath: _videoPath, ...rest } = highlight;
  return rest;
}

function buildHighlightArtifactKey(highlight: TranscriptHighlight): string {
  // Artifact identity is the cut media window; keep this range-based so clips
  // remain reusable across regenerations where highlight ids can change. Aspect
  // partitioning happens at the source-identity bucket level.
  const start = Number.isFinite(highlight.start)
    ? Math.round(highlight.start * 1000)
    : 0;
  const end = Number.isFinite(highlight.end)
    ? Math.round(highlight.end * 1000)
    : start;
  return `${start}-${end}`;
}

function extractHighlightVideoPaths(
  highlights: TranscriptHighlight[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const highlight of highlights) {
    if (!highlight.videoPath) continue;
    result[buildHighlightArtifactKey(highlight)] = highlight.videoPath;
  }
  return result;
}

function buildOrderedSelectionSignature(
  orderedSelection: TranscriptHighlight[]
): string {
  if (!Array.isArray(orderedSelection) || orderedSelection.length < 2) {
    return '';
  }
  return orderedSelection
    .map(highlight => buildHighlightArtifactKey(withoutVideoPath(highlight)))
    .join('|');
}

function isTerminalProgressStage(stage: string | null | undefined): boolean {
  const normalized = String(stage || '').toLowerCase();
  return (
    normalized.includes('ready') ||
    normalized.includes('cancel') ||
    normalized.includes('error')
  );
}

export default function useTranscriptHighlightsFlow({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  libraryEntryId,
  originalVideoPath,
  sourceAssetIdentity,
  sourceUrl,
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
  const runtimeArtifactsBySourceRef = useRef<
    Record<string, SourceRuntimeArtifacts>
  >({});
  const currentViewSourceIdentityRef = useRef<string>('');
  const currentArtifactSourceIdentityRef = useRef<string>('');
  const highlightsRef = useRef<TranscriptHighlight[]>([]);
  const orderedSelectionRef = useRef<TranscriptHighlight[]>([]);
  const combineCutStateRef = useRef<CombineCutState>({
    status: 'idle',
    percent: 0,
  });
  const combinedSelectionSignatureRef = useRef<string | null>(null);
  const highlightCutSourceByOperationRef = useRef<
    Record<string, HighlightCutOperationMeta>
  >({});
  const combinedCutSourceByOperationRef = useRef<Record<string, string>>({});
  const highlightDisplayGenerationRef = useRef(0);

  const viewSourceIdentity = useMemo(
    () =>
      buildHighlightViewSourceIdentity({
        fallbackVideoPath,
        originalVideoPath,
        sourceUrl,
        libraryEntryId,
      }),
    [fallbackVideoPath, libraryEntryId, originalVideoPath, sourceUrl]
  );
  const artifactSourceIdentity = useMemo(
    () =>
      buildHighlightArtifactSourceIdentity({
        fallbackVideoAssetIdentity,
        fallbackVideoPath,
        sourceAssetIdentity,
        sourceUrl,
        libraryEntryId,
        aspectMode: highlightAspectMode,
      }),
    [
      fallbackVideoAssetIdentity,
      fallbackVideoPath,
      highlightAspectMode,
      libraryEntryId,
      sourceAssetIdentity,
      sourceUrl,
    ]
  );

  const ensureSourceArtifacts = useCallback(
    (identity: string): SourceRuntimeArtifacts => {
      const existing = runtimeArtifactsBySourceRef.current[identity];
      if (existing) return existing;
      const created: SourceRuntimeArtifacts = {
        combinedOutputPath: null,
        combinedSelectionSignature: null,
        highlightVideoPaths: {},
      };
      runtimeArtifactsBySourceRef.current[identity] = created;
      return created;
    },
    []
  );

  const applySourceArtifacts = useCallback(
    (
      identity: string,
      entries: TranscriptHighlight[]
    ): TranscriptHighlight[] => {
      const sourceArtifacts = ensureSourceArtifacts(identity);
      return entries.map(entry => {
        const cleaned = withoutVideoPath(entry);
        const key = buildHighlightArtifactKey(cleaned);
        const sourceVideoPath = sourceArtifacts.highlightVideoPaths[key];
        if (!sourceVideoPath) return cleaned;
        return { ...cleaned, videoPath: sourceVideoPath };
      });
    },
    [ensureSourceArtifacts]
  );

  const setHighlightVideoPathForSource = useCallback(
    ({
      identity,
      highlight,
      videoPath,
    }: {
      identity: string;
      highlight: TranscriptHighlight;
      videoPath: string;
    }) => {
      if (!identity || !videoPath) return;
      const sourceArtifacts = ensureSourceArtifacts(identity);
      const key = buildHighlightArtifactKey(withoutVideoPath(highlight));
      sourceArtifacts.highlightVideoPaths[key] = videoPath;
    },
    [ensureSourceArtifacts]
  );

  const persistVisibleArtifactsForSource = useCallback(
    (identity: string) => {
      if (!identity) return;
      const sourceArtifacts = ensureSourceArtifacts(identity);
      const visibleVideoPaths = extractHighlightVideoPaths(
        highlightsRef.current
      );
      if (Object.keys(visibleVideoPaths).length > 0) {
        sourceArtifacts.highlightVideoPaths = {
          ...sourceArtifacts.highlightVideoPaths,
          ...visibleVideoPaths,
        };
      }
      if (
        combineCutStateRef.current.status === 'ready' &&
        combineCutStateRef.current.outputPath &&
        combinedSelectionSignatureRef.current
      ) {
        sourceArtifacts.combinedOutputPath =
          combineCutStateRef.current.outputPath;
        sourceArtifacts.combinedSelectionSignature =
          combinedSelectionSignatureRef.current;
      }
    },
    [ensureSourceArtifacts]
  );

  const resolveCurrentArtifactSourceIdentity = useCallback((): string => {
    const existingIdentity = currentArtifactSourceIdentityRef.current;
    if (existingIdentity) return existingIdentity;
    currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
    ensureSourceArtifacts(artifactSourceIdentity);
    return artifactSourceIdentity;
  }, [artifactSourceIdentity, ensureSourceArtifacts]);

  const videoAvailableForHighlights = Boolean(
    originalVideoPath || fallbackVideoPath
  );

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  useEffect(() => {
    orderedSelectionRef.current = orderedSelection;
  }, [orderedSelection]);

  useEffect(() => {
    combineCutStateRef.current = combineCutState;
  }, [combineCutState]);

  useLayoutEffect(() => {
    const previousViewSourceIdentity = currentViewSourceIdentityRef.current;
    const previousArtifactSourceIdentity =
      currentArtifactSourceIdentityRef.current;
    if (!previousViewSourceIdentity) {
      currentViewSourceIdentityRef.current = viewSourceIdentity;
      currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
      ensureSourceArtifacts(artifactSourceIdentity);
      return;
    }
    if (
      previousViewSourceIdentity === viewSourceIdentity &&
      previousArtifactSourceIdentity === artifactSourceIdentity
    ) {
      return;
    }

    persistVisibleArtifactsForSource(previousArtifactSourceIdentity);

    currentViewSourceIdentityRef.current = viewSourceIdentity;
    currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
    ensureSourceArtifacts(artifactSourceIdentity);

    const nextHighlights = applySourceArtifacts(
      artifactSourceIdentity,
      highlightsRef.current.map(highlight => withoutVideoPath(highlight))
    );
    const nextOrderedSelection = applySourceArtifacts(
      artifactSourceIdentity,
      orderedSelectionRef.current.map(highlight => withoutVideoPath(highlight))
    );
    const nextSelectionSignature =
      buildOrderedSelectionSignature(nextOrderedSelection);
    const sourceArtifacts = ensureSourceArtifacts(artifactSourceIdentity);
    const activeCombinedOperationId = combineCutStateRef.current.operationId;
    const activeCombinedOperationSourceIdentity =
      activeCombinedOperationId &&
      combinedCutSourceByOperationRef.current[activeCombinedOperationId]
        ? combinedCutSourceByOperationRef.current[activeCombinedOperationId]
        : null;
    const shouldPreserveInFlightCombinedCut = Boolean(
      combineCutStateRef.current.status === 'cutting' &&
      activeCombinedOperationId &&
      activeCombinedOperationSourceIdentity === artifactSourceIdentity
    );
    const canReuseCombinedArtifact = Boolean(
      sourceArtifacts.combinedOutputPath &&
      sourceArtifacts.combinedSelectionSignature &&
      sourceArtifacts.combinedSelectionSignature === nextSelectionSignature &&
      nextSelectionSignature
    );
    const nextCombineCutState: CombineCutState = canReuseCombinedArtifact
      ? shouldPreserveInFlightCombinedCut
        ? combineCutStateRef.current
        : {
            status: 'ready',
            percent: 100,
            outputPath: sourceArtifacts.combinedOutputPath!,
          }
      : shouldPreserveInFlightCombinedCut
        ? combineCutStateRef.current
        : { status: 'idle', percent: 0 };

    highlightsRef.current = nextHighlights;
    orderedSelectionRef.current = nextOrderedSelection;
    combineCutStateRef.current = nextCombineCutState;
    combinedSelectionSignatureRef.current = shouldPreserveInFlightCombinedCut
      ? combinedSelectionSignatureRef.current
      : canReuseCombinedArtifact
        ? sourceArtifacts.combinedSelectionSignature
        : null;

    setHighlights(nextHighlights);
    setOrderedSelection(nextOrderedSelection);
    setSelectedHighlights(
      new Set(nextOrderedSelection.map(highlight => getHighlightKey(highlight)))
    );
    setDownloadStatus({});
    setHighlightCutState({});
    setCombineCutState(nextCombineCutState);
  }, [
    applySourceArtifacts,
    artifactSourceIdentity,
    ensureSourceArtifacts,
    persistVisibleArtifactsForSource,
    viewSourceIdentity,
  ]);

  const mergeHighlightUpdates = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      setHighlights(prev => {
        const map = new Map<string, TranscriptHighlight>();
        prev.forEach(highlight => {
          const cleaned = withoutVideoPath(highlight);
          map.set(getHighlightKey(cleaned), cleaned);
        });
        incoming.forEach(highlight => {
          const cleanedIncoming = withoutVideoPath(highlight);
          const key = getHighlightKey(cleanedIncoming);
          const existing = map.get(key);
          map.set(
            key,
            existing ? { ...existing, ...cleanedIncoming } : cleanedIncoming
          );
        });
        const merged = Array.from(map.values()).sort(
          (a, b) => a.start - b.start
        );
        return applySourceArtifacts(activeSourceIdentity, merged);
      });
    },
    [applySourceArtifacts, resolveCurrentArtifactSourceIdentity]
  );

  const replaceHighlights = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const normalizedIncoming = Array.isArray(incoming)
        ? incoming
            .reduce<Map<string, TranscriptHighlight>>(
              (accumulator, highlight) => {
                const cleaned = withoutVideoPath(highlight);
                accumulator.set(getHighlightKey(cleaned), cleaned);
                return accumulator;
              },
              new Map()
            )
            .values()
        : [];
      const normalizedList = applySourceArtifacts(
        activeSourceIdentity,
        Array.from(normalizedIncoming).sort((a, b) => a.start - b.start)
      );
      const nextUiKeySet = new Set(
        normalizedList.map(highlight => getHighlightKey(highlight))
      );
      const normalizedArtifactMap = new Map(
        normalizedList.map(highlight => [
          buildHighlightArtifactKey(highlight),
          highlight,
        ])
      );

      setHighlights(previousHighlights => {
        const previousByKey = new Map(
          previousHighlights.map(highlight => [
            getHighlightKey(withoutVideoPath(highlight)),
            withoutVideoPath(highlight),
          ])
        );
        const merged = normalizedList.map(highlight => {
          const cleaned = withoutVideoPath(highlight);
          const key = getHighlightKey(cleaned);
          const existing = previousByKey.get(key);
          return existing ? { ...existing, ...cleaned } : cleaned;
        });
        return applySourceArtifacts(activeSourceIdentity, merged);
      });

      setDownloadStatus(previous =>
        Object.fromEntries(
          Object.entries(previous).filter(([key]) => nextUiKeySet.has(key))
        )
      );
      setHighlightCutState(previous =>
        Object.fromEntries(
          Object.entries(previous).filter(([key]) => nextUiKeySet.has(key))
        )
      );
      const nextOrderedSelection = applySourceArtifacts(
        activeSourceIdentity,
        orderedSelectionRef.current
          .map(highlight => {
            const replacement = normalizedArtifactMap.get(
              buildHighlightArtifactKey(withoutVideoPath(highlight))
            );
            if (!replacement) return null;
            return {
              ...withoutVideoPath(highlight),
              ...withoutVideoPath(replacement),
            };
          })
          .filter((highlight): highlight is TranscriptHighlight =>
            Boolean(highlight)
          )
      );
      setOrderedSelection(nextOrderedSelection);
      setSelectedHighlights(
        new Set(
          nextOrderedSelection.map(highlight => getHighlightKey(highlight))
        )
      );

      const nextSelectionSignature =
        buildOrderedSelectionSignature(nextOrderedSelection);
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      const canReuseCombinedArtifact = Boolean(
        sourceArtifacts.combinedOutputPath &&
        sourceArtifacts.combinedSelectionSignature &&
        sourceArtifacts.combinedSelectionSignature === nextSelectionSignature &&
        nextSelectionSignature
      );

      setCombineCutState(
        canReuseCombinedArtifact
          ? {
              status: 'ready',
              percent: 100,
              outputPath: sourceArtifacts.combinedOutputPath!,
            }
          : { status: 'idle', percent: 0 }
      );
      if (canReuseCombinedArtifact) {
        combinedSelectionSignatureRef.current =
          sourceArtifacts.combinedSelectionSignature;
      } else {
        combinedSelectionSignatureRef.current = null;
      }

      if (nextUiKeySet.size === 0) {
        setCombineMode(false);
      }
    },
    [
      applySourceArtifacts,
      ensureSourceArtifacts,
      resolveCurrentArtifactSourceIdentity,
    ]
  );

  const resetHighlightsState = useCallback(() => {
    const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
    persistVisibleArtifactsForSource(activeSourceIdentity);
    highlightDisplayGenerationRef.current += 1;
    Object.values(downloadTimers.current).forEach(timer => clearTimeout(timer));
    downloadTimers.current = {};
    currentViewSourceIdentityRef.current = viewSourceIdentity;
    currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
    ensureSourceArtifacts(artifactSourceIdentity);
    highlightsRef.current = [];
    orderedSelectionRef.current = [];
    combineCutStateRef.current = { status: 'idle', percent: 0 };
    combinedSelectionSignatureRef.current = null;
    setHighlights([]);
    setDownloadStatus({});
    setHighlightCutState({});
    setSelectedHighlights(new Set());
    setOrderedSelection([]);
    setCombineCutState({ status: 'idle', percent: 0 });
  }, [
    artifactSourceIdentity,
    ensureSourceArtifacts,
    persistVisibleArtifactsForSource,
    resolveCurrentArtifactSourceIdentity,
    viewSourceIdentity,
  ]);

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
      const operationId = progress.operationId;
      const hasOperationId = Boolean(operationId);
      const operationMeta =
        operationId && highlightCutSourceByOperationRef.current[operationId]
          ? highlightCutSourceByOperationRef.current[operationId]
          : null;
      const operationSourceIdentity = operationMeta?.sourceIdentity || null;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();

      if (hasOperationId && !operationMeta) {
        return;
      }

      const shouldApplyVisibleUpdates =
        !hasOperationId ||
        (operationSourceIdentity === activeSourceIdentity &&
          operationMeta?.generation === highlightDisplayGenerationRef.current);
      const artifactSourceIdentity =
        operationSourceIdentity ||
        (!hasOperationId ? activeSourceIdentity : null);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));

      if (highlightId && shouldApplyVisibleUpdates) {
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
        if (highlight.videoPath && artifactSourceIdentity) {
          setHighlightVideoPathForSource({
            identity: artifactSourceIdentity,
            highlight,
            videoPath: highlight.videoPath,
          });
        }

        if (shouldApplyVisibleUpdates) {
          mergeHighlightUpdates([highlight]);
          const key = getHighlightKey(highlight);
          setDownloadStatus(prev => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }
      }

      if (progress.error && shouldApplyVisibleUpdates) {
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

      if (operationId && isTerminalProgressStage(progress.stage)) {
        delete highlightCutSourceByOperationRef.current[operationId];
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [
    mergeHighlightUpdates,
    resolveCurrentArtifactSourceIdentity,
    setError,
    setHighlightVideoPathForSource,
    t,
  ]);

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
      const operationSourceIdentity = resolveCurrentArtifactSourceIdentity();
      highlightCutSourceByOperationRef.current[operationId] = {
        sourceIdentity: operationSourceIdentity,
        generation: highlightDisplayGenerationRef.current,
      };

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
          if (
            currentArtifactSourceIdentityRef.current === operationSourceIdentity
          ) {
            setHighlightCutState(prev => ({
              ...prev,
              [key]: { status: 'cancelled', percent: 0 },
            }));
          }
          return;
        }

        if (result?.highlight) {
          const updated = result.highlight as TranscriptHighlight;
          if (updated.videoPath) {
            setHighlightVideoPathForSource({
              identity: operationSourceIdentity,
              highlight: updated,
              videoPath: updated.videoPath,
            });
          }
          if (
            currentArtifactSourceIdentityRef.current === operationSourceIdentity
          ) {
            mergeHighlightUpdates([updated]);
          }
        }

        if (
          currentArtifactSourceIdentityRef.current === operationSourceIdentity
        ) {
          setHighlightCutState(prev => ({
            ...prev,
            [key]: { status: 'ready', percent: 100 },
          }));
        }
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] cut highlight failed', err);
        const message = err?.message || String(err);
        if (
          currentArtifactSourceIdentityRef.current === operationSourceIdentity
        ) {
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
      } finally {
        delete highlightCutSourceByOperationRef.current[operationId];
      }
    },
    [
      fallbackVideoPath,
      highlightAspectMode,
      highlightCutState,
      mergeHighlightUpdates,
      originalVideoPath,
      resolveCurrentArtifactSourceIdentity,
      setError,
      setHighlightVideoPathForSource,
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
    const operationSourceIdentity = resolveCurrentArtifactSourceIdentity();
    combinedCutSourceByOperationRef.current[operationId] =
      operationSourceIdentity;

    setCombineCutState({
      status: 'cutting',
      percent: 0,
      operationId,
    });
    combineCutStateRef.current = {
      status: 'cutting',
      percent: 0,
      operationId,
    };
    combinedSelectionSignatureRef.current = null;
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
        if (
          combineCutStateRef.current.operationId === operationId &&
          currentArtifactSourceIdentityRef.current === operationSourceIdentity
        ) {
          setCombineCutState({ status: 'cancelled', percent: 0 });
          combineCutStateRef.current = { status: 'cancelled', percent: 0 };
        }
        combinedSelectionSignatureRef.current = null;
        return;
      }

      if (result?.videoPath) {
        const sourceArtifacts = ensureSourceArtifacts(operationSourceIdentity);
        const combinedSelectionSignature =
          buildOrderedSelectionSignature(orderedSelection);
        if (combinedSelectionSignature) {
          sourceArtifacts.combinedOutputPath = result.videoPath;
          sourceArtifacts.combinedSelectionSignature =
            combinedSelectionSignature;
          if (
            combineCutStateRef.current.operationId === operationId &&
            currentArtifactSourceIdentityRef.current === operationSourceIdentity
          ) {
            combinedSelectionSignatureRef.current = combinedSelectionSignature;
          }
        } else {
          sourceArtifacts.combinedOutputPath = null;
          sourceArtifacts.combinedSelectionSignature = null;
          if (
            combineCutStateRef.current.operationId === operationId &&
            currentArtifactSourceIdentityRef.current === operationSourceIdentity
          ) {
            combinedSelectionSignatureRef.current = null;
          }
        }
      }

      if (
        combineCutStateRef.current.operationId === operationId &&
        currentArtifactSourceIdentityRef.current === operationSourceIdentity
      ) {
        setCombineCutState({
          status: 'ready',
          percent: 100,
          outputPath: result.videoPath,
        });
        combineCutStateRef.current = {
          status: 'ready',
          percent: 100,
          outputPath: result.videoPath,
        };
      }
    } catch (err: any) {
      console.error('[TranscriptSummaryPanel] cut combined failed', err);
      if (
        combineCutStateRef.current.operationId === operationId &&
        currentArtifactSourceIdentityRef.current === operationSourceIdentity
      ) {
        setCombineCutState({
          status: 'error',
          percent: 0,
          error: err?.message,
        });
        combineCutStateRef.current = {
          status: 'error',
          percent: 0,
          error: err?.message,
        };
        combinedSelectionSignatureRef.current = null;
        setError(
          t('summary.combinedCutFailed', {
            defaultValue: 'Failed to cut combined highlights: {{message}}',
            message: err?.message || String(err),
          })
        );
      }
    } finally {
      delete combinedCutSourceByOperationRef.current[operationId];
    }
  }, [
    ensureSourceArtifacts,
    fallbackVideoPath,
    highlightAspectMode,
    orderedSelection,
    originalVideoPath,
    resolveCurrentArtifactSourceIdentity,
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
    const unsubscribe = onCombinedHighlightCutProgress(progress => {
      const operationId = progress.operationId;
      const trackedSourceIdentity =
        operationId && combinedCutSourceByOperationRef.current[operationId]
          ? combinedCutSourceByOperationRef.current[operationId]
          : null;
      const activeCombineOperationId = combineCutStateRef.current.operationId;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const stageText = String(progress.stage || '').toLowerCase();
      const isTerminal = isTerminalProgressStage(stageText);

      if (!activeCombineOperationId) {
        if (isTerminal) {
          if (operationId) {
            delete combinedCutSourceByOperationRef.current[operationId];
          }
        }
        return;
      }

      if (!operationId || operationId !== activeCombineOperationId) {
        if (isTerminal && operationId) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      const operationSourceIdentity = trackedSourceIdentity;
      if (!operationSourceIdentity) {
        if (isTerminal) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      if (operationSourceIdentity !== activeSourceIdentity) {
        if (isTerminal) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
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
      if (status !== 'ready') {
        combinedSelectionSignatureRef.current = null;
      }

      if (progress.error) {
        setError(
          t('summary.combinedCutFailed', {
            defaultValue: 'Failed to cut combined highlights: {{message}}',
            message: progress.error,
          })
        );
      }

      if (operationId && isTerminal) {
        delete combinedCutSourceByOperationRef.current[operationId];
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [resolveCurrentArtifactSourceIdentity, setError, t]);

  useEffect(() => {
    if (!combineMode) {
      setSelectedHighlights(new Set());
      setOrderedSelection([]);
      orderedSelectionRef.current = [];
      combinedSelectionSignatureRef.current = null;
      combineCutStateRef.current = { status: 'idle', percent: 0 };
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
    replaceHighlights,
    orderedSelection,
    resetHighlightsState,
    selectedHighlights,
    setCombineMode,
    setHighlightAspectMode,
    videoAvailableForHighlights,
  };
}
