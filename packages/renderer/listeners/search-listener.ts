import { useUIStore, useSubStore } from '../state';

/* ------------------------------------------------------------ */
/* 1️⃣  recompute                                               */
/* ------------------------------------------------------------ */
function recompute() {
  const { searchText } = useUIStore.getState();
  const txt = searchText.trim().toLowerCase();

  /* Clear matches when query is empty ------------------------ */
  if (!txt) {
    useUIStore.getState().setMatchedIndices([]);
    return;
  }

  /* Build new match list ------------------------------------- */
  const { order, segments } = useSubStore.getState();
  const idxs: number[] = [];

  order.forEach((id, i) => {
    const s = segments[id];
    const haystack = `${s.original}\n${s.translation ?? ''}`.toLowerCase();
    if (haystack.includes(txt)) idxs.push(i);
  });

  /* Update UI store in **one** call -------------------------- */
  useUIStore.getState().setMatchedIndices(idxs);
}

/* ------------------------------------------------------------ */
/* 2️⃣  subscribe with selectors                                */
/* ------------------------------------------------------------ */
/* Fire when search text changes                               */
useUIStore.subscribe(
  state => state.searchText, // selector
  recompute // listener
);

/* Fire when subtitles change: we listen to the monotonically   */
/* increasing `sourceId`, not every tiny field mutation         */
useSubStore.subscribe(
  s => s.sourceId, // selector
  recompute // listener
);

/* Run once on load so the initial state is correct ----------- */
recompute();
