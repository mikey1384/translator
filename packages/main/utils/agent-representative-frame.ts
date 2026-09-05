import { createHash } from 'node:crypto';

export function representativeFrameArgs({
  videoPath,
  outputPath,
  positionSeconds,
  subtitleFilter,
}: {
  videoPath: string;
  outputPath: string;
  positionSeconds: number;
  subtitleFilter?: string | null;
}): string[] {
  const position = Math.max(0, Number(positionSeconds) || 0);
  // Input seeking resets frame PTS. Restore the source clock for timed cues,
  // then reset it again for the single-frame output.
  const filter = subtitleFilter
    ? `setpts=PTS+${position}/TB,${subtitleFilter},setpts=PTS-STARTPTS`
    : null;
  return [
    '-y',
    '-ss',
    String(position),
    '-i',
    videoPath,
    ...(filter ? ['-vf', filter] : []),
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath,
  ];
}

export function representativeFrameRevision(input: {
  sourceSnapshot: string;
  positionsSeconds: number[];
  srtContent: string;
  subtitleStyle: string;
  subtitleFontSize: number;
  subtitleFontSha256?: string;
}): string {
  // Version the renderer as well as its inputs so old, incorrect previews
  // cannot satisfy a new request through a durable output receipt.
  return createHash('sha256')
    .update(JSON.stringify({ rendererVersion: 2, ...input }))
    .digest('hex');
}

export function representativeFrameScriptResolution(
  width: number,
  height: number
): string {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Subtitle previews require valid video dimensions.');
  }
  // SRT otherwise uses libass's default script canvas, enlarging pixel fonts.
  return `PlayResX=${Math.round(width)},PlayResY=${Math.round(height)}`;
}
