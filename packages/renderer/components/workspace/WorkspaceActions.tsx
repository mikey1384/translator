import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { TFunction } from 'i18next';
import { css } from '@emotion/css';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  intoLanguageName,
  sentenceLanguageName,
} from '../../utils/languageName';
import {
  AudioLines,
  Download,
  FileText,
  FileUp,
  Film,
  FolderOpen,
  Languages,
  LayoutGrid,
  MoreHorizontal,
  Palette,
  Scissors,
  Video,
} from 'lucide-react';
import Button from '../Button';
import Modal from '../Modal';
import {
  useActiveFreePreview,
  useFreePreviewOfferShowing,
} from './FreePreviewOffer';
import { chooseWorkspacePrimary } from './workspace-primary';
import { detectTextLanguage } from '../../utils/detectTextLanguage';
import {
  formatClockTime,
  transcriptStopsEarlyAt,
} from '../../utils/transcriptCoverage';
import { translateMissingUntranslated } from '../../utils/translateMissing';
import { currentVideoCost } from '../../utils/freePreviewRun';
import { persistMountedTranslation } from '../../containers/GenerateSubtitles/utils/subtitleGeneration';
import { formatUsd } from '../../utils/formatUsd';
import {
  isManagedTempOriginalVideoPath,
  saveOriginalVideoFile,
} from '../../utils/saveVideo';
import {
  installInterruptedJobTracking,
  useInterruptedJobsStore,
} from '../../state/interrupted-jobs';
import { freePreviewKey } from '../../state/free-preview-store';
import { mountSubtitleDocument } from '../../utils/subtitle-library';
import UnreadableFileNotice, {
  CheckingFileNotice,
  useMountedFileChecking,
  useMountedFileUnreadable,
} from './UnreadableFileNotice';
import SaveAndMergeBar from '../../containers/EditSubtitles/SaveAndMergeBar';
import {
  SubtitleDisplaySwitch,
  SubtitleSizeStepper,
} from '../SubtitleViewControls';
import SubtitleStylePicker, {
  subtitleStyleLabel,
} from '../../containers/EditSubtitles/SubtitleStylePicker';
import {
  useCreditStore,
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
import { mapUiLanguageToTargetLanguage } from '../../state/ui-store';
import { useUrlStore } from '../../state/url-store';
import { useWorkspaceActions } from '../../state/workspace-actions';
import { openChangeVideo } from '../../state/modal-store';
import type { WorkspaceToolsFocus } from '../../state/ui-store';
import { logButton } from '../../utils/logger';
import { colors } from '../../styles';
import {
  actionBarStyles,
  actionPrimaryStyles,
  exportSheetBodyStyles,
  idleDotStyles,
  watchControlsStyles,
  styleButtonStyles,
  stylePopoverStyles,
  idleStatusStyles,
  moreMenuAnchorStyles,
  moreMenuDividerStyles,
  moreMenuItemStyles,
  moreMenuStyles,
} from './workspace-styles';

installInterruptedJobTracking();

type LanguageLabel = { value: string; name: string; into: string };

function describeLanguage(
  value: string,
  t: TFunction,
  uiLanguage: string
): LanguageLabel {
  const name = sentenceLanguageName(
    t(`languages.${value}`, { defaultValue: value }),
    uiLanguage
  );
  return { value, name, into: intoLanguageName(value, name, uiLanguage) };
}

export function useWorkspaceLanguage(): LanguageLabel {
  const { t, i18n } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const value =
    targetLanguage && targetLanguage !== 'original'
      ? targetLanguage
      : mapUiLanguageToTargetLanguage(i18n.language);
  return describeLanguage(value, t, i18n.language);
}

export function useWorkspaceBusy(): boolean {
  const download = useUrlStore(s => s.download.inProgress);
  const transcription = useTaskStore(s => !!s.transcription.inProgress);
  const translation = useTaskStore(s => !!s.translation.inProgress);
  const dubbing = useTaskStore(s => !!s.dubbing.inProgress);
  const merge = useTaskStore(s => !!s.merge.inProgress);
  return download || transcription || translation || dubbing || merge;
}

/**
 * What the mounted subtitles hold, and which languages they are actually
 * written in (detected from the text; the recorded target language is only a
 * fallback, since an imported file may be in anything).
 */
function useSubtitleSummary() {
  const order = useSubStore(s => s.order);
  const segments = useSubStore(s => s.segments);
  const recordedLanguage = useSubStore(s => s.targetLanguage);
  return useMemo(() => {
    let translated = 0;
    let missing = 0;
    const originals: string[] = [];
    const translations: string[] = [];
    for (const id of order) {
      const seg = segments[id];
      const original = seg?.original?.trim() ?? '';
      const translation = seg?.translation?.trim() ?? '';
      if (original) originals.push(original);
      if (translation) {
        translated += 1;
        translations.push(translation);
      } else if (original) {
        missing += 1;
      }
    }
    const recorded =
      recordedLanguage && recordedLanguage !== 'original'
        ? recordedLanguage
        : null;
    const lastId = order[order.length - 1];
    return {
      count: order.length,
      translated,
      missing,
      lastEnd: lastId ? (segments[lastId]?.end ?? null) : null,
      sourceLanguage: detectTextLanguage(originals),
      translationLanguage:
        translated > 0 ? (detectTextLanguage(translations) ?? recorded) : null,
    };
  }, [order, segments, recordedLanguage]);
}

/** Translate the lines that have none yet, then save like a normal run. */
async function translateMissingLines(language: string): Promise<void> {
  useUIStore.getState().setTargetLanguage(language);
  const ok = await translateMissingUntranslated();
  if (ok) await persistMountedTranslation(language);
}

function useCurrentSourceKey(): string | null {
  return useVideoStore(s =>
    freePreviewKey({
      originalPath: s.originalPath,
      path: s.path,
      sourceUrl: s.sourceUrl,
    })
  );
}

/** The calm line under the video when nothing is running. */
export function WorkspaceIdleStatus() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const target = useWorkspaceLanguage();
  const summary = useSubtitleSummary();
  const { count, translated, missing } = summary;
  const videoPath = useVideoStore(s => s.path);
  const duration = useVideoStore(s => s.meta?.duration ?? null);
  const editor = useWorkspaceActions(s => s.editor);
  const preview = useActiveFreePreview();
  const unreadable = useMountedFileUnreadable();
  const checking = useMountedFileChecking();
  const transcribed = useSubStore(s => Boolean(s.transcriptionEngine));
  // Lines from an .srt the user opened were loaded, not transcribed here.
  const loadedFromFile = useSubStore(s => s.origin === 'disk');
  // Re-render when the balance changes: the ready line names the price.
  useCreditStore(s => s.credits);
  useCreditStore(s => s.authoritative);

  const named = (value: string | null) =>
    value ? describeLanguage(value, t, i18n.language) : null;
  const sourceLanguage = named(summary.sourceLanguage);
  const translationLanguage = named(summary.translationLanguage);
  const alreadyInTarget =
    translated === 0 && summary.sourceLanguage === target.value;

  // "In sync with the video" only once there is a video to be in sync with.
  const linesIn = (
    lines: number,
    language: { name: string; into: string }
  ): string =>
    t(
      videoPath ? 'workspace.statusTranslated' : 'workspace.statusLinesIn',
      videoPath
        ? '{{count}} lines in {{language}} · in sync with the video'
        : '{{count}} lines in {{language}}',
      { count: lines, language: language.name, languageInto: language.into }
    );

  // While an offer stands for an empty video, it says what happens next.
  if (count === 0 && preview) return <InterruptedJobNotice />;
  // Nothing can run on a file that cannot be read; say so instead of "Ready".
  if (count === 0 && unreadable) return <UnreadableFileNotice />;
  if (count === 0 && checking) return <CheckingFileNotice />;

  let done = false;
  let text: string;
  if (count === 0) {
    const cost = currentVideoCost(duration);
    text =
      cost?.kind === 'offer'
        ? t(
            'workspace.statusReadyPrice',
            'Ready — {{language}} subtitles for this video: {{price}}',
            {
              language: target.name,
              languageInto: target.into,
              price: formatUsd(cost.wholeVideoPrice, locale),
            }
          )
        : cost?.kind === 'preview'
          ? t(
              'workspace.statusReadyPreview',
              'Ready — your minutes cover the first {{minutes}} min in {{language}}',
              {
                minutes: cost.previewMinutes,
                count: cost.previewMinutes,
                language: target.name,
                languageInto: target.into,
              }
            )
          : t(
              'workspace.statusReady',
              'Ready — {{language}} subtitles are one click away',
              { language: target.name, languageInto: target.into }
            );
  } else if (alreadyInTarget && sourceLanguage) {
    done = true;
    text = linesIn(count, sourceLanguage);
  } else if (translated === 0 && sourceLanguage) {
    // Name the language the lines are in; they may come from a loaded file.
    text = linesIn(count, sourceLanguage);
  } else if (translated === 0) {
    text = loadedFromFile
      ? t('workspace.statusLoaded', '{{count}} lines loaded', { count })
      : transcribed
        ? t('workspace.statusTranscribed', '{{count}} lines transcribed', {
            count,
          })
        : t('workspace.statusLines', '{{count}} subtitle lines', {
            defaultValue_one: '{{count}} subtitle line',
            count,
          });
  } else if (missing > 0) {
    text = translationLanguage
      ? t(
          'workspace.statusPartlyTranslated',
          '{{translated}} of {{count}} lines in {{language}} · {{missing}} not translated',
          {
            translated,
            count: translated + missing,
            missing,
            language: translationLanguage.name,
            languageInto: translationLanguage.into,
          }
        )
      : t(
          'workspace.statusPartlyTranslatedUnknown',
          '{{translated}} of {{count}} lines translated · {{missing}} not translated',
          { translated, count: translated + missing, missing }
        );
  } else {
    done = true;
    text = translationLanguage
      ? linesIn(translated, translationLanguage)
      : videoPath
        ? t(
            'workspace.statusTranslatedUnknown',
            '{{count}} translated lines · in sync with the video',
            { count: translated }
          )
        : t(
            'workspace.statusTranslatedUnknownNoVideo',
            '{{count}} translated lines',
            {
              count: translated,
            }
          );
  }

  const stopsAt =
    videoPath && editor && count > 0
      ? transcriptStopsEarlyAt({
          durationSecs: duration,
          lastEndSecs: summary.lastEnd,
        })
      : null;

  return (
    <>
      <InterruptedJobNotice />
      <div className={idleStatusStyles}>
        <span
          className={idleDotStyles(done ? colors.success : colors.gray)}
          aria-hidden="true"
        />
        <span role="status">{text}</span>
        {stopsAt !== null && editor ? (
          <span className={stopsEarlyStyles}>
            <span>
              {t('workspace.stopsEarly', 'Subtitles stop at {{time}}', {
                time: formatClockTime(stopsAt),
              })}
            </span>
            <Button
              variant="text"
              size="sm"
              onClick={() => {
                logButton('workspace_continue_transcribing');
                editor.continueTranscribing();
              }}
            >
              {t('subtitles.continueTranscribing', 'Continue transcribing')}
            </Button>
          </span>
        ) : null}
        {count > 0 ? <WatchControls /> : null}
      </div>
    </>
  );
}

const stopsEarlyStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

/**
 * A paid job for this video was still running when Translator quit or
 * crashed: say so, and pick it up again in one click.
 */
function useInterruptedJob() {
  const key = useCurrentSourceKey();
  const record = useInterruptedJobsStore(s => (key ? s.items[key] : null));
  const busy = useWorkspaceBusy();
  return record && key && !busy ? { key, record } : null;
}

function InterruptedJobNotice() {
  const { t, i18n } = useTranslation();
  const interrupted = useInterruptedJob();
  const videoPath = useVideoStore(s => s.path);
  const originalPath = useVideoStore(s => s.originalPath);
  const sourceUrl = useVideoStore(s => s.sourceUrl);
  const sourceAssetIdentity = useVideoStore(s => s.sourceAssetIdentity);
  const duration = useVideoStore(s => s.meta?.duration ?? null);
  const editor = useWorkspaceActions(s => s.editor);
  const summary = useSubtitleSummary();
  const documentId = interrupted?.record.documentId ?? null;
  const restoredRef = useRef<string | null>(null);

  // A translation of loaded subtitles stopped: put those lines back first,
  // so picking up translates them instead of starting from the video.
  useEffect(() => {
    if (!documentId || summary.count > 0) return;
    if (restoredRef.current === documentId) return;
    restoredRef.current = documentId;
    void mountSubtitleDocument(documentId, {
      sourceVideoPath: originalPath ?? videoPath,
      sourceUrl,
      sourceVideoAssetIdentity: sourceAssetIdentity,
    }).catch(() => {});
  }, [
    documentId,
    summary.count,
    originalPath,
    videoPath,
    sourceUrl,
    sourceAssetIdentity,
  ]);

  if (!interrupted) return null;
  const { key, record } = interrupted;

  const language = describeLanguage(record.language, t, i18n.language);
  const dismiss = () => useInterruptedJobsStore.getState().dismiss(key);
  const resume = () => {
    logButton('workspace_resume_interrupted', { kind: record.kind });
    dismiss();
    if (summary.count === 0 && record.documentId) {
      const documentId = record.documentId;
      void (async () => {
        const mounted = await mountSubtitleDocument(documentId, {
          sourceVideoPath: originalPath ?? videoPath,
          sourceUrl,
          sourceVideoAssetIdentity: sourceAssetIdentity,
        }).catch(() => false);
        if (!mounted) return;
        // Let the editor pick up the restored lines before it runs.
        await new Promise(resolve => setTimeout(resolve, 0));
        const subs = useSubStore.getState();
        const anyTranslated = subs.order.some(id =>
          subs.segments[id]?.translation?.trim()
        );
        useUIStore.getState().setTargetLanguage(record.language);
        const latestEditor = useWorkspaceActions.getState().editor;
        if (!anyTranslated && latestEditor) latestEditor.translateAll();
        else void translateMissingLines(record.language);
      })();
      return;
    }
    if (summary.count === 0) {
      if (!videoPath) return;
      useUIStore.getState().setTargetLanguage(record.language);
      useUIStore.getState().requestHomeRun({
        kind: 'mounted',
        path: videoPath,
        target: record.kind,
      });
      return;
    }
    const stopsAt = transcriptStopsEarlyAt({
      durationSecs: duration,
      lastEndSecs: summary.lastEnd,
    });
    // Loaded subtitles may end before the video does; that's not a stop.
    if (stopsAt !== null && editor && !record.documentId) {
      editor.continueTranscribing();
      return;
    }
    if (record.kind !== 'translate') return;
    if (summary.translated === 0) {
      useUIStore.getState().setTargetLanguage(record.language);
      editor?.translateAll();
    } else if (summary.missing > 0) {
      void translateMissingLines(record.language);
    }
  };

  return (
    <div className={idleStatusStyles} role="status">
      <span className={idleDotStyles(colors.primary)} aria-hidden="true" />
      <span>
        {record.kind === 'translate'
          ? t(
              'workspace.interruptedTranslate',
              'Making this video speak {{language}} stopped when Translator closed.',
              { language: language.name, languageInto: language.into }
            )
          : t(
              'workspace.interruptedTranscribe',
              'Transcribing this video stopped when Translator closed.'
            )}
      </span>
      <span className={stopsEarlyStyles}>
        <Button variant="primary" size="sm" onClick={resume}>
          {t('workspace.interruptedResume', 'Pick up where it stopped')}
        </Button>
        <Button variant="text" size="sm" onClick={dismiss}>
          {t('common.dismiss', 'Dismiss')}
        </Button>
      </span>
    </div>
  );
}

const stripColon = (text: string) => text.replace(/[:：]\s*$/u, '').trim();

/**
 * What people change while watching: which lines show, how big they are, and
 * the look. Always on the line under the video, never only in Export.
 */
function WatchControls() {
  return (
    <div className={watchControlsStyles}>
      <SubtitleDisplaySwitch />
      <SubtitleSizeStepper />
      <SubtitleStyleButton />
    </div>
  );
}

/** The current subtitle look, one click from the video; changes show live. */
// Shorter windows get the one-row picker so it doesn't hide the video.
const COMPACT_STYLE_PICKER_MAX_HEIGHT = 720;

function SubtitleStyleButton() {
  const { t } = useTranslation();
  const style = useUIStore(s => s.subtitleStyle);
  const setStyle = useUIStore(s => s.setSubtitleStyle);
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(
    () => window.innerHeight < COMPACT_STYLE_PICKER_MAX_HEIGHT
  );
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const label = stripColon(
    t('editSubtitles.mergeControls.styleLabel', 'Style:')
  );

  // Fixed to the window and clamped inside it, so it never runs off-screen
  // at narrow widths or under the sticky video column; opens upward when
  // there's no room below.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const anchor = buttonRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const margin = 16;
      const width = Math.min(560, window.innerWidth - margin * 2);
      const rtl = document.documentElement.dir === 'rtl';
      const left = Math.min(
        Math.max(margin, rtl ? anchor.left : anchor.right - width),
        window.innerWidth - margin - width
      );
      setCompact(window.innerHeight < COMPACT_STYLE_PICKER_MAX_HEIGHT);
      const height = popoverRef.current?.offsetHeight ?? 0;
      const below = window.innerHeight - anchor.bottom - 10 - 8;
      // Above the button, stop short of the lower part of the picture, where
      // the subtitles (the live preview) are drawn.
      const video = document
        .querySelector('.fixed-video-container video')
        ?.getBoundingClientRect();
      const aboveLimit =
        video && video.height > 0 && video.top < anchor.top
          ? Math.min(anchor.top - 10, video.top + video.height * 0.55)
          : anchor.top - 10;
      const above = aboveLimit - 8;
      // Prefer below the button: above would cover the subtitles on the video,
      // which is where the live preview shows. Scroll inside when short.
      const openBelow = height <= below || below >= 200 || below >= above;
      const top = openBelow
        ? anchor.bottom + 10
        : Math.max(8, aboveLimit - Math.min(height, above));
      setPlace({
        left,
        top,
        width,
        maxHeight: Math.max(120, openBelow ? below : above),
      });
    };
    measure();
    // Measure again once the popover has its real height.
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      )
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styleButtonStyles}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${subtitleStyleLabel(t, style)}`}
        onClick={() => {
          logButton('workspace_subtitle_style');
          setOpen(value => !value);
        }}
      >
        <Palette size={15} aria-hidden="true" />
        <span>{subtitleStyleLabel(t, style)}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={stylePopoverStyles}
              role="dialog"
              aria-label={label}
              style={
                place
                  ? {
                      left: place.left,
                      top: place.top,
                      width: place.width,
                      maxHeight: place.maxHeight,
                    }
                  : { visibility: 'hidden', left: 0, top: 0 }
              }
            >
              <SubtitleStylePicker
                value={style}
                compact={compact}
                onChange={preset => {
                  logButton('workspace_subtitle_style_pick', { preset });
                  setStyle(preset);
                }}
              />
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function MoreMenu({
  hasSubs,
  showExport,
}: {
  hasSubs: boolean;
  showExport: boolean;
}) {
  const { t } = useTranslation();
  // Swapping the source mid-job would reset the job's state while main keeps
  // working on the old file.
  const busy = useWorkspaceBusy();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuBox, setMenuBox] = useState<CSSProperties | null>(null);
  const editor = useWorkspaceActions(s => s.editor);
  const originalVideoPath = useVideoStore(s => s.originalPath);
  const mountedVideoPath = useVideoStore(s => s.path);
  // Downloads live in a temp folder until saved; a file the user opened is
  // already on disk, so the menu shows where it is instead.
  const canSaveOriginal = isManagedTempOriginalVideoPath(originalVideoPath);
  const localVideoPath = originalVideoPath || mountedVideoPath || null;

  // Clamp the menu to the window: open toward the side with more room and
  // scroll inside it when neither side fits (small windows, scrolled page).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const menu = menuRef.current;
      if (!anchor || !menu) return;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(menu.offsetWidth, vw - margin * 2);
      // Full border-box height: content and padding plus the border.
      const natural =
        menu.scrollHeight + (menu.offsetHeight - menu.clientHeight);
      const spaceAbove = anchor.top - margin * 2;
      const spaceBelow = vh - anchor.bottom - margin * 2;
      const below = spaceBelow >= natural || spaceBelow > spaceAbove;
      const rtl = document.documentElement.dir === 'rtl';
      const preferredLeft = rtl ? anchor.left : anchor.right - width;
      const left = Math.max(
        margin,
        Math.min(preferredLeft, vw - width - margin)
      );
      setMenuBox({
        position: 'fixed',
        left,
        right: 'auto',
        top: below ? anchor.bottom + margin : 'auto',
        bottom: below ? 'auto' : vh - anchor.top + margin,
        // Border-box and no minimum height: the menu's padding and border
        // stay inside the space, so its first row is never cut off.
        boxSizing: 'border-box',
        maxHeight: Math.max(
          0,
          Math.min(natural, below ? spaceBelow : spaceAbove)
        ),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      setMenuBox(null);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Focus was on an item that is about to unmount: back to "More".
      const inMenu = menuRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inMenu) {
        anchorRef.current
          ?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
          ?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openTools = (focus: WorkspaceToolsFocus | null, action: string) => {
    logButton(`workspace_more_${action}`);
    setOpen(false);
    useUIStore.getState().setWorkspaceToolsOpen(true, focus);
  };

  return (
    <div className={moreMenuAnchorStyles} ref={anchorRef}>
      <Button
        variant="secondary"
        size="lg"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        leftIcon={<MoreHorizontal size={18} />}
      >
        {t('workspace.more', 'More')}
      </Button>
      {open ? (
        <div
          ref={menuRef}
          className={moreMenuStyles}
          role="menu"
          // Hidden until measured so it never flashes off-screen.
          style={menuBox ?? { visibility: 'hidden' }}
        >
          {showExport ? (
            <button
              type="button"
              role="menuitem"
              className={moreMenuItemStyles}
              onClick={() => {
                logButton('workspace_more_export');
                setOpen(false);
                useUIStore.getState().setExportSheetOpen(true);
              }}
            >
              <Film aria-hidden="true" />
              {t('workspace.exportVideo', 'Export video with subtitles')}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools('dub', 'dub')}
          >
            <AudioLines aria-hidden="true" />
            {t('workspace.moreDub', 'Dub it')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools('clips', 'clips')}
          >
            <Scissors aria-hidden="true" />
            {t('workspace.moreClips', 'Make clips')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools('summary', 'summary')}
          >
            <FileText aria-hidden="true" />
            {t('workspace.moreSummary', 'Summary')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools('translate', 'translate_other')}
          >
            <Languages aria-hidden="true" />
            {t('workspace.moreTranslateOther', 'Translate to another language')}
          </button>
          <div className={moreMenuDividerStyles} />
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            disabled={busy}
            onClick={() => {
              logButton('workspace_more_change_video');
              setOpen(false);
              openChangeVideo();
            }}
          >
            <Video aria-hidden="true" />
            {t('workspace.moreChangeVideo', 'Change video')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            disabled={!editor}
            onClick={() => {
              logButton('workspace_more_mount_srt');
              setOpen(false);
              editor?.loadSrt();
            }}
          >
            <FileUp aria-hidden="true" />
            {hasSubs
              ? t('workspace.moreReplaceSrt', 'Load another SRT')
              : t('workspace.moreMountSrt', 'Mount SRT')}
          </button>
          {canSaveOriginal ? (
            <button
              type="button"
              role="menuitem"
              className={moreMenuItemStyles}
              onClick={() => {
                logButton('workspace_more_save_original');
                setOpen(false);
                void saveOriginalVideoFile(originalVideoPath);
              }}
            >
              <Download aria-hidden="true" />
              {t('workspace.moreSaveOriginal', 'Save original video')}
            </button>
          ) : localVideoPath ? (
            <button
              type="button"
              role="menuitem"
              className={moreMenuItemStyles}
              onClick={() => {
                logButton('workspace_more_reveal_video');
                setOpen(false);
                window.appShell.showItemInFolder(localVideoPath);
              }}
            >
              <FolderOpen aria-hidden="true" />
              {t('workspace.moreRevealVideo', 'Show video file')}
            </button>
          ) : null}
          <div className={moreMenuDividerStyles} />
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools(null, 'all_tools')}
          >
            <LayoutGrid aria-hidden="true" />
            {t('workspace.moreAllTools', 'All tools')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** One primary action that fits where the user is, plus Save and More. */
export function WorkspaceActionBar() {
  const { t, i18n } = useTranslation();
  const busy = useWorkspaceBusy();
  const language = useWorkspaceLanguage();
  const summary = useSubtitleSummary();
  const { count, translated, missing } = summary;
  const videoPath = useVideoStore(s => s.path);
  const editor = useWorkspaceActions(s => s.editor);
  const hasSubs = count > 0;
  // While a free-preview offer stands it carries the screen's yellow action.
  const offerShowing = useFreePreviewOfferShowing();
  const previewStands = Boolean(useActiveFreePreview());
  // A tools panel open beside the video has its own yellow action.
  const toolsOpen = useUIStore(s => s.workspaceToolsOpen);

  const unreadable = useMountedFileUnreadable();
  const checking = useMountedFileChecking();
  // "Pick up where it stopped" is the run action while that notice shows.
  const interrupted = Boolean(useInterruptedJob());
  const chosen = chooseWorkspacePrimary({
    busy,
    // An unreadable file offers "Choose another file" instead of a run, and
    // nothing runs before the file's first probe says it can be read.
    hasVideo: Boolean(videoPath) && !unreadable && !checking,
    hasEditor: Boolean(editor),
    previewStands,
    count,
    translated,
    missing,
    sourceLanguage: summary.sourceLanguage,
    targetLanguage: language.value,
  });
  const kind =
    interrupted &&
    (chosen === 'makeItSpeak' ||
      chosen === 'translate' ||
      chosen === 'translateMissing')
      ? 'none'
      : chosen;
  // Missing lines are finished in the language the others are already in.
  const missingLanguage = describeLanguage(
    summary.translationLanguage ?? language.value,
    t,
    i18n.language
  );

  let primary: { label: string; run: () => void } | null = null;
  if (kind === 'makeItSpeak' && videoPath) {
    primary = {
      label: t('home.makeItSpeak', 'Make it speak {{language}}', {
        language: language.name,
        languageInto: language.into,
      }),
      run: () => {
        logButton('workspace_make_it_speak');
        useUIStore.getState().setTargetLanguage(language.value);
        useUIStore
          .getState()
          .requestHomeRun({ kind: 'mounted', path: videoPath });
      },
    };
  } else if (kind === 'translate' && editor) {
    primary = {
      label: t('workspace.translateTo', 'Translate to {{language}}', {
        language: language.name,
        languageInto: language.into,
      }),
      run: () => {
        logButton('workspace_translate_all');
        useUIStore.getState().setTargetLanguage(language.value);
        editor.translateAll();
      },
    };
  } else if (kind === 'translateMissing') {
    primary = {
      label: t(
        'workspace.translateMissing',
        'Translate {{count}} missing lines into {{language}}',
        {
          defaultValue_one:
            'Translate {{count}} missing line into {{language}}',
          count: missing,
          language: missingLanguage.name,
          languageInto: missingLanguage.into,
        }
      ),
      run: () => {
        logButton('workspace_translate_missing', { missing });
        void translateMissingLines(missingLanguage.value);
      },
    };
  } else if (kind === 'export') {
    primary = {
      label: t('workspace.exportVideo', 'Export video with subtitles'),
      run: () => {
        logButton('workspace_export_open');
        useUIStore.getState().setExportSheetOpen(true);
      },
    };
  } else if (kind === 'save' && editor) {
    primary = {
      label: t('workspace.saveSrt', 'Save .srt'),
      run: () => void editor.save(),
    };
  }

  const showSecondarySave =
    hasSubs && editor && primary?.label !== t('workspace.saveSrt', 'Save .srt');

  return (
    <div className={actionBarStyles}>
      {primary ? (
        <Button
          variant={offerShowing || toolsOpen ? 'secondary' : 'primary'}
          size="lg"
          className={actionPrimaryStyles}
          onClick={primary.run}
        >
          {primary.label}
        </Button>
      ) : null}
      {showSecondarySave ? (
        <Button
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => void editor?.save()}
        >
          {t('workspace.saveSrt', 'Save .srt')}
        </Button>
      ) : null}
      <MoreMenu
        hasSubs={hasSubs}
        showExport={
          hasSubs &&
          !!videoPath &&
          !busy &&
          primary?.label !==
            t('workspace.exportVideo', 'Export video with subtitles')
        }
      />
    </div>
  );
}

/** Burn-in with the existing style, size and display options. */
export function WorkspaceExportSheet() {
  const { t } = useTranslation();
  const open = useUIStore(s => s.exportSheetOpen);
  const editor = useWorkspaceActions(s => s.editor);
  const order = useSubStore(s => s.order);
  const videoPath = useVideoStore(s => s.path);
  const mergeInProgress = useTaskStore(s => !!s.merge.inProgress);
  const translationInProgress = useTaskStore(s => !!s.translation.inProgress);
  // The same lock the editor's own Save/Export use (jobs, export preflight).
  const exportLocked = useWorkspaceActions(s => s.exportLocked);
  const close = () => useUIStore.getState().setExportSheetOpen(false);

  if (!editor) return null;
  return (
    <Modal
      open={open}
      title={t('workspace.exportTitle', 'Export video with subtitles')}
      onClose={close}
      closeLabel={t('common.close', 'Close')}
    >
      <div className={exportSheetBodyStyles}>
        <SaveAndMergeBar
          onSave={editor.save}
          onSaveAs={editor.saveAs}
          onMerge={() => {
            close();
            editor.merge();
          }}
          canSaveDirectly={order.length > 0}
          subtitlesExist={order.length > 0}
          videoFileExists={!!videoPath}
          isExportLocked={exportLocked}
          isMergingInProgress={mergeInProgress}
          isTranslationInProgress={translationInProgress}
          primaryMerge
        />
      </div>
    </Modal>
  );
}
