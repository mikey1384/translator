import { SrtSegment } from '@shared-types/app';
import log from 'electron-log';

export function sig({
  stage,
  segs,
  operationId,
}: {
  stage: string;
  segs: SrtSegment[];
  operationId: string;
}) {
  if (segs.length === 0) return; // nothing to log
  const tail = segs.at(-1)?.original ?? '';
  const sig = tail.split(/\s+/).slice(-4).join(' ');
  log.info(`[${operationId}] [sig] ${stage} → “…${sig}”`);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}
