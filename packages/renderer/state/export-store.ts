import { createWithEqualityFn } from 'zustand/traditional';
import * as FileIPC from '@ipc/file';

export type ExportDestination =
  | { mode: 'default' }
  | { mode: 'chosen'; path: string };

export type ExportOutcome =
  | { status: 'idle' }
  | { status: 'success'; outputPath: string }
  | { status: 'error'; message: string };

interface ExportState {
  /** Where the next export of `forVideo` will be saved. */
  destination: ExportDestination;
  /** The full path shown in the export sheet. */
  destinationPath: string | null;
  forVideo: string | null;
  /** The last export's result, kept on screen until dismissed. */
  outcome: ExportOutcome;
  setOutcome(outcome: ExportOutcome): void;
  /** Load the default destination for this video unless one is settled. */
  prepareDestination(videoPath: string | null): Promise<void>;
  /** Ask in the system save dialog; keeps the current choice on cancel. */
  chooseDestination(videoPath: string): Promise<void>;
}

export const useExportStore = createWithEqualityFn<ExportState>()(
  (set, get) => ({
    destination: { mode: 'default' },
    destinationPath: null,
    forVideo: null,
    outcome: { status: 'idle' },

    setOutcome(outcome) {
      set({ outcome });
    },

    async prepareDestination(videoPath) {
      if (!videoPath) {
        set({
          destination: { mode: 'default' },
          destinationPath: null,
          forVideo: null,
        });
        return;
      }
      // A destination the user picked holds for this video; the default is
      // refreshed each time, since the previous export may have taken its name.
      const current = get();
      if (
        current.forVideo === videoPath &&
        current.destination.mode === 'chosen'
      )
        return;
      set({ destination: { mode: 'default' }, forVideo: videoPath });
      try {
        const { path } = await FileIPC.getDefaultExportVideoPath(videoPath);
        if (
          get().forVideo === videoPath &&
          get().destination.mode === 'default'
        )
          set({ destinationPath: path });
      } catch {
        set({ destinationPath: null });
      }
    },

    async chooseDestination(videoPath) {
      const current = get();
      const result = await FileIPC.chooseExportVideoPath({
        sourcePath: videoPath,
        currentPath:
          current.forVideo === videoPath
            ? (current.destinationPath ?? undefined)
            : undefined,
      });
      if (result.canceled || !result.path) return;
      set({
        destination: { mode: 'chosen', path: result.path },
        destinationPath: result.path,
        forVideo: videoPath,
      });
    },
  })
);

/** After an export, the next one starts from the default again. */
export function resetExportDestination(): void {
  useExportStore.setState({
    destination: { mode: 'default' },
    destinationPath: null,
    forVideo: null,
  });
}
