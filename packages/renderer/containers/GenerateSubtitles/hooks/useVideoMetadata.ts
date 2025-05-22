import { useState, useEffect, useMemo } from 'react';
import * as SystemIPC from '../../../ipc/system';

export function useVideoMetadata(videoFilePath: string | null) {
  const [durationSecs, setDurationSecs] = useState<number | null>(null);

  const hoursNeeded = useMemo(() => {
    if (durationSecs !== null && durationSecs > 0) {
      // Minimum 15 min (1 block), then round UP to nearest 15 min (0.25 hour) block
      const blocks = Math.max(1, Math.ceil(durationSecs / 900));
      return blocks / 4; // each block is 0.25 hours
    }
    return null;
  }, [durationSecs]);

  const costStr = useMemo(() => hoursNeeded?.toFixed(2), [hoursNeeded]);

  useEffect(() => {
    if (videoFilePath) {
      SystemIPC.getVideoMetadata(videoFilePath).then(
        (res: import('@shared-types/app').VideoMetadataResult) => {
          if (res.success && res.metadata?.duration) {
            setDurationSecs(res.metadata.duration);
          } else {
            setDurationSecs(null);
          }
        }
      );
    } else {
      setDurationSecs(null);
    }
  }, [videoFilePath]);

  return {
    durationSecs,
    hoursNeeded,
    costStr,
  };
}
