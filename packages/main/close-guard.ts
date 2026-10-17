// What to ask before a tab, the window or the app closes while a job runs or
// subtitle edits are unsaved. Pure, so it can be unit tested without Electron.

export type CloseGuardScope = 'tab' | 'window' | 'quit';

export type CloseGuardTab = {
  title: string;
  running: boolean;
  unsaved: boolean;
  job: string | null;
};

export type CloseGuardAction = 'save' | 'close' | 'cancel';

export type CloseGuardPrompt = {
  message: string;
  detail: string;
  buttons: string[];
  actions: CloseGuardAction[];
  defaultId: number;
  cancelId: number;
};

type Translate = (
  key: string,
  vars?: Record<string, string | number | null | undefined>,
  defaultValue?: string
) => string;

const JOB_SENTENCES: Record<string, string> = {
  transcription: 'A transcription is still running.',
  translation: 'A translation is still running.',
  dubbing: 'Dubbing is still running.',
  export: 'A video export is still running.',
  summary: 'A summary is still being written.',
  download: 'A download is still running.',
  highlight: 'Highlight clips are still being made.',
  search: 'A video search is still running.',
};

export function needsCloseGuard(tab: CloseGuardTab): boolean {
  return tab.running || tab.unsaved;
}

function describeTab(tab: CloseGuardTab, t: Translate): string {
  if (tab.running) {
    const job = tab.job && JOB_SENTENCES[tab.job] ? tab.job : 'generic';
    return t(
      `dialogs.closeGuard.job.${job}`,
      undefined,
      JOB_SENTENCES[job] ?? 'A job is still running.'
    );
  }
  return t(
    'dialogs.closeGuard.unsavedLine',
    undefined,
    "Subtitle edits aren't saved."
  );
}

export function buildCloseGuardPrompt(
  scope: CloseGuardScope,
  tabs: CloseGuardTab[],
  t: Translate,
  appName: string
): CloseGuardPrompt | null {
  const pending = tabs.filter(needsCloseGuard);
  if (pending.length === 0) return null;
  const anyUnsaved = pending.some(tab => tab.unsaved);
  const anyRunning = pending.some(tab => tab.running);
  const cancel = t('common.cancel', undefined, 'Cancel');

  let message: string;
  let detail: string;
  if (scope === 'tab') {
    const [tab] = pending;
    message = tab.running
      ? describeTab(tab, t)
      : t(
          'dialogs.closeGuard.unsavedMessage',
          undefined,
          "These subtitles have changes that aren't saved."
        );
    detail = anyUnsaved
      ? anyRunning
        ? t(
            'dialogs.closeGuard.tabUnsavedWithJobDetail',
            undefined,
            'Closing the tab stops the job. Save your subtitle edits first?'
          )
        : t(
            'dialogs.closeGuard.tabUnsavedDetail',
            undefined,
            'Save them before closing the tab?'
          )
      : t(
          'dialogs.closeGuard.tabJobDetail',
          undefined,
          'Closing the tab stops it, and the work done so far is lost.'
        );
  } else {
    message =
      scope === 'quit'
        ? t(
            'dialogs.closeGuard.quitMessage',
            { app: appName },
            "Quit {{app}}? Some work isn't finished."
          )
        : t(
            'dialogs.closeGuard.windowMessage',
            undefined,
            "Close the window? Some work isn't finished."
          );
    const lines = pending.map(tab =>
      t(
        'dialogs.closeGuard.tabLine',
        { title: tab.title, status: describeTab(tab, t) },
        '{{title}}: {{status}}'
      )
    );
    const consequence = anyUnsaved
      ? anyRunning
        ? t(
            'dialogs.closeGuard.unsavedWithJobsDetail',
            undefined,
            'Running jobs stop. Save your subtitle edits first?'
          )
        : t(
            'dialogs.closeGuard.unsavedOnlyDetail',
            undefined,
            'Save your subtitle edits first?'
          )
      : t(
          'dialogs.closeGuard.jobsDetail',
          undefined,
          'Running jobs stop, and the work done so far is lost.'
        );
    detail = [...lines, '', consequence].join('\n');
  }

  if (anyUnsaved) {
    const save =
      scope === 'quit'
        ? t('dialogs.closeGuard.saveAndQuit', undefined, 'Save and quit')
        : t('dialogs.closeGuard.saveAndClose', undefined, 'Save and close');
    const discard =
      scope === 'quit'
        ? t(
            'dialogs.closeGuard.quitWithoutSaving',
            undefined,
            'Quit without saving'
          )
        : t(
            'dialogs.closeGuard.closeWithoutSaving',
            undefined,
            'Close without saving'
          );
    return {
      message,
      detail,
      buttons: [save, discard, cancel],
      actions: ['save', 'close', 'cancel'],
      defaultId: 0,
      cancelId: 2,
    };
  }

  const proceed =
    scope === 'quit'
      ? t('dialogs.closeGuard.quitAnyway', undefined, 'Quit anyway')
      : scope === 'window'
        ? t('dialogs.closeGuard.closeAnyway', undefined, 'Close anyway')
        : t('dialogs.closeGuard.stopAndClose', undefined, 'Stop and close');
  // Stopping paid work is destructive: Cancel is the default.
  return {
    message,
    detail,
    buttons: [proceed, cancel],
    actions: ['close', 'cancel'],
    defaultId: 1,
    cancelId: 1,
  };
}
