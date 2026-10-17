import type {
  StoredHighlightClip,
  StoredHighlightClipAspectMode,
  StoredHighlightClipKind,
} from '@shared-types/app';

export function recordHighlightClip(options: {
  sourceIdentity: string;
  kind: StoredHighlightClipKind;
  artifactKey: string;
  aspectMode: StoredHighlightClipAspectMode;
  videoPath: string;
}): Promise<{
  success: boolean;
  clip?: StoredHighlightClip;
  error?: string;
}> {
  return window.electron.recordHighlightClip(options);
}

export function listHighlightClips(options: {
  sourceIdentity: string;
}): Promise<{
  success: boolean;
  clips?: StoredHighlightClip[];
  error?: string;
}> {
  return window.electron.listHighlightClips(options);
}
