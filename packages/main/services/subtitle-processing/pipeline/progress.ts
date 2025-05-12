export enum Stage {
  AUDIO = 0,
  TRANSCRIBE = 10,
  TRANSLATE = 50,
  REVIEW = 75,
  FINAL = 95,
}

export function scaleProgress(
  localPct: number,
  stageFrom: Stage,
  stageTo: Stage
): number {
  const span = stageTo - stageFrom;
  return Math.round(stageFrom + (localPct / 100) * span);
}
