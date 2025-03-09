import { Dispatch } from "react";
import { AppAction } from "./reducer";
import { validateSubtitleTimings } from "../helpers/subtitle-utils";

export default function ManagementActions(dispatch: Dispatch<AppAction>) {
  return {
    onSetVideoFile: (file: File | null) => {
      dispatch({ type: "SET_VIDEO_FILE", payload: file });
    },

    onSetVideoUrl: (url: string) => {
      dispatch({ type: "SET_VIDEO_URL", payload: url });
    },

    onSetIsTranslationInProgress: (inProgress: boolean) => {
      dispatch({ type: "SET_TRANSLATION_IN_PROGRESS", payload: inProgress });
    },

    onSetIsMergingInProgress: (inProgress: boolean) => {
      dispatch({ type: "SET_MERGING_IN_PROGRESS", payload: inProgress });
    },

    onSetTranslationProgress: (
      progress: number,
      stage: string,
      error?: string
    ) => {
      dispatch({
        type: "SET_TRANSLATION_PROGRESS",
        payload: { progress, stage, error },
      });
    },

    onSetMergeProgress: (progress: number, stage: string, error?: string) => {
      dispatch({
        type: "SET_MERGE_PROGRESS",
        payload: { progress, stage, error },
      });
    },
  };
}
