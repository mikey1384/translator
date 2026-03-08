import { useState, useEffect, useMemo } from 'react';
import * as SystemIPC from '../../../ipc/system';
import { useVideoStore } from '../../../state/video-store';

// Max retry attempts for metadata fetching (with 5s delay cap = ~5 minutes max wait)
const MAX_METADATA_ATTEMPTS = 60;

type MetadataStatus = 'idle' | 'fetching' | 'waiting' | 'success' | 'failed';

interface MetadataState {
  durationSecs: number | null;
  status: MetadataStatus;
  code?: string;
  message?: string;
}

const initialState: MetadataState = {
  durationSecs: null,
  status: 'idle',
};

function shouldRetryForCode(code?: string): boolean {
  if (!code) return true;
  switch (code) {
    case 'icloud-placeholder':
    case 'probe-error':
    case 'ipc-error':
      return true;
    default:
      return false;
  }
}

export function useVideoMetadata(videoFilePath: string | null) {
  const [metaState, setMetaState] = useState<MetadataState>(initialState);
  const storeDurationSecs = useVideoStore(s =>
    s.metaPath === videoFilePath &&
    typeof s.meta?.duration === 'number' &&
    Number.isFinite(s.meta.duration) &&
    s.meta.duration > 0
      ? s.meta.duration
      : null
  );

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    // Reset metadata so previous file's state can't leak into the new selection
    setMetaState(() => ({ ...initialState }));

    if (!videoFilePath) {
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }

    let attempts = 0;

    const schedule = (delayMs: number, fn: () => void) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        fn();
      }, delayMs);
    };

    const fetchMetadata = async () => {
      if (cancelled) return;
      attempts += 1;

      setMetaState(prev => ({
        ...prev,
        status:
          attempts === 1
            ? 'fetching'
            : prev.status === 'waiting'
              ? 'waiting'
              : 'fetching',
      }));

      try {
        const res = await SystemIPC.getVideoMetadata(videoFilePath);
        if (cancelled) return;

        if (res.success && res.metadata?.duration) {
          setMetaState({
            durationSecs: res.metadata.duration,
            status: 'success',
          });
          return;
        }

        const code = res.code;
        const message = res.error;
        const shouldRetry =
          !cancelled &&
          attempts < MAX_METADATA_ATTEMPTS &&
          shouldRetryForCode(code);

        setMetaState({
          durationSecs: null,
          status: shouldRetry ? 'waiting' : 'failed',
          code,
          message,
        });

        if (shouldRetry) {
          const delay = Math.min(5000, attempts * 1500);
          schedule(delay, fetchMetadata);
        }
      } catch (err: any) {
        if (cancelled) return;
        const message = err?.message || String(err);
        const code = 'ipc-error';
        const shouldRetry = attempts < MAX_METADATA_ATTEMPTS;

        setMetaState({
          durationSecs: null,
          status: shouldRetry ? 'waiting' : 'failed',
          code,
          message,
        });

        if (shouldRetry) {
          const delay = Math.min(5000, attempts * 1500);
          schedule(delay, fetchMetadata);
        }
      }
    };

    fetchMetadata();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [videoFilePath]);

  const { durationSecs, status, code, message } = metaState;
  const effectiveDurationSecs = durationSecs ?? storeDurationSecs;
  const hasDuration =
    effectiveDurationSecs !== null && Number.isFinite(effectiveDurationSecs);
  const effectiveStatus: MetadataStatus = hasDuration ? 'success' : status;
  const effectiveCode = hasDuration ? undefined : code;
  const effectiveMessage = hasDuration ? undefined : message;

  const hoursNeeded = useMemo(() => {
    if (effectiveDurationSecs !== null && effectiveDurationSecs > 0) {
      const blocks = Math.max(1, Math.ceil(effectiveDurationSecs / 900));
      return blocks / 4;
    }
    return null;
  }, [effectiveDurationSecs]);

  const costStr = useMemo(() => hoursNeeded?.toFixed(2), [hoursNeeded]);

  return {
    durationSecs: effectiveDurationSecs,
    hoursNeeded,
    costStr,
    metadataStatus: effectiveStatus,
    metadataErrorCode: effectiveCode,
    metadataErrorMessage: effectiveMessage,
    isMetadataPending:
      !hasDuration && (status === 'fetching' || status === 'waiting'),
  };
}
