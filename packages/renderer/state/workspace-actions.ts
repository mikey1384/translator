import { create } from 'zustand';

// The subtitle editor owns save, merge and translate-all. It registers them
// here so the video workspace's action bar and export sheet call exactly the
// same handlers instead of duplicating that logic.
export interface WorkspaceEditorActions {
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  merge: () => void;
  translateAll: () => void;
  /** Transcribe from the last line to the end of the video. */
  continueTranscribing: () => void;
  /** Opens an .srt: the file dialog, or `filePath` when one was dropped. */
  loadSrt: (filePath?: string) => void;
  mountVideo: () => void;
}

interface WorkspaceActionsState {
  editor: WorkspaceEditorActions | null;
  subtitleNavigation: (() => void) | null;
  registerSubtitleNavigation(navigate: (() => void) | null): void;
  /** Save/export are blocked (a job or the export preflight is running). */
  exportLocked: boolean;
  registerEditor(actions: WorkspaceEditorActions | null): void;
  setExportLocked(locked: boolean): void;
}

export const useWorkspaceActions = create<WorkspaceActionsState>(set => ({
  editor: null,
  subtitleNavigation: null,
  registerSubtitleNavigation(subtitleNavigation) {
    set({ subtitleNavigation });
  },
  exportLocked: false,
  registerEditor(actions) {
    set({ editor: actions });
  },
  setExportLocked(locked) {
    set({ exportLocked: locked });
  },
}));
