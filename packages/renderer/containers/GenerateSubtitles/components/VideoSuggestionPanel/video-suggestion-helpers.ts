import type { TFunction } from 'i18next';
import { getTranslationFailureMessage } from '../../../../utils/translationFailure.js';
import type {
  VideoSuggestionMessage,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import type {
  PipelineStageKey,
  PipelineStageProgress,
  PipelineStageState,
} from './VideoSuggestionPanel.types.js';
import { isVideoSuggestionRecency } from '../../../../../shared/helpers/video-suggestion-sanitize.js';

export const NO_PRESET_VALUE = '__none__';

const PIPELINE_STAGE_KEYS: PipelineStageKey[] = [
  'strategist',
  'discovery',
  'curator',
  'retrieval',
];

export function resolveI18n(text: string, t: TFunction): string {
  if (text.startsWith('__i18n__:')) {
    const key = text.slice(9);
    return t(key, text);
  }
  return text;
}

export function resolveErrorText(
  raw: unknown,
  fallback: string,
  t: TFunction
): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return fallback;
  if (text.startsWith('__i18n__:')) {
    return t(text.slice(9), fallback);
  }
  const lowConfidenceMatch = text.match(/^low-confidence:(.+)$/i);
  if (lowConfidenceMatch) {
    const reason = String(lowConfidenceMatch[1] || '')
      .trim()
      .toLowerCase();
    if (reason === 'no-scored-results') {
      return t(
        'input.videoSuggestion.lowConfidenceNoScoredResults',
        'No reliable matches survived ranking. Try a broader topic, add a creator hint, or switch recency.'
      );
    }
    return t(
      'input.videoSuggestion.lowConfidenceGeneric',
      'Search confidence was low. Add one more detail and retry.'
    );
  }
  const mapped = getTranslationFailureMessage({
    error: text,
    cancelled: false,
  }).trim();
  return mapped || fallback;
}

export function resolveAssistantMessage(
  raw: unknown,
  fallback: string,
  t: TFunction
): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return fallback;
  const resolved = resolveI18n(text, t).trim();
  if (!resolved || resolved.startsWith('__i18n__:')) return fallback;
  return resolved;
}

export function normalizeMessagesForPlanner(
  history: VideoSuggestionMessage[],
  t: TFunction
): VideoSuggestionMessage[] {
  const normalized: VideoSuggestionMessage[] = [];
  for (const msg of history) {
    const resolved =
      msg.role === 'assistant' ? resolveI18n(msg.content, t) : msg.content;
    const text = String(resolved || '').trim();
    if (!text) continue;
    if (msg.role === 'assistant' && text.startsWith('__i18n__:')) continue;
    normalized.push({ role: msg.role, content: text });
  }
  return normalized;
}

export function isMatchingOperationId(
  activeOperationId: string | null,
  progressOperationId: unknown
): boolean {
  if (!activeOperationId) return false;
  if (typeof progressOperationId !== 'string') return false;
  return (
    progressOperationId === activeOperationId ||
    progressOperationId.startsWith(`${activeOperationId}-`)
  );
}

export function createInitialPipelineStages(): PipelineStageProgress[] {
  return PIPELINE_STAGE_KEYS.map((key, index) => ({
    key,
    index: index + 1,
    state: 'pending',
    outcome: '',
  }));
}

export function isPipelineStageKey(value: unknown): value is PipelineStageKey {
  return (
    typeof value === 'string' &&
    PIPELINE_STAGE_KEYS.includes(value as PipelineStageKey)
  );
}

export function inferStageFromMessage(
  message: string
): { key: PipelineStageKey; state: PipelineStageState } | null {
  const match = message.match(/step\s*([1-4])\s*\/\s*4/i);
  if (!match) return null;
  const idx = Number(match[1]);
  if (!Number.isFinite(idx) || idx < 1 || idx > 4) return null;
  const key = PIPELINE_STAGE_KEYS[idx - 1];
  const state = /cleared/i.test(message) ? 'cleared' : 'running';
  return { key, state };
}

export function pipelineStageLabel(
  key: PipelineStageKey,
  t: TFunction
): string {
  switch (key) {
    case 'strategist':
      return t('input.videoSuggestion.stage.strategist', 'Plan search');
    case 'discovery':
      return t('input.videoSuggestion.stage.discovery', 'Search candidates');
    case 'curator':
      return t('input.videoSuggestion.stage.curator', 'Rank matches');
    case 'retrieval':
      return t('input.videoSuggestion.stage.retrieval', 'Load results');
    default:
      return key;
  }
}

export function resolvePreferredLanguageName(
  preferredLanguage: string
): string {
  const code = preferredLanguage.toLowerCase();
  if (code.startsWith('es')) return 'Spanish';
  if (code.startsWith('fr')) return 'French';
  if (code.startsWith('de')) return 'German';
  if (code.startsWith('it')) return 'Italian';
  if (code.startsWith('pt')) return 'Portuguese';
  if (code.startsWith('ru')) return 'Russian';
  if (code.startsWith('ja')) return 'Japanese';
  if (code.startsWith('ko')) return 'Korean';
  if (code.startsWith('zh')) return 'Chinese';
  if (code.startsWith('ar')) return 'Arabic';
  if (code.startsWith('hi')) return 'Hindi';
  if (code.startsWith('id')) return 'Indonesian';
  if (code.startsWith('vi')) return 'Vietnamese';
  if (code.startsWith('tr')) return 'Turkish';
  if (code.startsWith('nl')) return 'Dutch';
  if (code.startsWith('pl')) return 'Polish';
  if (code.startsWith('sv')) return 'Swedish';
  if (code.startsWith('no')) return 'Norwegian';
  if (code.startsWith('da')) return 'Danish';
  if (code.startsWith('fi')) return 'Finnish';
  if (code.startsWith('el')) return 'Greek';
  if (code.startsWith('cs')) return 'Czech';
  if (code.startsWith('hu')) return 'Hungarian';
  if (code.startsWith('ro')) return 'Romanian';
  if (code.startsWith('uk')) return 'Ukrainian';
  if (code.startsWith('he')) return 'Hebrew';
  if (code.startsWith('fa')) return 'Farsi';
  if (code.startsWith('th')) return 'Thai';
  if (code.startsWith('ms')) return 'Malay';
  if (code.startsWith('sw')) return 'Swahili';
  if (code.startsWith('af')) return 'Afrikaans';
  if (code.startsWith('bn')) return 'Bengali';
  if (code.startsWith('ta')) return 'Tamil';
  if (code.startsWith('te')) return 'Telugu';
  if (code.startsWith('mr')) return 'Marathi';
  if (code.startsWith('tl')) return 'Tagalog';
  if (code.startsWith('ur')) return 'Urdu';
  return 'English';
}

export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function normalizeUploadedDate(value: string): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
}

export function buildVideoMetaDetails(
  item: VideoSuggestionResultItem,
  preferredLanguage: string,
  t: TFunction
): string[] {
  const details: string[] = [];

  if (
    typeof item.durationSec === 'number' &&
    Number.isFinite(item.durationSec) &&
    item.durationSec > 0
  ) {
    details.push(
      t('input.videoSuggestion.durationLabel', 'Duration {{duration}}', {
        duration: formatDurationClock(item.durationSec),
      })
    );
  }

  const uploadedDate = normalizeUploadedDate(item.uploadedAt || '');
  if (uploadedDate) {
    const formatted = new Intl.DateTimeFormat(preferredLanguage || 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(uploadedDate);
    details.push(
      t('input.videoSuggestion.uploadedOn', 'Uploaded {{date}}', {
        date: formatted,
      })
    );
  }

  return details;
}

export function isVideoSuggestionRecencyValue(
  value: unknown
): value is VideoSuggestionRecency {
  return isVideoSuggestionRecency(value);
}

function compactSuggestionText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSuggestionKey(value: string): string {
  return compactSuggestionText(value)
    .replace(/[“”"]/g, '')
    .replace(/[.!?]+$/g, '')
    .toLowerCase();
}

function pushUniqueSuggestion(
  target: string[],
  seen: Set<string>,
  value: string
): void {
  const text = compactSuggestionText(value);
  if (!text) return;
  const key = normalizeSuggestionKey(text);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(text);
}

export function buildSuggestedFollowUpPrompts(
  searchQuery: string,
  savedPreferences: VideoSuggestionPreferenceSlots,
  results: VideoSuggestionResultItem[],
  t: TFunction
): string[] {
  const normalizedQuery = compactSuggestionText(searchQuery);
  const topic = compactSuggestionText(savedPreferences.topic);
  const creator = compactSuggestionText(savedPreferences.creator);
  const subtopic = compactSuggestionText(savedPreferences.subtopic);
  const topChannel = compactSuggestionText(results[0]?.channel);
  const prompts: string[] = [];
  const seen = new Set<string>();

  if (normalizedQuery) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.moreLikeQuery',
        'Find more videos like "{{query}}"',
        { query: normalizedQuery }
      )
    );
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.differentCreator',
        '"{{query}}" from a different creator or channel',
        { query: normalizedQuery }
      )
    );

    if (!/\b(interview|interviews|podcast|podcasts|conversation|conversations|talk show|talks)\b/i.test(normalizedQuery)) {
      pushUniqueSuggestion(
        prompts,
        seen,
        t(
          'input.videoSuggestion.followUp.interviews',
          '{{query}} interviews or conversations',
          { query: normalizedQuery }
        )
      );
    }

    if (!/\b(live|performance|performances|concert|concerts|clip|clips|highlights)\b/i.test(normalizedQuery)) {
      pushUniqueSuggestion(
        prompts,
        seen,
        t(
          'input.videoSuggestion.followUp.clips',
          '{{query}} highlights or standout clips',
          { query: normalizedQuery }
        )
      );
    }
  }

  if (creator) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.creatorAppearances',
        '{{creator}} interviews, TV appearances, or live clips',
        { creator }
      )
    );
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.similarCreators',
        'Creators or artists similar to {{creator}}',
        { creator }
      )
    );
  }

  if (topic) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.topicAngle',
        '{{topic}} explained from a different angle',
        { topic }
      )
    );
  }

  if (topic && subtopic) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.topicSubtopic',
        'More {{subtopic}} videos about {{topic}}',
        { subtopic, topic }
      )
    );
  }

  if (topic && creator) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.topicCreator',
        '{{creator}} and related {{topic}} videos',
        { creator, topic }
      )
    );
  }

  if (topChannel) {
    pushUniqueSuggestion(
      prompts,
      seen,
      t(
        'input.videoSuggestion.followUp.channelStyle',
        'Videos with a similar feel to {{channel}}',
        { channel: topChannel }
      )
    );
  }

  return prompts.slice(0, 4);
}
