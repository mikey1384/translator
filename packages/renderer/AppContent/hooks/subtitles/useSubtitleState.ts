import { useState, useEffect, useRef, useCallback } from 'react';
import { parseSrt } from '../../../../shared/helpers/index.js';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useSubStore } from '../../../state/subtitle-store';

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
  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStage, setTranslationStage] = useState('');
  const [isReceivingPartialResults, setIsReceivingPartialResults] =
    useState<boolean>(false);
  const [reviewedBatchStartIndex, setReviewedBatchStartIndex] = useState<
    number | null
  >(null);
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
      useSubStore.getState().load(parsed);
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

    cleanupGenerate = SubtitlesIPC.onGenerateProgress(handleProgressUpdate);

    return () => {
      cleanupGenerate?.();
    };

    function handleProgressUpdate(progress: ProgressMsg) {
      if (handlePartialResultRef?.current) {
        handlePartialResultRef?.current(progress || {});
      }
    }
  }, []);

  return {
    isTranslationInProgress,
    translationProgress,
    translationStage,
    setIsTranslationInProgress,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    translationOperationId,
    reset: () => {
      useSubStore.getState().load([]);
      setIsTranslationInProgress(false);
      setTranslationProgress(0);
      setTranslationStage('');
      setIsReceivingPartialResults(false);
      setReviewedBatchStartIndex(null);
      setTranslationOperationId(null);
    },
  };
}
