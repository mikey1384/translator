import { useState, useEffect, useRef, useCallback } from 'react';
import { SrtSegment } from '@shared-types/app';
import { parseSrt } from '../../../../shared/helpers/index.js';
import * as SubtitlesIPC from '@ipc/subtitles';

type ProgressMsg = {
  partialResult?: string;
  percent?: number;
  stage?: string;
  current?: number;
  total?: number;
  batchStartIndex?: number;
  operationId?: string;
};

export function useSubtitleState() {
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

  const handlePartialResultRef = useRef<null | ((p: ProgressMsg) => void)>(
    null
  );

  const handlePartialResult = useCallback((result: ProgressMsg = {}) => {
    const {
      partialResult = '',
      percent = 0,
      stage = 'Processing',
      batchStartIndex,
      operationId,
    } = result;

    if (batchStartIndex !== undefined)
      setReviewedBatchStartIndex(batchStartIndex);

    if (partialResult.trim()) {
      setIsReceivingPartialResults(true);
      const parsed = parseSrt(partialResult);
      setSubtitleSegments(parsed);
    }
    setTranslationProgress(percent);
    setTranslationStage(stage);
    if (operationId) setTranslationOperationId(operationId);

    setIsTranslationInProgress(percent < 100);
    if (percent >= 100) {
      setIsReceivingPartialResults(false);
      setReviewedBatchStartIndex(null);
    }
  }, []);

  useEffect(() => {
    handlePartialResultRef.current = handlePartialResult;
  }, [handlePartialResult]);

  useEffect(() => {
    let cleanupGenerate: (() => void) | null = null;
    let cleanupTranslate: (() => void) | null = null;

    cleanupGenerate = SubtitlesIPC.onGenerateProgress(handleProgressUpdate);
    cleanupTranslate = SubtitlesIPC.onTranslateProgress(handleProgressUpdate);

    return () => {
      cleanupGenerate?.();
      cleanupTranslate?.();
    };

    function handleProgressUpdate(progress: ProgressMsg) {
      if (handlePartialResultRef?.current) {
        handlePartialResultRef?.current(progress || {});
      }
    }
  }, []);

  return {
    setSubtitleSegments,
    setSubtitleSourceId,
    subtitleSegments,
    isTranslationInProgress,
    translationProgress,
    translationStage,
    setIsTranslationInProgress,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    subtitleSourceId,
    translationOperationId,
    reset: () => {
      setSubtitleSegments([]);
      setIsTranslationInProgress(false);
      setTranslationProgress(0);
      setTranslationStage('');
      setIsReceivingPartialResults(false);
      setReviewedBatchStartIndex(null);
      setTranslationOperationId(null);
    },
  };
}
