import { createContext, useContext } from 'react';

// 'overlay' is the classic fixed card at the top of the window. Inside the
// video workspace the same progress areas render as one calm inline status
// row under the video instead.
export type ProgressPresentation = 'overlay' | 'inline';

export const ProgressPresentationContext =
  createContext<ProgressPresentation>('overlay');

export function useProgressPresentation(): ProgressPresentation {
  return useContext(ProgressPresentationContext);
}
