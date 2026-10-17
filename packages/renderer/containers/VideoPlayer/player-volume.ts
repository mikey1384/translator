import { create } from 'zustand';
import { getNativePlayerInstance } from '../../native-player';

export const VOLUME_STORAGE_KEY = 'playerVolume.v1';
export const VOLUME_STEP = 0.1;
const UNMUTE_FALLBACK_VOLUME = 0.5;

export interface VolumeState {
  volume: number;
  muted: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function readStoredVolume(storage?: StorageLike | null): VolumeState {
  try {
    const raw = storage?.getItem(VOLUME_STORAGE_KEY);
    if (!raw) return { volume: 1, muted: false };
    const parsed = JSON.parse(raw);
    return {
      volume: clampVolume(Number(parsed?.volume ?? 1)),
      muted: parsed?.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

export function writeStoredVolume(
  state: VolumeState,
  storage?: StorageLike | null
): void {
  try {
    storage?.setItem(
      VOLUME_STORAGE_KEY,
      JSON.stringify({ volume: state.volume, muted: state.muted })
    );
  } catch {
    // A convenience only; playback keeps the in-memory value.
  }
}

/** Unmuting at zero volume would still be silent, so come back audible. */
export function toggledMute(state: VolumeState): VolumeState {
  if (state.muted || state.volume === 0) {
    return {
      muted: false,
      volume: state.volume === 0 ? UNMUTE_FALLBACK_VOLUME : state.volume,
    };
  }
  return { ...state, muted: true };
}

/** Changing the level unmutes, and dragging to zero reads as muted. */
export function withVolume(state: VolumeState, volume: number): VolumeState {
  const next = clampVolume(volume);
  return { volume: next, muted: next === 0 ? state.muted : false };
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface PlayerVolumeStore extends VolumeState {
  setVolume(volume: number): void;
  stepVolume(direction: 1 | -1): void;
  toggleMute(): void;
}

export const usePlayerVolume = create<PlayerVolumeStore>((set, get) => {
  const commit = (next: VolumeState) => {
    set(next);
    writeStoredVolume(next, safeStorage());
    applyPlayerVolume(next);
  };
  return {
    ...readStoredVolume(safeStorage()),
    setVolume: volume => commit(withVolume(get(), volume)),
    stepVolume: direction =>
      commit(withVolume(get(), get().volume + direction * VOLUME_STEP)),
    toggleMute: () => commit(toggledMute(get())),
  };
});

/** Put the chosen level on the media element (original or dubbed source). */
export function applyPlayerVolume(
  state: VolumeState = usePlayerVolume.getState()
): void {
  const media = getNativePlayerInstance();
  if (!media) return;
  if (media.volume !== state.volume) media.volume = state.volume;
  if (media.muted !== state.muted) media.muted = state.muted;
}
