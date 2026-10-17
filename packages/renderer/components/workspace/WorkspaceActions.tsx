import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  Languages,
  LayoutGrid,
  MoreHorizontal,
  Scissors,
  Video,
} from 'lucide-react';
import Button from '../Button';
import Modal from '../Modal';
import { useFreePreviewOfferShowing } from './FreePreviewOffer';
import SaveAndMergeBar from '../../containers/EditSubtitles/SaveAndMergeBar';
import {
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
  idleStatusStyles,
  moreMenuAnchorStyles,
  moreMenuDividerStyles,
  moreMenuItemStyles,
  moreMenuStyles,
} from './workspace-styles';

export function useWorkspaceLanguage(): {
  value: string;
  name: string;
  into: string;
} {
  const { t, i18n } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const value =
    targetLanguage && targetLanguage !== 'original'
      ? targetLanguage
      : mapUiLanguageToTargetLanguage(i18n.language);
  const name = sentenceLanguageName(
    t(`languages.${value}`, { defaultValue: value }),
    i18n.language
  );
  return { value, name, into: intoLanguageName(value, name, i18n.language) };
}

export function useWorkspaceBusy(): boolean {
  const download = useUrlStore(s => s.download.inProgress);
  const transcription = useTaskStore(s => !!s.transcription.inProgress);
  const translation = useTaskStore(s => !!s.translation.inProgress);
  const dubbing = useTaskStore(s => !!s.dubbing.inProgress);
  const merge = useTaskStore(s => !!s.merge.inProgress);
  return download || transcription || translation || dubbing || merge;
}

function useSubtitleSummary() {
  return useSubStore(
    s => {
      let translated = 0;
      for (const id of s.order) {
        if (s.segments[id]?.translation?.trim()) translated += 1;
      }
      return { count: s.order.length, translated };
    },
    (a, b) => a.count === b.count && a.translated === b.translated
  );
}

/** The calm line under the video when nothing is running. */
export function WorkspaceIdleStatus() {
  const { t } = useTranslation();
  const language = useWorkspaceLanguage();
  const { count, translated } = useSubtitleSummary();
  const done = count > 0 && translated > 0;
  const text = done
    ? t(
        'workspace.statusTranslated',
        '{{count}} lines in {{language}} · in sync with the video',
        {
          count: translated,
          language: language.name,
          languageInto: language.into,
        }
      )
    : count > 0
      ? t('workspace.statusTranscribed', '{{count}} lines transcribed', {
          count,
        })
      : t(
          'workspace.statusReady',
          'Ready — {{language}} subtitles are one click away',
          {
            language: language.name,
            languageInto: language.into,
          }
        );
  return (
    <div className={idleStatusStyles} role="status">
      <span
        className={idleDotStyles(done ? colors.success : colors.gray)}
        aria-hidden="true"
      />
      <span>{text}</span>
    </div>
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
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    alignLeft: boolean;
    below: boolean;
  }>({ alignLeft: false, below: false });
  const editor = useWorkspaceActions(s => s.editor);

  // Open toward whichever side has room: the bar wraps on narrow windows and
  // the page may be scrolled, so a fixed up-and-left menu can leave the view.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    setPlacement({
      alignLeft: anchor.right - width < 8,
      below:
        anchor.top - height - 8 < 8 &&
        anchor.bottom + height + 8 <= window.innerHeight,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
          style={{
            ...(placement.alignLeft ? { left: 0, right: 'auto' } : null),
            ...(placement.below
              ? { top: 'calc(100% + 8px)', bottom: 'auto' }
              : null),
          }}
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
          <button
            type="button"
            role="menuitem"
            className={moreMenuItemStyles}
            onClick={() => openTools('video', 'save_original')}
          >
            <Download aria-hidden="true" />
            {t('workspace.moreSaveOriginal', 'Save original video')}
          </button>
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
  const { t } = useTranslation();
  const busy = useWorkspaceBusy();
  const language = useWorkspaceLanguage();
  const { count, translated } = useSubtitleSummary();
  const videoPath = useVideoStore(s => s.path);
  const editor = useWorkspaceActions(s => s.editor);
  const hasSubs = count > 0;
  const hasTranslation = translated > 0;
  // While a free-preview offer stands it carries the screen's yellow action.
  const offerShowing = useFreePreviewOfferShowing();

  let primary: { label: string; run: () => void } | null = null;
  if (!busy) {
    if (!hasSubs && videoPath && offerShowing) {
      primary = null;
    } else if (!hasSubs && videoPath) {
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
    } else if (hasSubs && !hasTranslation && editor) {
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
    } else if (hasSubs && videoPath) {
      primary = {
        label: t('workspace.exportVideo', 'Export video with subtitles'),
        run: () => {
          logButton('workspace_export_open');
          useUIStore.getState().setExportSheetOpen(true);
        },
      };
    } else if (hasSubs && editor) {
      primary = {
        label: t('workspace.saveSrt', 'Save .srt'),
        run: () => void editor.save(),
      };
    }
  }

  const showSecondarySave =
    hasSubs && editor && primary?.label !== t('workspace.saveSrt', 'Save .srt');

  return (
    <div className={actionBarStyles}>
      {primary ? (
        <Button
          variant={offerShowing ? 'secondary' : 'primary'}
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
          isMergingInProgress={mergeInProgress}
          isTranslationInProgress={translationInProgress}
          primaryMerge
        />
      </div>
    </Modal>
  );
}
