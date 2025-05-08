import { useEffect } from 'react';
import { useSubStore } from '../state';

export default function useSubtitleSync() {
  const { seek } = useSubStore();
  useEffect(() => {
    const h = (e: CustomEvent<{ id: string }>) => seek(e.detail.id);
    window.addEventListener('subtitle:seek', h as EventListener);
    return () =>
      window.removeEventListener('subtitle:seek', h as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
