import { useUIStore, useSubStore } from '../state';
import {
  collectMatchRows,
  currentFindOptions,
  useFindOptions,
} from '../utils/subtitleFind';

/* ------------------------------------------------------------ */
/* 1️⃣  recompute                                               */
/* ------------------------------------------------------------ */
function recompute() {
  const { searchText } = useUIStore.getState();
  /* Same rules as the editor's counter and highlights: one entry per match */
  const { order, segments } = useSubStore.getState();
  const idxs = collectMatchRows(
    order.map(id => segments[id]),
    searchText,
    currentFindOptions()
  );

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

/* Fire when Match case / Whole word change                    */
useFindOptions.subscribe(recompute);

/* Run once on load so the initial state is correct ----------- */
recompute();
