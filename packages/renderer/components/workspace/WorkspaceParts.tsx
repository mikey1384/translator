import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../Button';
import SideMenu from '../../containers/VideoPlayer/SideMenu';
import GapList from '../../containers/VideoPlayer/GapList';
import { useSubStore, useUIStore, useVideoStore } from '../../state';
import { useWorkspaceActions } from '../../state/workspace-actions';
import { logButton } from '../../utils/logger';
import ReadOnlySubtitleList from './ReadOnlySubtitleList';
import {
  noVideoStyles,
  noVideoTitleStyles,
  workspaceEditSwitchStyles,
  workspaceSubsAreaStyles,
  workspaceSubsHeadStyles,
  workspaceSubsTitleStyles,
  workspaceToolsHeaderStyles,
  workspaceToolsVideoAreaStyles,
  workspaceSubsTitleCountStyles,
} from './workspace-styles';

export function WorkspaceSubtitlesHead() {
  const { t } = useTranslation();
  const editMode = useUIStore(s => s.subtitleEditMode);
  const count = useSubStore(s => s.order.length);
  return (
    <div className={workspaceSubsHeadStyles}>
      <h2 className={workspaceSubsTitleStyles}>
        {t('workspace.subtitlesTitle', 'Subtitles')}
        {count > 0 ? (
          <span className={workspaceSubsTitleCountStyles}>{count}</span>
        ) : null}
      </h2>
      <label className={workspaceEditSwitchStyles}>
        <input
          type="checkbox"
          role="switch"
          checked={editMode}
          onChange={event => {
            logButton(
              event.target.checked
                ? 'workspace_edit_mode_on'
                : 'workspace_edit_mode_off'
            );
            useUIStore.getState().setSubtitleEditMode(event.target.checked);
          }}
        />
        {t('workspace.editToggle', 'Edit subtitles')}
      </label>
    </div>
  );
}

/** Read-only list; it carries the editor destination while editing is off. */
export function WorkspaceReadOnlyArea() {
  return (
    <div
      className={workspaceSubsAreaStyles}
      data-translator-destination="editor"
    >
      <ReadOnlySubtitleList />
    </div>
  );
}

export function WorkspaceNoVideo() {
  const { t } = useTranslation();
  const editor = useWorkspaceActions(s => s.editor);
  return (
    <div className={noVideoStyles}>
      <span className={noVideoTitleStyles}>
        {t('workspace.noVideoTitle', 'Add the video')}
      </span>
      <span>
        {t(
          'workspace.noVideoBody',
          'Open the video these subtitles belong to, to watch them in place and burn them in.'
        )}
      </span>
      <Button
        variant="secondary"
        size="md"
        disabled={!editor}
        onClick={() => editor?.mountVideo()}
      >
        {t('input.selectVideoAudioFile')}
      </Button>
    </div>
  );
}

/** Header of the expanded "All tools" area plus the video controls card. */
export function WorkspaceToolsVideo() {
  const { t } = useTranslation();
  const focus = useUIStore(s => s.workspaceToolsFocus);
  const videoPath = useVideoStore(s => s.path);
  const videoUrl = useVideoStore(s => s.url);
  // Task views from the More menu: a title for the task and only its tools.
  const focusedTask =
    focus === 'clips' ||
    focus === 'summary' ||
    focus === 'dub' ||
    focus === 'translate';
  const title =
    focus === 'clips'
      ? t('workspace.moreClips', 'Make clips')
      : focus === 'summary'
        ? t('workspace.moreSummary', 'Summary')
        : focus === 'dub'
          ? t('workspace.moreDub', 'Dub it')
          : focus === 'translate'
            ? t('workspace.moreTranslateOther', 'Translate to another language')
            : t('workspace.moreAllTools', 'All tools');

  useEffect(() => {
    if (!focus) return;
    const target =
      focus === 'process'
        ? document.querySelector<HTMLElement>(
            '[data-translator-destination="create"]'
          )
        : document.getElementById('workspace-tools-video');
    requestAnimationFrame(() =>
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  }, [focus]);

  return (
    <div className={workspaceToolsVideoAreaStyles} id="workspace-tools-video">
      <div className={workspaceToolsHeaderStyles}>
        <h2 className={workspaceSubsTitleStyles}>{title}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {focusedTask ? (
            <Button
              variant="text"
              size="sm"
              onClick={() =>
                useUIStore.getState().setWorkspaceToolsOpen(true, null)
              }
            >
              {t('workspace.showAllTools', 'Show all tools')}
            </Button>
          ) : null}
          <Button
            variant="text"
            size="sm"
            onClick={() => useUIStore.getState().setWorkspaceToolsOpen(false)}
          >
            {focusedTask
              ? t('common.close', 'Close')
              : t('workspace.hideTools', 'Hide tools')}
          </Button>
        </div>
      </div>
      {videoUrl && !focusedTask ? (
        <div className="workspace-tools-video-grid">
          <GapList key={(videoPath || videoUrl || 'none').toString()} />
          <SideMenu />
        </div>
      ) : null}
    </div>
  );
}
