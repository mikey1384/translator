// Application state management reducer function
export interface AppState {
  // Media states
  videoFile: File | null;
  videoUrl: string;

  // Translation states
  isTranslationInProgress: boolean;
  isMergingInProgress: boolean;
  subtitleTranslationProgress: {
    progress: number;
    stage: string;
    error?: string;
  };
  subtitleMergeProgress: {
    progress: number;
    stage: string;
    error?: string;
  };
}

export type AppAction =
  | { type: 'SET_VIDEO_FILE'; payload: File | null }
  | { type: 'SET_VIDEO_URL'; payload: string }
  | { type: 'SET_TRANSLATION_IN_PROGRESS'; payload: boolean }
  | { type: 'SET_MERGING_IN_PROGRESS'; payload: boolean }
  | {
      type: 'SET_TRANSLATION_PROGRESS';
      payload: { progress: number; stage: string; error?: string };
    }
  | {
      type: 'SET_MERGE_PROGRESS';
      payload: { progress: number; stage: string; error?: string };
    };

export function ManagementReducer(
  state: AppState,
  action: AppAction
): AppState {
  switch (action.type) {
    case 'SET_VIDEO_FILE':
      return { ...state, videoFile: action.payload };

    case 'SET_VIDEO_URL':
      return { ...state, videoUrl: action.payload };

    case 'SET_TRANSLATION_IN_PROGRESS':
      return { ...state, isTranslationInProgress: action.payload };

    case 'SET_MERGING_IN_PROGRESS':
      return { ...state, isMergingInProgress: action.payload };

    case 'SET_TRANSLATION_PROGRESS':
      return {
        ...state,
        subtitleTranslationProgress: action.payload,
      };

    case 'SET_MERGE_PROGRESS':
      return {
        ...state,
        subtitleMergeProgress: action.payload,
      };

    default:
      return state;
  }
}
