import { useEffect } from 'react';
import { useUIStore } from '../state';

export default function useGlobalHotkeys() {
  const { setFindBarVisible, toggleSettings } = useUIStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setFindBarVisible(true);
      }
      if (e.key === 'Escape') {
        setFindBarVisible(false);
        toggleSettings(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
