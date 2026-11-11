import type { SrtSegment } from '@shared-types/app';
import { fingerprintSubtitleText } from './subtitle-sidecar.js';

export function reviewFingerprint(
  segment: SrtSegment,
  targetLanguage: string
): string {
  return fingerprintSubtitleText(
    JSON.stringify([
      targetLanguage,
      segment.original,
      segment.translation ?? '',
    ])
  );
}

export function withTranslationReview(
  segment: SrtSegment,
  targetLanguage: string,
  status: 'pending' | 'complete'
): SrtSegment {
  return {
    ...segment,
    translationReview: {
      status,
      targetLanguage,
      contentFingerprint: reviewFingerprint(segment, targetLanguage),
    },
  };
}

export function translationReviewStatus(
  segment: SrtSegment,
  targetLanguage: string
): 'pending' | 'complete' | undefined {
  if (!segment.original.trim() && !segment.translation?.trim())
    return undefined;
  const review = segment.translationReview;
  if (!review || review.targetLanguage !== targetLanguage) return undefined;
  return review.status === 'complete' &&
    review.contentFingerprint === reviewFingerprint(segment, targetLanguage)
    ? 'complete'
    : 'pending';
}

export function translationReviewNeedsDecision(segment: SrtSegment): boolean {
  const review = segment.translationReview;
  return Boolean(
    review &&
    translationReviewStatus(segment, review.targetLanguage) === 'pending' &&
    review.acceptedFingerprint !==
      reviewFingerprint(segment, review.targetLanguage)
  );
}

export function acceptTranslationDraft(segment: SrtSegment): SrtSegment {
  if (!translationReviewNeedsDecision(segment) || !segment.translationReview)
    return segment;
  return {
    ...segment,
    translationReview: {
      ...segment.translationReview,
      acceptedFingerprint: reviewFingerprint(
        segment,
        segment.translationReview.targetLanguage
      ),
    },
  };
}
