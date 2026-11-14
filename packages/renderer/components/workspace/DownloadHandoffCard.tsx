import { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Trans, useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import Button from '../Button';
import HomeLanguagePicker from '../home/HomeLanguagePicker';
import {
  useDownloadHandoff,
  useDownloadHandoffShowing,
  useWorkspaceLanguage,
} from './WorkspaceActions';
import {
  useCreditStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
import { mapUiLanguageToTargetLanguage } from '../../state/ui-store';
import { useDownloadHandoffStore } from '../../state/download-handoff-store';
import {
  quickPickTargetLanguages,
  readRecentTargetLanguages,
  rememberRecentTargetLanguage,
} from '../../constants/translation-language-native-names';
import { currentVideoCost } from '../../utils/freePreviewRun';
import { resolveCreditBalanceState } from '../../utils/creditBalanceState';
import {
  describeHandoffCost,
  handoffPrimaryLabel,
  savedFolderName,
} from '../../utils/downloadHandoff';
import { formatCostInMinutes } from '../../utils/formatCostInMinutes';
import { formatDurationSeconds } from '../../utils/formatUnits';
import { formatUsd } from '../../utils/formatUsd';
import * as SystemIPC from '../../ipc/system';
import { logButton } from '../../utils/logger';
import { colors, fonts } from '../../styles';

const card = css`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 18px;
  background: ${colors.surface};
  border: 1px solid ${colors.borderStrong};
  animation: handoffRise 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;

  @keyframes handoffRise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const doneRow = css`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 0.85rem;
  color: ${colors.textDim};
`;

const doneMark = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${colors.success};
  font-weight: 600;
`;

const savedLine = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const textCol = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const title = css`
  margin: 0;
  font-family: ${fonts.display};
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: ${colors.text};
`;

const titleLanguage = css`
  color: ${colors.primary};
`;

const body = css`
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
  color: ${colors.textDim};
`;

const languageRow = css`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.85rem;
  color: ${colors.textDim};
`;

const actions = css`
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const isMac =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent || '');

function track(
  event:
    | 'download_handoff_shown'
    | 'download_handoff_clicked'
    | 'download_handoff_dismissed'
) {
  void SystemIPC.trackHandoffEvent(event).catch(() => {});
}

/**
 * Right after a link download: say it finished, and offer the one thing
 * worth doing next — watch it with subtitles — through the same run the
 * workspace's own "Translate to …" button starts. The cost line uses the
 * same figures as the free-preview offer, so nothing surprises later.
 */
export default function DownloadHandoffCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const showing = useDownloadHandoffShowing();
  const handoff = useDownloadHandoff();
  const language = useWorkspaceLanguage();
  const videoPath = useVideoStore(s => s.path);
  const duration = useVideoStore(s => s.meta?.duration ?? null);
  const credits = useCreditStore(s => s.credits);
  const creditsLoading = useCreditStore(s => s.loading);
  const monthlyFree = useCreditStore(s => s.monthlyFree);
  const history = useCreditStore(s => s.history);
  const offline = useCreditStore(s => s.offline);
  // Re-render when these change: the cost line depends on them.
  useCreditStore(s => s.authoritative);
  useUIStore(s => s.qualityTranslation);
  const runStarted = useTaskStore(
    s => !!s.transcription.inProgress || !!s.translation.inProgress
  );
  const [recentLanguages, setRecentLanguages] = useState(
    readRecentTargetLanguages
  );

  // Once any run starts for this video the moment has passed; a cancelled
  // run does not bring the "download finished" card back.
  const handoffKey = handoff?.status === 'ready' ? handoff.key : null;
  useEffect(() => {
    if (handoffKey && runStarted) {
      useDownloadHandoffStore.getState().consume(handoffKey);
    }
  }, [handoffKey, runStarted]);

  const cost = describeHandoffCost(
    currentVideoCost(duration),
    resolveCreditBalanceState({
      credits,
      loading: creditsLoading,
      monthlyFree,
      history,
      offline,
    })
  );

  // Counted once per download, after the length is known so the cost the
  // user saw is the one recorded.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!showing || !handoffKey || duration == null) return;
    if (shownFor.current === handoffKey) return;
    shownFor.current = handoffKey;
    track('download_handoff_shown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, handoffKey, duration]);

  const quickPicks = useMemo(
    () =>
      quickPickTargetLanguages({
        current: language.value,
        uiLanguageTarget: mapUiLanguageToTargetLanguage(locale),
        recent: recentLanguages,
      }),
    [language.value, locale, recentLanguages]
  );

  if (!showing || !handoff || !videoPath) return null;

  const price =
    cost.kind === 'preview' || cost.kind === 'offer'
      ? formatUsd(cost.price, locale)
      : '';
  const videoLength =
    duration != null ? formatDurationSeconds(duration, locale) : '';
  const balance = formatCostInMinutes(credits ?? 0, {
    kind: 'balance',
    locale,
  });
  const names = { language: language.name, languageInto: language.into };

  let detail: string | null = null;
  if (cost.kind === 'covered' && videoLength) {
    detail = cost.free
      ? t(
          'downloadHandoff.coveredFree',
          'Free: this {{duration}} video fits in your free minutes ({{balance}} left).',
          { duration: videoLength, balance }
        )
      : t(
          'downloadHandoff.covered',
          'This {{duration}} video fits in your minutes ({{balance}} left).',
          { duration: videoLength, balance }
        );
  } else if (cost.kind === 'preview') {
    detail = cost.free
      ? t(
          'downloadHandoff.previewFree',
          'Your free minutes cover the first {{minutes}} min. Subtitles for the whole video: {{price}}.',
          { minutes: cost.previewMinutes, price }
        )
      : t(
          'downloadHandoff.preview',
          'Your minutes cover the first {{minutes}} min. Subtitles for the whole video: {{price}}.',
          { minutes: cost.previewMinutes, price }
        );
  } else if (cost.kind === 'offer') {
    detail = cost.welcomePending
      ? t(
          'credits.welcomePendingNote',
          'Your free minutes are on the way. They usually arrive the next time you open Translator.'
        )
      : t(
          'downloadHandoff.offer',
          'Your minutes don’t cover this {{duration}} video. Subtitles for the whole video: {{price}}.',
          { duration: videoLength, price }
        );
  }

  // Under 45 s of balance nothing runs: the click shows the existing
  // purchase offer, so the button names the price, never a free promise.
  const labelKind = handoffPrimaryLabel(cost);
  const primaryLabel =
    labelKind === 'buy'
      ? t('freePreview.noneCta', 'Translate to {{language}} · {{price}}', {
          ...names,
          price,
        })
      : labelKind === 'firstMinutesFree' && cost.kind === 'preview'
        ? t(
            'downloadHandoff.ctaPreviewFree',
            'Watch the first {{minutes}} min free',
            { minutes: cost.previewMinutes }
          )
        : labelKind === 'firstMinutes' && cost.kind === 'preview'
          ? t(
              'downloadHandoff.ctaPreview',
              'Watch the first {{minutes}} min with subtitles',
              { minutes: cost.previewMinutes }
            )
          : t(
              'downloadHandoff.cta',
              'Watch with {{language}} subtitles',
              names
            );

  const watch = () => {
    logButton('download_handoff_watch', { cost: cost.kind });
    track('download_handoff_clicked');
    useUIStore.getState().setTargetLanguage(language.value);
    useUIStore.getState().requestHomeRun({
      kind: 'mounted',
      path: videoPath,
      trigger: 'download_handoff',
    });
  };
  const notNow = () => {
    logButton('download_handoff_not_now');
    track('download_handoff_dismissed');
    useDownloadHandoffStore.getState().dismiss(handoff.key);
  };
  const chooseLanguage = (value: string) => {
    logButton('download_handoff_language');
    useUIStore.getState().chooseTargetLanguage(value);
    rememberRecentTargetLanguage(value);
    setRecentLanguages(readRecentTargetLanguages());
  };
  const savedPath = handoff.savedPath;

  return (
    <div
      className={card}
      role="region"
      aria-label={t('progress.legacy.downloadComplete', 'Download complete')}
      data-testid="download-handoff"
    >
      <div className={doneRow} role="status">
        <span className={doneMark}>
          <Check size={15} aria-hidden="true" />
          {t('progress.legacy.downloadComplete', 'Download complete')}
        </span>
        {savedPath ? (
          <span className={savedLine}>
            <span aria-hidden="true">·</span>
            <span title={savedPath}>
              {t('downloadHandoff.savedTo', 'Saved to {{folder}}', {
                folder: savedFolderName(savedPath),
              })}
            </span>
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                logButton('download_handoff_show_in_folder');
                window.appShell.showItemInFolder(savedPath);
              }}
            >
              {isMac
                ? t('export.showInFinder', 'Show in Finder')
                : t('export.showInFolder', 'Show in folder')}
            </Button>
          </span>
        ) : null}
      </div>
      <div className={textCol}>
        <p className={title}>
          <Trans
            i18nKey="downloadHandoff.title"
            defaults="Watch it with <lang>{{language}}</lang> subtitles"
            values={names}
            components={{ lang: <span className={titleLanguage} /> }}
          />
        </p>
        {detail ? <p className={body}>{detail}</p> : null}
      </div>
      <div className={languageRow}>
        <span>{t('home.into', 'Into')}</span>
        <HomeLanguagePicker
          value={language.value}
          quickPicks={quickPicks}
          onChange={chooseLanguage}
        />
      </div>
      <div className={actions}>
        <Button variant="primary" size="lg" onClick={watch}>
          {primaryLabel}
        </Button>
        <Button variant="secondary" size="lg" onClick={notNow}>
          {t('freePreview.notNow', 'Not now')}
        </Button>
      </div>
    </div>
  );
}
