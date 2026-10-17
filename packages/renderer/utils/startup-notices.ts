import { i18n, restoreLanguageAfterSettingsReset } from '../i18n';
import * as SystemIPC from '../ipc/system';
import { openNotice, type AppNoticeButton } from '../state/modal-store';
import { useUIStore } from '../state/ui-store';

export type StartupNotice = 'settingsReset' | 'deviceIdReplaced';

const SUPPORT_EMAIL = 'mikey@stage5.tools';

/** The notice text and buttons for this launch's resets (null = none). */
export function buildStartupNotice(notices: StartupNotice[]): {
  title: string;
  message: string;
  buttons: AppNoticeButton[];
} | null {
  const t = i18n.t.bind(i18n);
  const settingsReset = notices.includes('settingsReset');
  const deviceIdReplaced = notices.includes('deviceIdReplaced');
  if (!settingsReset && !deviceIdReplaced) return null;

  const parts: string[] = [];
  if (settingsReset) {
    parts.push(
      t(
        'startupNotice.settingsReset',
        "Translator's settings file was damaged, so your preferences were reset: interface and subtitle language, API keys, and other options. A copy of the damaged file was kept. Please check Settings."
      )
    );
  }
  if (deviceIdReplaced) {
    parts.push(
      t(
        'startupNotice.deviceIdReplaced',
        "The file that links this computer to your minutes was damaged, so Translator created a new link. Minutes you bought may not show here. Contact support with your purchase receipt and we'll move them back."
      )
    );
  }

  const buttons: AppNoticeButton[] = [];
  if (deviceIdReplaced) {
    buttons.push({
      id: 'support',
      label: t('startupNotice.contactSupport', 'Contact support'),
      variant: settingsReset ? 'secondary' : 'primary',
    });
  }
  if (settingsReset) {
    buttons.push({
      id: 'settings',
      label: t('startupNotice.openSettings', 'Open Settings'),
      variant: 'primary',
    });
  }
  buttons.unshift({
    id: 'ok',
    label: t('common.close', 'Close'),
    variant: 'secondary',
  });

  return {
    title: t('startupNotice.title', 'Some settings were reset'),
    message: parts.join('\n\n'),
    buttons,
  };
}

/** Tell the user, once per launch, when a damaged store was reset. */
export async function showStartupNotices(): Promise<void> {
  let notices: StartupNotice[] = [];
  try {
    notices = await SystemIPC.takeStartupNotices();
  } catch (error) {
    console.warn('[startup-notices] Could not read startup notices:', error);
    return;
  }
  if (notices.includes('settingsReset')) {
    try {
      await restoreLanguageAfterSettingsReset();
    } catch (error) {
      console.warn('[startup-notices] Could not restore the language:', error);
    }
  }
  const notice = buildStartupNotice(notices);
  if (!notice) return;
  const choice = await openNotice(notice);
  if (choice === 'settings') {
    useUIStore.getState().toggleSettings(true);
  } else if (choice === 'support') {
    const subject = i18n.t(
      'startupNotice.supportSubject',
      'My minutes are missing after Translator reset this computer'
    );
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
    try {
      await window.appShell.openExternal(mailto);
    } catch (error) {
      console.warn('[startup-notices] Could not open the mail app:', error);
    }
  }
}
