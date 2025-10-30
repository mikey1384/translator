import type { TFunction } from 'i18next';
import type { LearningEntry } from '@shared-types/app';

export const formatTimestamp = (value: string, locale: string) => {
  try {
    return new Date(value).toLocaleString(locale, {
      hour12: false,
    });
  } catch {
    return value;
  }
};

export const friendlySource = (
  source: LearningEntry['sourceType'],
  t: TFunction
) => {
  switch (source) {
    case 'downloaded':
      return t('learningHub.source.downloaded', 'Downloaded video');
    case 'opened':
      return t('learningHub.source.opened', 'Opened from device');
    default:
      return t('learningHub.source.unknown', 'Source unknown');
  }
};

export const normalizeDir = (dir: string | null) => {
  if (!dir) return null;
  return dir;
};

export const formatTimestampForSegment = (value: number) => {
  if (!Number.isFinite(value)) return '--:--';
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (v: number) => v.toString().padStart(2, '0');
  const base = `${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${base}` : base;
};
