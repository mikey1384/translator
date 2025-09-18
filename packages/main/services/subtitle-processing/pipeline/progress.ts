export enum Stage {
  START = 0,
  TRANSCRIBE = 10,
  TRANSLATE = 50,
  REVIEW = 95,
  FINAL = 98,
  END = 100,
}

export function scaleProgress(
  localPct: number,
  stageFrom: Stage,
  stageTo: Stage
): number {
  const span = stageTo - stageFrom;
  return Math.round(stageFrom + (localPct / 100) * span);
}
