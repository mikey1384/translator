// Tab visibility reactions:
// - hidden: pause media so a background tab never keeps playing audio or
//   burning CPU on video decode (not auto-resumed; the user resumes).
// - visible: rehydrate global state that another tab may have changed while
//   this renderer was backgrounded. Each tab is its own renderer process,
//   so cross-tab changes to AI settings or the UI language would otherwise
//   leave this tab stale while the main process already uses the new values.
import { useAiStore } from '../state/ai-store';
import { useVideoStore } from '../state/video-store';
import { i18n, changeLanguage } from '../i18n';
import * as SystemIPC from '@ipc/system';

async function rehydrateLanguage(): Promise<void> {
  try {
    const preferred = await SystemIPC.getLanguagePreference();
    if (
      typeof preferred === 'string' &&
      preferred &&
      preferred !== i18n.language
    ) {
      await changeLanguage(preferred);
    }
  } catch (err) {
    console.error('[tab-visibility] language rehydrate failed:', err);
  }
}

(window as any).electron?.onTabVisibilityChanged?.(
  (info: { visible: boolean }) => {
    if (info?.visible) {
      try {
        useAiStore.setState({ initialized: false, initializing: false });
        void useAiStore
          .getState()
          .initialize()
          .then(() => {
            window.dispatchEvent(new CustomEvent('tab-settings-rehydrated'));
          });
      } catch (err) {
        console.error('[tab-visibility] settings rehydrate failed:', err);
      }
      void rehydrateLanguage();
      // Another tab may have opened/downloaded/removed local media; the
      // shared localStorage is current but this tab's store copy is not.
      void useVideoStore
        .getState()
        .refreshRecentLocalMedia()
        .catch(err => {
          console.error('[tab-visibility] recent media rehydrate failed:', err);
        });
      return;
    }
    document.querySelectorAll('video, audio').forEach(el => {
      try {
        const media = el as HTMLMediaElement;
        if (!media.paused) media.pause();
      } catch {
        // detached element; ignore
      }
    });
  }
);

export {};
