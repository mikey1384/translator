import { useUIStore } from '../state';

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    useUIStore.getState().setFindBarVisible(true);
  }
});
