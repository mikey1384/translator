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
import * as SystemIPC from '../../ipc/system';
import {
  cutCombinedHighlights,
  cutHighlightClip,
  onCombinedHighlightCutProgress,
  onHighlightCutProgress,
} from '../../ipc/subtitles';
import { save as saveFile } from '../../ipc/file';
import {
  getSourceVideoErrorMessage,
  getSourceVideoUnavailableMessage,
  isSourceVideoPathAccessible,
} from '../../utils/sourceVideoErrors';
import {
  buildHighlightFilename,
  getHighlightKey,
  type HighlightClipCutState,
} from './TranscriptSummaryPanel.helpers';
import type { CombineCutState } from './TranscriptSummaryLogic.types';

type HighlightClipAspectMode = Exclude<HighlightAspectMode, 'vertical'>;

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
  combineAspectMode: HighlightAspectMode;
  combineCutState: CombineCutState;
  combineMode: boolean;
  downloadStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  getHighlightAspectMode: (
    highlight: TranscriptHighlight
  ) => HighlightAspectMode;
  getHighlightStateKey: (highlight: TranscriptHighlight) => string;
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
  highlights: TranscriptHighlight[];
  highlightCutState: Record<string, HighlightClipCutState>;
  mergeHighlightUpdates: (incoming?: TranscriptHighlight[] | null) => void;
  orderedSelection: TranscriptHighlight[];
  replaceHighlights: (incoming?: TranscriptHighlight[] | null) => void;
  resetHighlightsState: () => void;
  isHighlightCutting: (highlight: TranscriptHighlight) => boolean;
  selectedHighlights: Set<string>;
  setCombineAspectMode: (mode: HighlightAspectMode) => void;
  setCombineMode: Dispatch<SetStateAction<boolean>>;
  setHighlightAspectModeForHighlight: (
    highlight: TranscriptHighlight,
    mode: HighlightAspectMode
  ) => void;
  videoAvailableForHighlights: boolean;
};

type CombinedRuntimeArtifact = {
  outputPath: string | null;
  selectionSignature: string | null;
};

type SourceRuntimeArtifacts = {
  combinedOutputsByMode: Partial<
    Record<HighlightClipAspectMode, CombinedRuntimeArtifact>
  >;
  highlightPreferredModesByArtifactKey: Record<string, HighlightClipAspectMode>;
  highlightVideoPaths: Record<
    string,
    Partial<Record<HighlightClipAspectMode, string>>
  >;
};

type HighlightCutOperationMeta = {
  aspectMode: HighlightClipAspectMode;
  generation: number;
  sourceIdentity: string;
  stateKey: string;
};

type CombinedCutOperationMeta = {
  aspectMode: HighlightClipAspectMode;
  selectionSignature: string;
  sourceIdentity: string;
};

const DEFAULT_HIGHLIGHT_ASPECT_MODE: HighlightClipAspectMode =
  'vertical_reframe';
const HIGHLIGHT_ASPECT_MODES: HighlightClipAspectMode[] = [
  'vertical_reframe',
  'vertical_fit',
  'original',
];

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

function resolveHighlightAspectMode(
  value: HighlightAspectMode | null | undefined
): HighlightClipAspectMode {
  if (value === 'original') return 'original';
  if (value === 'vertical_fit') return 'vertical_fit';
  return 'vertical_reframe';
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
  originalVideoPath,
  sourceAssetIdentity,
  sourceUrl,
  libraryEntryId,
}: {
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
  libraryEntryId: string | null;
}): string {
  const currentAssetIdentity = normalizeSourceValue(sourceAssetIdentity);
  if (currentAssetIdentity) {
    return `asset:${currentAssetIdentity}`;
  }
  const currentVideoPath = normalizeSourcePathIdentity(originalVideoPath);
  if (currentVideoPath) {
    return `path:${currentVideoPath}`;
  }
  const fallbackAssetIdentity = normalizeSourceValue(
    fallbackVideoAssetIdentity
  );
  if (fallbackAssetIdentity) {
    return `asset:${fallbackAssetIdentity}`;
  }
  const fallbackPath = normalizeSourcePathIdentity(fallbackVideoPath);
  if (fallbackPath) {
    return `path:${fallbackPath}`;
  }
  const url = normalizeSourceValue(sourceUrl);
  const library = normalizeSourceValue(libraryEntryId);
  if (url || library) {
    return `meta:${url}|${library}`;
  }
  return 'meta:|';
}

function withoutVideoPath(highlight: TranscriptHighlight): TranscriptHighlight {
  const { videoPath: _videoPath, ...rest } = highlight;
  return rest;
}

function buildHighlightArtifactKey(highlight: TranscriptHighlight): string {
  const start = Number.isFinite(highlight.start)
    ? Math.round(highlight.start * 1000)
    : 0;
  const end = Number.isFinite(highlight.end)
    ? Math.round(highlight.end * 1000)
    : start;
  return `${start}-${end}`;
}

function buildHighlightUiKey(highlight: TranscriptHighlight): string {
  return getHighlightKey(withoutVideoPath(highlight));
}

function buildHighlightArtifactQueueMap(
  highlights: TranscriptHighlight[],
  excludedUiKeys: Set<string> = new Set()
): Map<string, TranscriptHighlight[]> {
  return highlights.reduce<Map<string, TranscriptHighlight[]>>(
    (accumulator, highlight) => {
      const uiKey = buildHighlightUiKey(highlight);
      if (excludedUiKeys.has(uiKey)) return accumulator;
      const artifactKey = buildHighlightArtifactKey(
        withoutVideoPath(highlight)
      );
      const existing = accumulator.get(artifactKey) ?? [];
      existing.push(highlight);
      accumulator.set(artifactKey, existing);
      return accumulator;
    },
    new Map()
  );
}

function shiftHighlightArtifactMatch(
  queueMap: Map<string, TranscriptHighlight[]>,
  artifactKey: string
): TranscriptHighlight | null {
  const queue = queueMap.get(artifactKey);
  if (!queue || queue.length === 0) {
    return null;
  }

  const next = queue.shift() ?? null;
  if (queue.length === 0) {
    queueMap.delete(artifactKey);
  }
  return next;
}

function buildHighlightModeStateKeyFromUiKey(
  uiKey: string,
  aspectMode: HighlightClipAspectMode
): string {
  return `${uiKey}|${aspectMode}`;
}

function buildHighlightModeStateKey(
  highlight: TranscriptHighlight,
  aspectMode: HighlightClipAspectMode
): string {
  return buildHighlightModeStateKeyFromUiKey(
    buildHighlightUiKey(highlight),
    aspectMode
  );
}

function extractUiKeyFromModeStateKey(stateKey: string): string {
  const separatorIndex = stateKey.lastIndexOf('|');
  if (separatorIndex <= 0) return stateKey;
  return stateKey.slice(0, separatorIndex);
}

function getHighlightPreferredMode(
  highlight: TranscriptHighlight,
  preferredModesByUiKey: Record<string, HighlightClipAspectMode>,
  preferredModesByArtifactKey: Record<string, HighlightClipAspectMode> = {}
): HighlightClipAspectMode {
  const uiKey = buildHighlightUiKey(highlight);
  if (preferredModesByUiKey[uiKey]) {
    return preferredModesByUiKey[uiKey];
  }
  const artifactKey = buildHighlightArtifactKey(withoutVideoPath(highlight));
  return (
    preferredModesByArtifactKey[artifactKey] || DEFAULT_HIGHLIGHT_ASPECT_MODE
  );
}

function buildVisibleHighlightAspectModes(
  highlights: TranscriptHighlight[],
  preferredModesByUiKey: Record<string, HighlightClipAspectMode>,
  preferredModesByArtifactKey: Record<string, HighlightClipAspectMode>
): Record<string, HighlightClipAspectMode> {
  const nextModes: Record<string, HighlightClipAspectMode> = {};
  for (const highlight of highlights) {
    const cleaned = withoutVideoPath(highlight);
    nextModes[buildHighlightUiKey(cleaned)] = getHighlightPreferredMode(
      cleaned,
      preferredModesByUiKey,
      preferredModesByArtifactKey
    );
  }
  return nextModes;
}

function appendHighlightModeSuffix(
  filename: string,
  aspectMode: HighlightClipAspectMode
): string {
  if (aspectMode === 'original') return filename;
  const suffix =
    aspectMode === 'vertical_fit' ? '-shorts-fit' : '-shorts-reframe';
  return filename.replace(/\.mp4$/i, `${suffix}.mp4`);
}

function extractHighlightVideoPaths(
  highlights: TranscriptHighlight[],
  preferredModesByUiKey: Record<string, HighlightClipAspectMode>,
  preferredModesByArtifactKey: Record<string, HighlightClipAspectMode>
): Record<string, Partial<Record<HighlightClipAspectMode, string>>> {
  const result: Record<
    string,
    Partial<Record<HighlightClipAspectMode, string>>
  > = {};
  for (const highlight of highlights) {
    if (!highlight.videoPath) continue;
    const artifactKey = buildHighlightArtifactKey(withoutVideoPath(highlight));
    const aspectMode = getHighlightPreferredMode(
      highlight,
      preferredModesByUiKey,
      preferredModesByArtifactKey
    );
    result[artifactKey] = {
      ...(result[artifactKey] || {}),
      [aspectMode]: highlight.videoPath,
    };
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
  const [highlightAspectModes, setHighlightAspectModes] = useState<
    Record<string, HighlightClipAspectMode>
  >({});
  const [combineAspectMode, setCombineAspectModeState] =
    useState<HighlightClipAspectMode>(DEFAULT_HIGHLIGHT_ASPECT_MODE);
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
  const currentViewSourceIdentityRef = useRef('');
  const currentArtifactSourceIdentityRef = useRef('');
  const highlightsRef = useRef<TranscriptHighlight[]>([]);
  const orderedSelectionRef = useRef<TranscriptHighlight[]>([]);
  const highlightAspectModesRef = useRef<
    Record<string, HighlightClipAspectMode>
  >({});
  const combineAspectModeRef = useRef<HighlightClipAspectMode>(
    DEFAULT_HIGHLIGHT_ASPECT_MODE
  );
  const combineCutStateRef = useRef<CombineCutState>({
    status: 'idle',
    percent: 0,
  });
  const combinedSelectionSignatureRef = useRef<string | null>(null);
  const highlightCutSourceByOperationRef = useRef<
    Record<string, HighlightCutOperationMeta>
  >({});
  const combinedCutSourceByOperationRef = useRef<
    Record<string, CombinedCutOperationMeta>
  >({});
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
        originalVideoPath,
        sourceAssetIdentity,
        sourceUrl,
        libraryEntryId,
      }),
    [
      fallbackVideoAssetIdentity,
      fallbackVideoPath,
      libraryEntryId,
      originalVideoPath,
      sourceAssetIdentity,
      sourceUrl,
    ]
  );

  const ensureSourceArtifacts = useCallback(
    (identity: string): SourceRuntimeArtifacts => {
      const existing = runtimeArtifactsBySourceRef.current[identity];
      if (existing) return existing;
      const created: SourceRuntimeArtifacts = {
        combinedOutputsByMode: {},
        highlightPreferredModesByArtifactKey: {},
        highlightVideoPaths: {},
      };
      runtimeArtifactsBySourceRef.current[identity] = created;
      return created;
    },
    []
  );

  const ensureCombinedArtifact = useCallback(
    (
      sourceArtifacts: SourceRuntimeArtifacts,
      aspectMode: HighlightClipAspectMode
    ): CombinedRuntimeArtifact => {
      const existing = sourceArtifacts.combinedOutputsByMode[aspectMode];
      if (existing) return existing;
      const created: CombinedRuntimeArtifact = {
        outputPath: null,
        selectionSignature: null,
      };
      sourceArtifacts.combinedOutputsByMode[aspectMode] = created;
      return created;
    },
    []
  );

  const applySourceArtifacts = useCallback(
    (
      identity: string,
      entries: TranscriptHighlight[],
      preferredModes: Record<
        string,
        HighlightClipAspectMode
      > = highlightAspectModesRef.current
    ): TranscriptHighlight[] => {
      const sourceArtifacts = ensureSourceArtifacts(identity);
      return entries.map(entry => {
        const cleaned = withoutVideoPath(entry);
        const artifactKey = buildHighlightArtifactKey(cleaned);
        const aspectMode = getHighlightPreferredMode(
          cleaned,
          preferredModes,
          sourceArtifacts.highlightPreferredModesByArtifactKey
        );
        const sourceVideoPath =
          sourceArtifacts.highlightVideoPaths[artifactKey]?.[aspectMode];
        if (!sourceVideoPath) return cleaned;
        return { ...cleaned, videoPath: sourceVideoPath };
      });
    },
    [ensureSourceArtifacts]
  );

  const setHighlightVideoPathForSource = useCallback(
    ({
      aspectMode,
      highlight,
      identity,
      videoPath,
    }: {
      aspectMode: HighlightClipAspectMode;
      highlight: TranscriptHighlight;
      identity: string;
      videoPath: string;
    }) => {
      if (!identity || !videoPath) return;
      const sourceArtifacts = ensureSourceArtifacts(identity);
      const artifactKey = buildHighlightArtifactKey(
        withoutVideoPath(highlight)
      );
      sourceArtifacts.highlightVideoPaths[artifactKey] = {
        ...(sourceArtifacts.highlightVideoPaths[artifactKey] || {}),
        [aspectMode]: videoPath,
      };
    },
    [ensureSourceArtifacts]
  );

  const persistVisibleArtifactsForSource = useCallback(
    (identity: string) => {
      if (!identity) return;
      const sourceArtifacts = ensureSourceArtifacts(identity);
      const visibleVideoPaths = extractHighlightVideoPaths(
        highlightsRef.current,
        highlightAspectModesRef.current,
        sourceArtifacts.highlightPreferredModesByArtifactKey
      );
      for (const [artifactKey, modePaths] of Object.entries(
        visibleVideoPaths
      )) {
        sourceArtifacts.highlightVideoPaths[artifactKey] = {
          ...(sourceArtifacts.highlightVideoPaths[artifactKey] || {}),
          ...modePaths,
        };
      }
      if (
        combineCutStateRef.current.status === 'ready' &&
        combineCutStateRef.current.outputPath &&
        combinedSelectionSignatureRef.current
      ) {
        const combinedArtifact = ensureCombinedArtifact(
          sourceArtifacts,
          combineAspectModeRef.current
        );
        combinedArtifact.outputPath = combineCutStateRef.current.outputPath;
        combinedArtifact.selectionSignature =
          combinedSelectionSignatureRef.current;
      }
    },
    [ensureCombinedArtifact, ensureSourceArtifacts]
  );

  const resolveCurrentArtifactSourceIdentity = useCallback((): string => {
    const existingIdentity = currentArtifactSourceIdentityRef.current;
    if (existingIdentity) return existingIdentity;
    currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
    ensureSourceArtifacts(artifactSourceIdentity);
    return artifactSourceIdentity;
  }, [artifactSourceIdentity, ensureSourceArtifacts]);

  const buildCombinedCutStateForSource = useCallback(
    ({
      aspectMode,
      identity,
      orderedSelection,
    }: {
      aspectMode: HighlightClipAspectMode;
      identity: string;
      orderedSelection: TranscriptHighlight[];
    }): {
      nextCombineCutState: CombineCutState;
      nextSelectionSignature: string | null;
    } => {
      const sourceArtifacts = ensureSourceArtifacts(identity);
      const combinedArtifact = ensureCombinedArtifact(
        sourceArtifacts,
        aspectMode
      );
      const nextSelectionSignature =
        buildOrderedSelectionSignature(orderedSelection);
      const activeCombinedOperationId = combineCutStateRef.current.operationId;
      const activeCombinedOperationMeta =
        activeCombinedOperationId &&
        combinedCutSourceByOperationRef.current[activeCombinedOperationId]
          ? combinedCutSourceByOperationRef.current[activeCombinedOperationId]
          : null;
      const shouldPreserveInFlightCombinedCut = Boolean(
        combineCutStateRef.current.status === 'cutting' &&
        activeCombinedOperationMeta &&
        activeCombinedOperationMeta.sourceIdentity === identity &&
        activeCombinedOperationMeta.aspectMode === aspectMode
      );
      const canReuseCombinedArtifact = Boolean(
        nextSelectionSignature &&
        combinedArtifact.outputPath &&
        combinedArtifact.selectionSignature === nextSelectionSignature
      );
      const nextCombineCutState: CombineCutState =
        shouldPreserveInFlightCombinedCut
          ? combineCutStateRef.current
          : canReuseCombinedArtifact
            ? {
                status: 'ready',
                percent: 100,
                outputPath: combinedArtifact.outputPath!,
              }
            : { status: 'idle', percent: 0 };

      return {
        nextCombineCutState,
        nextSelectionSignature: shouldPreserveInFlightCombinedCut
          ? combinedSelectionSignatureRef.current
          : canReuseCombinedArtifact
            ? combinedArtifact.selectionSignature
            : null,
      };
    },
    [ensureCombinedArtifact, ensureSourceArtifacts]
  );

  const syncCombinedCutStateForSource = useCallback(
    (
      identity: string,
      nextOrderedSelection: TranscriptHighlight[] = orderedSelectionRef.current,
      nextAspectMode: HighlightClipAspectMode = combineAspectModeRef.current
    ) => {
      const { nextCombineCutState, nextSelectionSignature } =
        buildCombinedCutStateForSource({
          aspectMode: nextAspectMode,
          identity,
          orderedSelection: nextOrderedSelection,
        });
      combineCutStateRef.current = nextCombineCutState;
      combinedSelectionSignatureRef.current = nextSelectionSignature;
      setCombineCutState(nextCombineCutState);
    },
    [buildCombinedCutStateForSource]
  );

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
    highlightAspectModesRef.current = highlightAspectModes;
  }, [highlightAspectModes]);

  useEffect(() => {
    combineAspectModeRef.current = combineAspectMode;
  }, [combineAspectMode]);

  useEffect(() => {
    combineCutStateRef.current = combineCutState;
  }, [combineCutState]);

  useLayoutEffect(() => {
    const previousViewSourceIdentity = currentViewSourceIdentityRef.current;
    const previousArtifactSourceIdentity =
      currentArtifactSourceIdentityRef.current;
    const sourceArtifacts = ensureSourceArtifacts(artifactSourceIdentity);
    const nextHighlightAspectModes = buildVisibleHighlightAspectModes(
      highlightsRef.current.map(highlight => withoutVideoPath(highlight)),
      {},
      sourceArtifacts.highlightPreferredModesByArtifactKey
    );

    if (!previousViewSourceIdentity) {
      currentViewSourceIdentityRef.current = viewSourceIdentity;
      currentArtifactSourceIdentityRef.current = artifactSourceIdentity;
      highlightAspectModesRef.current = nextHighlightAspectModes;
      setHighlightAspectModes(nextHighlightAspectModes);
      syncCombinedCutStateForSource(
        artifactSourceIdentity,
        orderedSelectionRef.current,
        combineAspectModeRef.current
      );
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

    const nextHighlights = applySourceArtifacts(
      artifactSourceIdentity,
      highlightsRef.current.map(highlight => withoutVideoPath(highlight)),
      nextHighlightAspectModes
    );
    const nextOrderedSelection = applySourceArtifacts(
      artifactSourceIdentity,
      orderedSelectionRef.current.map(highlight => withoutVideoPath(highlight)),
      nextHighlightAspectModes
    );
    const { nextCombineCutState, nextSelectionSignature } =
      buildCombinedCutStateForSource({
        aspectMode: combineAspectModeRef.current,
        identity: artifactSourceIdentity,
        orderedSelection: nextOrderedSelection,
      });

    highlightsRef.current = nextHighlights;
    orderedSelectionRef.current = nextOrderedSelection;
    highlightAspectModesRef.current = nextHighlightAspectModes;
    combineCutStateRef.current = nextCombineCutState;
    combinedSelectionSignatureRef.current = nextSelectionSignature;

    setHighlightAspectModes(nextHighlightAspectModes);
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
    buildCombinedCutStateForSource,
    ensureSourceArtifacts,
    persistVisibleArtifactsForSource,
    syncCombinedCutStateForSource,
    viewSourceIdentity,
  ]);

  const mergeHighlightUpdates = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      let nextHighlightAspectModes = highlightAspectModesRef.current;
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
        nextHighlightAspectModes = buildVisibleHighlightAspectModes(
          merged,
          highlightAspectModesRef.current,
          sourceArtifacts.highlightPreferredModesByArtifactKey
        );
        return applySourceArtifacts(
          activeSourceIdentity,
          merged,
          nextHighlightAspectModes
        );
      });
      highlightAspectModesRef.current = nextHighlightAspectModes;
      setHighlightAspectModes(nextHighlightAspectModes);
    },
    [
      applySourceArtifacts,
      ensureSourceArtifacts,
      resolveCurrentArtifactSourceIdentity,
    ]
  );

  const replaceHighlights = useCallback(
    (incoming?: TranscriptHighlight[] | null) => {
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
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
      const normalizedEntries = Array.from(normalizedIncoming).sort(
        (a, b) => a.start - b.start
      );
      const nextHighlightAspectModes = buildVisibleHighlightAspectModes(
        normalizedEntries,
        highlightAspectModesRef.current,
        sourceArtifacts.highlightPreferredModesByArtifactKey
      );
      const normalizedList = applySourceArtifacts(
        activeSourceIdentity,
        normalizedEntries,
        nextHighlightAspectModes
      );
      const nextUiKeySet = new Set(
        normalizedList.map(highlight => getHighlightKey(highlight))
      );
      const normalizedUiMap = new Map(
        normalizedList.map(highlight => [
          buildHighlightUiKey(highlight),
          highlight,
        ])
      );
      const reservedSelectionUiKeys = new Set(
        orderedSelectionRef.current
          .map(highlight => buildHighlightUiKey(highlight))
          .filter(uiKey => normalizedUiMap.has(uiKey))
      );
      const normalizedArtifactQueueMap = buildHighlightArtifactQueueMap(
        normalizedList,
        reservedSelectionUiKeys
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
        return applySourceArtifacts(
          activeSourceIdentity,
          merged,
          nextHighlightAspectModes
        );
      });
      highlightAspectModesRef.current = nextHighlightAspectModes;
      setHighlightAspectModes(nextHighlightAspectModes);

      setDownloadStatus(previous =>
        Object.fromEntries(
          Object.entries(previous).filter(([stateKey]) =>
            nextUiKeySet.has(extractUiKeyFromModeStateKey(stateKey))
          )
        )
      );
      setHighlightCutState(previous =>
        Object.fromEntries(
          Object.entries(previous).filter(([stateKey]) =>
            nextUiKeySet.has(extractUiKeyFromModeStateKey(stateKey))
          )
        )
      );

      const nextOrderedSelection = applySourceArtifacts(
        activeSourceIdentity,
        orderedSelectionRef.current
          .map(highlight => {
            const uiKey = buildHighlightUiKey(highlight);
            const replacement =
              normalizedUiMap.get(uiKey) ??
              shiftHighlightArtifactMatch(
                normalizedArtifactQueueMap,
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
          ),
        nextHighlightAspectModes
      );
      setOrderedSelection(nextOrderedSelection);
      setSelectedHighlights(
        new Set(
          nextOrderedSelection.map(highlight => getHighlightKey(highlight))
        )
      );

      const { nextCombineCutState, nextSelectionSignature } =
        buildCombinedCutStateForSource({
          aspectMode: combineAspectModeRef.current,
          identity: activeSourceIdentity,
          orderedSelection: nextOrderedSelection,
        });
      combineCutStateRef.current = nextCombineCutState;
      combinedSelectionSignatureRef.current = nextSelectionSignature;
      setCombineCutState(nextCombineCutState);

      if (nextUiKeySet.size === 0) {
        setCombineMode(false);
      }
    },
    [
      applySourceArtifacts,
      buildCombinedCutStateForSource,
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
    highlightAspectModesRef.current = {};
    highlightsRef.current = [];
    orderedSelectionRef.current = [];
    combineCutStateRef.current = { status: 'idle', percent: 0 };
    combinedSelectionSignatureRef.current = null;
    setHighlightAspectModes({});
    setHighlights([]);
    setDownloadStatus({});
    setHighlightCutState({});
    setSelectedHighlights(new Set());
    setOrderedSelection([]);
    setCombineCutState({ status: 'idle', percent: 0 });
  }, [
    artifactSourceIdentity,
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
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      const effectiveAspectMode =
        operationMeta?.aspectMode ||
        (highlight
          ? getHighlightPreferredMode(
              highlight,
              highlightAspectModesRef.current,
              sourceArtifacts.highlightPreferredModesByArtifactKey
            )
          : DEFAULT_HIGHLIGHT_ASPECT_MODE);
      const stateKey =
        operationMeta?.stateKey ||
        (highlight
          ? buildHighlightModeStateKey(highlight, effectiveAspectMode)
          : progress.highlightId || null);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));

      if (stateKey && shouldApplyVisibleUpdates) {
        setHighlightCutState(prev => {
          const prevState = prev[stateKey] || {
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

          return {
            ...prev,
            [stateKey]: {
              status,
              percent: status === 'ready' ? 100 : clampedPercent,
              error: progress.error || undefined,
              operationId: progress.operationId,
            },
          };
        });
      }

      if (highlight) {
        if (highlight.videoPath && artifactSourceIdentity) {
          setHighlightVideoPathForSource({
            aspectMode: effectiveAspectMode,
            highlight,
            identity: artifactSourceIdentity,
            videoPath: highlight.videoPath,
          });
        }

        if (shouldApplyVisibleUpdates) {
          mergeHighlightUpdates([highlight]);
          if (stateKey) {
            setDownloadStatus(prev => {
              if (!prev[stateKey]) return prev;
              const next = { ...prev };
              delete next[stateKey];
              return next;
            });
          }
        }
      }

      if (progress.error && shouldApplyVisibleUpdates) {
        if (progress.error === ERROR_CODES.INSUFFICIENT_CREDITS) {
          void SystemIPC.refreshCreditSnapshot().catch(error => {
            console.warn(
              '[useTranscriptHighlightsFlow] Failed to refresh credits after insufficient-credit highlight generation:',
              error
            );
          });
          setError(t('summary.insufficientCredits'));
        } else {
          const friendlyError =
            getSourceVideoErrorMessage(progress.error) || progress.error;
          setError(
            t('summary.downloadHighlightFailed', {
              message: friendlyError,
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
    ensureSourceArtifacts,
    mergeHighlightUpdates,
    resolveCurrentArtifactSourceIdentity,
    setError,
    setHighlightVideoPathForSource,
    t,
  ]);

  const handleDownloadHighlight = useCallback(
    async (highlight: TranscriptHighlight, index: number) => {
      if (!highlight?.videoPath) return;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      const aspectMode = getHighlightPreferredMode(
        highlight,
        highlightAspectModesRef.current,
        sourceArtifacts.highlightPreferredModesByArtifactKey
      );
      const stateKey = buildHighlightModeStateKey(highlight, aspectMode);

      setDownloadStatus(prev => ({ ...prev, [stateKey]: 'saving' }));

      try {
        const defaultName = appendHighlightModeSuffix(
          buildHighlightFilename(highlight, index),
          aspectMode
        );
        const result = await saveFile({
          sourcePath: highlight.videoPath,
          defaultPath: defaultName,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          title: t('summary.saveHighlightDialogTitle', 'Save highlight clip'),
        });

        if (!result?.success || !result.filePath) {
          throw new Error(result?.error || 'Unknown error');
        }

        setDownloadStatus(prev => ({ ...prev, [stateKey]: 'saved' }));
        if (downloadTimers.current[stateKey]) {
          clearTimeout(downloadTimers.current[stateKey]);
        }
        downloadTimers.current[stateKey] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
          delete downloadTimers.current[stateKey];
        }, 4000);
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] save highlight failed', err);
        const message =
          getSourceVideoErrorMessage(err?.message || String(err)) ||
          err?.message ||
          String(err);
        setDownloadStatus(prev => ({ ...prev, [stateKey]: 'error' }));
        if (downloadTimers.current[stateKey]) {
          clearTimeout(downloadTimers.current[stateKey]);
        }
        downloadTimers.current[stateKey] = setTimeout(() => {
          setDownloadStatus(prev => {
            const next = { ...prev };
            delete next[stateKey];
            return next;
          });
          delete downloadTimers.current[stateKey];
        }, 5000);

        setError(
          t('summary.downloadHighlightFailed', {
            message,
          })
        );
      }
    },
    [ensureSourceArtifacts, resolveCurrentArtifactSourceIdentity, setError, t]
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
      if (!(await isSourceVideoPathAccessible(videoPath))) {
        setError(getSourceVideoUnavailableMessage());
        return;
      }

      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      const aspectMode = getHighlightPreferredMode(
        highlight,
        highlightAspectModesRef.current,
        sourceArtifacts.highlightPreferredModesByArtifactKey
      );
      const stateKey = buildHighlightModeStateKey(highlight, aspectMode);
      const existingState = highlightCutState[stateKey];
      if (existingState?.status === 'cutting') {
        return;
      }

      const operationId = `highlight-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const operationSourceIdentity = activeSourceIdentity;
      highlightCutSourceByOperationRef.current[operationId] = {
        aspectMode,
        generation: highlightDisplayGenerationRef.current,
        sourceIdentity: operationSourceIdentity,
        stateKey,
      };

      setHighlightCutState(prev => ({
        ...prev,
        [stateKey]: { status: 'cutting', percent: 0, operationId },
      }));
      setError(null);

      try {
        const result = await cutHighlightClip({
          videoPath,
          highlight,
          operationId,
          aspectMode,
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
              [stateKey]: { status: 'cancelled', percent: 0 },
            }));
          }
          return;
        }

        if (result?.highlight) {
          const updated = result.highlight as TranscriptHighlight;
          if (updated.videoPath) {
            setHighlightVideoPathForSource({
              aspectMode,
              highlight: updated,
              identity: operationSourceIdentity,
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
            [stateKey]: { status: 'ready', percent: 100 },
          }));
        }
      } catch (err: any) {
        console.error('[TranscriptSummaryPanel] cut highlight failed', err);
        const message = err?.message || String(err);
        const friendlyMessage = getSourceVideoErrorMessage(message) || message;
        if (
          currentArtifactSourceIdentityRef.current === operationSourceIdentity
        ) {
          setHighlightCutState(prev => ({
            ...prev,
            [stateKey]: { status: 'error', percent: 0, error: friendlyMessage },
          }));
          setError(
            t('summary.downloadHighlightFailed', {
              message: friendlyMessage,
            })
          );
        }
      } finally {
        delete highlightCutSourceByOperationRef.current[operationId];
      }
    },
    [
      fallbackVideoPath,
      ensureSourceArtifacts,
      highlightCutState,
      mergeHighlightUpdates,
      originalVideoPath,
      resolveCurrentArtifactSourceIdentity,
      setError,
      setHighlightVideoPathForSource,
      t,
    ]
  );

  const setHighlightAspectModeForHighlight = useCallback(
    (highlight: TranscriptHighlight, mode: HighlightAspectMode) => {
      const normalizedMode = resolveHighlightAspectMode(mode);
      const uiKey = buildHighlightUiKey(highlight);
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const sourceArtifacts = ensureSourceArtifacts(activeSourceIdentity);
      const currentMode = getHighlightPreferredMode(
        highlight,
        highlightAspectModesRef.current,
        sourceArtifacts.highlightPreferredModesByArtifactKey
      );
      if (currentMode === normalizedMode) return;

      const artifactKey = buildHighlightArtifactKey(
        withoutVideoPath(highlight)
      );
      const nextHighlightAspectModes = {
        ...highlightAspectModesRef.current,
        [uiKey]: normalizedMode,
      };
      sourceArtifacts.highlightPreferredModesByArtifactKey = {
        ...sourceArtifacts.highlightPreferredModesByArtifactKey,
        [artifactKey]: normalizedMode,
      };
      highlightAspectModesRef.current = nextHighlightAspectModes;
      setHighlightAspectModes(nextHighlightAspectModes);
      setHighlights(prev =>
        applySourceArtifacts(
          activeSourceIdentity,
          prev.map(entry => withoutVideoPath(entry)),
          nextHighlightAspectModes
        )
      );
      setOrderedSelection(prev =>
        applySourceArtifacts(
          activeSourceIdentity,
          prev.map(entry => withoutVideoPath(entry)),
          nextHighlightAspectModes
        )
      );
    },
    [
      applySourceArtifacts,
      ensureSourceArtifacts,
      resolveCurrentArtifactSourceIdentity,
    ]
  );

  const setCombineAspectMode = useCallback((mode: HighlightAspectMode) => {
    const normalizedMode = resolveHighlightAspectMode(mode);
    combineAspectModeRef.current = normalizedMode;
    setCombineAspectModeState(normalizedMode);
  }, []);

  const handleDragStart = useCallback((event: DragEvent, index: number) => {
    event.dataTransfer.setData('text/plain', String(index));
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((event: DragEvent, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex = parseInt(event.dataTransfer.getData('text/plain'), 10);
    if (sourceIndex === targetIndex || Number.isNaN(sourceIndex)) return;

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
    if (!(await isSourceVideoPathAccessible(videoPath))) {
      setError(getSourceVideoUnavailableMessage());
      return;
    }

    const aspectMode = combineAspectModeRef.current;
    const selectionSignature = buildOrderedSelectionSignature(orderedSelection);
    const operationId = `combined-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const operationSourceIdentity = resolveCurrentArtifactSourceIdentity();
    combinedCutSourceByOperationRef.current[operationId] = {
      aspectMode,
      selectionSignature,
      sourceIdentity: operationSourceIdentity,
    };

    const nextCombineCutState: CombineCutState = {
      status: 'cutting',
      percent: 0,
      operationId,
    };
    setCombineCutState(nextCombineCutState);
    combineCutStateRef.current = nextCombineCutState;
    combinedSelectionSignatureRef.current = null;
    setError(null);

    try {
      const result = await cutCombinedHighlights({
        videoPath,
        highlights: orderedSelection,
        operationId,
        aspectMode,
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
        const combinedArtifact = ensureCombinedArtifact(
          sourceArtifacts,
          aspectMode
        );
        if (selectionSignature) {
          combinedArtifact.outputPath = result.videoPath;
          combinedArtifact.selectionSignature = selectionSignature;
          if (
            combineCutStateRef.current.operationId === operationId &&
            currentArtifactSourceIdentityRef.current === operationSourceIdentity
          ) {
            combinedSelectionSignatureRef.current = selectionSignature;
          }
        } else {
          combinedArtifact.outputPath = null;
          combinedArtifact.selectionSignature = null;
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
        const readyState: CombineCutState = {
          status: 'ready',
          percent: 100,
          outputPath: result.videoPath,
        };
        setCombineCutState(readyState);
        combineCutStateRef.current = readyState;
      }
    } catch (err: any) {
      console.error('[TranscriptSummaryPanel] cut combined failed', err);
      const message = err?.message || String(err);
      const friendlyMessage = getSourceVideoErrorMessage(message) || message;
      if (
        combineCutStateRef.current.operationId === operationId &&
        currentArtifactSourceIdentityRef.current === operationSourceIdentity
      ) {
        const nextErrorState: CombineCutState = {
          status: 'error',
          percent: 0,
          error: friendlyMessage,
        };
        setCombineCutState(nextErrorState);
        combineCutStateRef.current = nextErrorState;
        combinedSelectionSignatureRef.current = null;
        setError(
          t('summary.combinedCutFailed', {
            defaultValue: 'Failed to cut combined highlights: {{message}}',
            message: friendlyMessage,
          })
        );
      }
    } finally {
      delete combinedCutSourceByOperationRef.current[operationId];
    }
  }, [
    ensureCombinedArtifact,
    ensureSourceArtifacts,
    fallbackVideoPath,
    orderedSelection,
    originalVideoPath,
    resolveCurrentArtifactSourceIdentity,
    setError,
    t,
  ]);

  const handleDownloadCombined = useCallback(
    async (outputPath: string) => {
      try {
        const defaultName = appendHighlightModeSuffix(
          `combined-highlights-${Date.now()}.mp4`,
          combineAspectModeRef.current
        );
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
        const message =
          getSourceVideoErrorMessage(err?.message || String(err)) ||
          err?.message ||
          String(err);
        setError(
          t('summary.downloadHighlightFailed', {
            message,
          })
        );
      }
    },
    [setError, t]
  );

  useEffect(() => {
    const unsubscribe = onCombinedHighlightCutProgress(progress => {
      const operationId = progress.operationId;
      const trackedOperationMeta =
        operationId && combinedCutSourceByOperationRef.current[operationId]
          ? combinedCutSourceByOperationRef.current[operationId]
          : null;
      const activeCombineOperationId = combineCutStateRef.current.operationId;
      const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
      const stageText = String(progress.stage || '').toLowerCase();
      const isTerminal = isTerminalProgressStage(stageText);

      if (!activeCombineOperationId) {
        if (isTerminal && operationId) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      if (!operationId || operationId !== activeCombineOperationId) {
        if (isTerminal && operationId) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      if (!trackedOperationMeta) {
        if (isTerminal) {
          delete combinedCutSourceByOperationRef.current[operationId];
        }
        return;
      }

      if (
        trackedOperationMeta.sourceIdentity !== activeSourceIdentity ||
        trackedOperationMeta.aspectMode !== combineAspectModeRef.current
      ) {
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
        const friendlyError =
          getSourceVideoErrorMessage(progress.error) || progress.error;
        setError(
          t('summary.combinedCutFailed', {
            defaultValue: 'Failed to cut combined highlights: {{message}}',
            message: friendlyError,
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
    const activeSourceIdentity = resolveCurrentArtifactSourceIdentity();
    syncCombinedCutStateForSource(
      activeSourceIdentity,
      orderedSelection,
      combineAspectMode
    );
  }, [
    combineAspectMode,
    orderedSelection,
    resolveCurrentArtifactSourceIdentity,
    syncCombinedCutStateForSource,
  ]);

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
    combineAspectMode,
    combineCutState,
    combineMode,
    downloadStatus,
    getHighlightAspectMode: highlight =>
      getHighlightPreferredMode(
        highlight,
        highlightAspectModes,
        ensureSourceArtifacts(resolveCurrentArtifactSourceIdentity())
          .highlightPreferredModesByArtifactKey
      ),
    getHighlightStateKey: highlight =>
      buildHighlightModeStateKey(
        highlight,
        getHighlightPreferredMode(
          highlight,
          highlightAspectModes,
          ensureSourceArtifacts(resolveCurrentArtifactSourceIdentity())
            .highlightPreferredModesByArtifactKey
        )
      ),
    handleCutCombined,
    handleCutHighlightClip,
    handleDownloadCombined,
    handleDownloadHighlight,
    handleDragStart,
    handleDrop,
    handleToggleHighlightSelect,
    highlights,
    highlightCutState,
    mergeHighlightUpdates,
    orderedSelection,
    replaceHighlights,
    resetHighlightsState,
    isHighlightCutting: highlight => {
      const uiKey = buildHighlightUiKey(highlight);
      return HIGHLIGHT_ASPECT_MODES.some(
        aspectMode =>
          highlightCutState[
            buildHighlightModeStateKeyFromUiKey(uiKey, aspectMode)
          ]?.status === 'cutting'
      );
    },
    selectedHighlights,
    setCombineAspectMode,
    setCombineMode,
    setHighlightAspectModeForHighlight,
    videoAvailableForHighlights,
  };
}
