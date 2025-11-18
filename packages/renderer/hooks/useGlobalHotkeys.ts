import { useEffect } from 'react';
import { useUIStore } from '../state';
import { logButton } from '../utils/logger';

export default function useGlobalHotkeys() {
  const { setFindBarVisible, toggleSettings } = useUIStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setFindBarVisible(true);
        try {
          logButton('findbar_open');
        } catch {
          // Ignore logging errors
        }
      }
      if (e.key === 'Escape') {
        setFindBarVisible(false);
        try {
          logButton('findbar_close');
        } catch {
          // Ignore logging errors
        }
        toggleSettings(false);
        try {
          logButton('close_settings');
        } catch {
          // Ignore logging errors
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
