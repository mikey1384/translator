import type {
  SrtSegment,
  TranslateSubtitlesResult,
  TranslationReviewOutcome,
} from '@shared-types/app';
import { translationReviewStatus } from '../../shared/helpers/translation-review';
import { i18n } from '../i18n';

export function translationCompletionStage(
  result: TranslateSubtitlesResult
): string {
  return i18n.t(
    result.review?.status === 'incomplete'
      ? 'translationReview.incomplete'
      : 'generateSubtitles.status.completed'
  );
}

export function pendingTranslationReview(
  segments: SrtSegment[]
): { language: string; count: number } | null {
  const first = segments.find(
    segment =>
      segment.translationReview &&
      translationReviewStatus(
        segment,
        segment.translationReview.targetLanguage
      ) === 'pending'
  );
  if (!first?.translationReview) return null;
  const language = first.translationReview.targetLanguage;
  return {
    language,
    count: segments.filter(
      s => translationReviewStatus(s, language) === 'pending'
    ).length,
  };
}

export function documentTranslationReview(
  segments: SrtSegment[],
  targetLanguage: string
): TranslationReviewOutcome {
  const statuses = segments
    .map(s => translationReviewStatus(s, targetLanguage))
    .filter(Boolean);
  const completed = statuses.filter(status => status === 'complete').length;
  return {
    status: completed === statuses.length ? 'complete' : 'incomplete',
    completed,
    total: statuses.length,
  };
}
