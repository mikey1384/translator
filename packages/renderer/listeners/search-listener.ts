import { useUIStore, useSubStore } from '../state';

function recompute() {
  const { searchText } = useUIStore.getState();
  const txt = searchText.trim().toLowerCase();
  if (!txt) {
    useUIStore.getState().setMatchedIndices([]);
    return;
  }

  const { order, segments } = useSubStore.getState();
  const idxs: number[] = [];

  order.forEach((id: string, i: number) => {
    const s = segments[id];
    const haystack = `${s.original}\n${s.translation ?? ''}`.toLowerCase();

    if (haystack.includes(txt)) idxs.push(i);
  });

  useUIStore.getState().setMatchedIndices(idxs);
  const { activeMatchIndex } = useUIStore.getState();
  if (activeMatchIndex >= idxs.length)
    useUIStore.getState().setActiveMatchIndex(Math.max(0, idxs.length - 1));
}

useUIStore.subscribe(() => {
  recompute();
});
useSubStore.subscribe(() => {
  recompute();
});
