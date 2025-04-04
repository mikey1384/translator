import { useState, useEffect, useCallback, useRef } from 'react';
import { SrtSegment } from '../../../types/interface';
import { parseSrt, fixOverlappingSegments } from '../../helpers';

export function useSubtitleManagement(showOriginalText: boolean) {
  const [subtitleSegments, setSubtitleSegments] = useState<SrtSegment[]>([]);
  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStage, setTranslationStage] = useState('');
  const [isReceivingPartialResults, setIsReceivingPartialResults] =
    useState<boolean>(false);
  const [reviewedBatchStartIndex, setReviewedBatchStartIndex] = useState<
    number | null
  >(null);
  const [subtitleSourceId, setSubtitleSourceId] = useState(0);
  const [translationOperationId, setTranslationOperationId] = useState<
    string | null
  >(null);

  const handlePartialResultRef = useRef<any>(null);

  const handleSetSubtitleSegments = useCallback(
    (segments: SrtSegment[] | ((prevState: SrtSegment[]) => SrtSegment[])) => {
      setSubtitleSegments(segments);
      setSubtitleSourceId(prevId => prevId + 1);
      console.info(
        `[useSubtitleManagement] Segments set externally, incremented source ID.`
      );
    },
    []
  );

  const handlePartialResult = useCallback(
    (result: {
      partialResult?: string;
      percent?: number;
      stage?: string;
      current?: number;
      total?: number;
      batchStartIndex?: number;
      operationId?: string;
    }) => {
      try {
        const safeResult = {
          partialResult: result?.partialResult || '',
          percent: result?.percent || 0,
          stage: result?.stage || 'Processing',
          current: result?.current || 0,
          total: result?.total || 100,
          batchStartIndex: result?.batchStartIndex,
          operationId: result?.operationId,
        };

        if (safeResult.batchStartIndex !== undefined) {
          setReviewedBatchStartIndex(safeResult.batchStartIndex);
        }

        if (
          safeResult.partialResult &&
          safeResult.partialResult.trim().length > 0
        ) {
          setIsReceivingPartialResults(true);
          const parsedSegments = parseSrt(safeResult.partialResult);
          const processedSegments = parsedSegments.map((segment: any) => {
            let processedText = segment.text;
            if (segment.text.includes('###TRANSLATION_MARKER###')) {
              if (showOriginalText) {
                processedText = segment.text.replace(
                  '###TRANSLATION_MARKER###',
                  '\n'
                );
              } else {
                const parts = segment.text.split('###TRANSLATION_MARKER###');
                processedText = parts[1] ? parts[1].trim() : '';
              }
            }
            return {
              ...segment,
              text: processedText,
            };
          });

          setSubtitleSegments(processedSegments);
        }

        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);
        if (safeResult.percent < 100) {
          setIsTranslationInProgress(true);
        }

        // Track the operation ID for cancellation
        if (safeResult.operationId) {
          setTranslationOperationId(safeResult.operationId);
        }
      } catch (error) {
        console.error(
          '[useSubtitleManagement] Error handling partial result:',
          error
        );
      }
    },
    [
      showOriginalText,
      setSubtitleSegments,
      setIsTranslationInProgress,
      setTranslationProgress,
      setTranslationStage,
      setIsReceivingPartialResults,
      setReviewedBatchStartIndex,
      setTranslationOperationId,
    ]
  );

  // Effect to keep the ref updated with the latest callback
  useEffect(() => {
    handlePartialResultRef.current = handlePartialResult;
  }, [handlePartialResult]);

  // Effect to set up IPC listeners - runs only once
  useEffect(() => {
    const handleProgressUpdate = (progress: any) => {
      if (handlePartialResultRef.current) {
        handlePartialResultRef.current(progress || {});
      }
    };

    let cleanupGenerate: (() => void) | null = null;
    let cleanupTranslate: (() => void) | null = null;

    if (window.electron) {
      if (typeof window.electron.onGenerateSubtitlesProgress === 'function') {
        const cleanup =
          window.electron.onGenerateSubtitlesProgress(handleProgressUpdate);
        if (typeof cleanup === 'function') {
          cleanupGenerate = cleanup;
        }
      }
      if (typeof window.electron.onTranslateSubtitlesProgress === 'function') {
        const cleanup =
          window.electron.onTranslateSubtitlesProgress(handleProgressUpdate);
        if (typeof cleanup === 'function') {
          cleanupTranslate = cleanup;
        }
      }
    }

    return () => {
      cleanupGenerate?.();
      cleanupTranslate?.();
    };
  }, []); // Empty dependency array - runs only once

  const handleSubtitlesGenerated = useCallback((generatedSubtitles: string) => {
    try {
      const segments = parseSrt(generatedSubtitles);
      const fixedSegments = fixOverlappingSegments(segments);
      setSubtitleSegments(fixedSegments);
    } catch (err) {
      console.error(
        '[useSubtitleManagement] Error parsing generated subtitles:',
        err
      );
    }
  }, []);

  const resetSubtitleSource = useCallback(() => {
    setSubtitleSegments([]);
    setSubtitleSourceId(prevId => prevId + 1);
    console.info(
      `[useSubtitleManagement] Subtitle source reset explicitly, incremented source ID.`
    );
  }, []);

  return {
    subtitleSegments,
    handleSetSubtitleSegments,
    isTranslationInProgress,
    translationProgress,
    translationStage,
    setIsTranslationInProgress,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    subtitleSourceId,
    handleSubtitlesGenerated,
    resetSubtitleSource,
    translationOperationId,
  };
}
