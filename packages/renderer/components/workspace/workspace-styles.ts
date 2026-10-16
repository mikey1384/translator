import { css, keyframes } from '@emotion/css';
import { colors, fonts } from '../../styles';

const pulse = keyframes`
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
`;

const rise = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
`;

const flip = keyframes`
  0% { opacity: 0; transform: rotateX(-70deg); }
  100% { opacity: 1; transform: none; }
`;

// Two columns on wide windows: the video stays in view on the left while the
// subtitles scroll on the right; "All tools" spans the full width below.
export const workspaceGridStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  grid-template-areas:
    'video subshead'
    'video subs'
    'toolsvideo toolsvideo'
    'tools tools';
  grid-template-rows: auto 1fr auto auto;
  column-gap: 24px;
  row-gap: 12px;
  align-items: start;
  margin-bottom: 24px;

  @media (max-width: 980px) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'video' 'subshead' 'subs' 'toolsvideo' 'tools';
    grid-template-rows: auto;
  }
`;

export const workspaceVideoColumnStyles = css`
  grid-area: video;
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;

  @media (max-width: 980px) {
    position: relative;
    top: 0;
  }
`;

export const workspaceSubsHeadStyles = css`
  grid-area: subshead;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

export const workspaceSubsTitleStyles = css`
  margin: 0;
  font-family: ${fonts.display};
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: ${colors.text};
`;

export const workspaceSubsAreaStyles = css`
  grid-area: subs;
  min-width: 0;
`;

export const workspaceToolsAreaStyles = css`
  grid-area: tools;
  min-width: 0;
`;

export const workspaceToolsVideoAreaStyles = css`
  grid-area: toolsvideo;
  min-width: 0;
  padding-top: 12px;
  border-top: 1px solid ${colors.border};

  .workspace-tools-video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    align-items: start;
  }
`;

export const workspaceSubsTitleCountStyles = css`
  margin-left: 10px;
  font-family: ${fonts.body};
  font-size: 0.9rem;
  font-weight: 500;
  color: ${colors.gray};
  letter-spacing: 0;
`;

export const workspaceToolsHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 12px;
`;

export const workspaceEditSwitchStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 0.92rem;
  color: ${colors.textDim};
  cursor: pointer;
  user-select: none;

  input {
    appearance: none;
    width: 38px;
    height: 22px;
    border-radius: 11px;
    background: ${colors.grayMedium};
    position: relative;
    cursor: pointer;
    transition: background 0.15s ease;
    margin: 0;
  }

  input::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 8px;
    background: ${colors.text};
    transition: transform 0.15s ease;
  }

  input:checked {
    background: ${colors.primary};
  }

  input:checked::after {
    transform: translateX(16px);
    background: ${colors.onPrimary};
  }

  input:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

// Read-only synced subtitle list.
export const readListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: calc(100vh - 190px);
  min-height: 240px;
  overflow-y: auto;
  padding-right: 4px;
  scroll-behavior: smooth;

  @media (max-width: 980px) {
    max-height: 60vh;
  }
`;

export const readRowStyles = css`
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  column-gap: 10px;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  border-radius: 14px;
  background: ${colors.surfaceSoft};
  border: 1px solid ${colors.border};
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
  /* Off-screen rows skip rendering, so long videos stay fast. */
  content-visibility: auto;
  contain-intrinsic-size: auto 72px;

  &:hover {
    border-color: ${colors.borderStrong};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }

  &[data-active='true'] {
    border-color: ${colors.primary};
    background: ${colors.surface};
  }

  &[data-reveal='true'] {
    animation: ${rise} 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
`;

export const readTimeStyles = css`
  font-family: ${fonts.mono};
  font-size: 0.75rem;
  color: ${colors.gray};
  padding-top: 3px;
`;

export const readOriginalStyles = (dimmed: boolean) => css`
  font-size: 0.95rem;
  line-height: 1.45;
  color: ${dimmed ? colors.gray : colors.text};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

export const readTranslationStyles = css`
  margin-top: 4px;
  font-size: 1.05rem;
  line-height: 1.45;
  font-weight: 600;
  color: ${colors.primary};
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  transform-origin: top center;

  &[data-fresh='true'] {
    animation: ${flip} 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
`;

export const readEmptyStyles = css`
  padding: 28px 20px;
  border-radius: 18px;
  border: 1px dashed ${colors.borderStrong};
  color: ${colors.textDim};
  font-size: 0.95rem;
  line-height: 1.5;
  text-align: center;
`;

// Action bar under the video.
export const actionBarStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`;

export const actionPrimaryStyles = css`
  flex: 1 1 260px;
`;

export const moreMenuAnchorStyles = css`
  position: relative;
`;

export const moreMenuStyles = css`
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 200;
  min-width: 240px;
  max-width: calc(100vw - 32px);
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 6px;
  border-radius: 16px;
  background: ${colors.surfaceRaised};
  border: 1px solid ${colors.borderStrong};
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
`;

export const moreMenuItemStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: ${colors.text};
  font: inherit;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: ${colors.grayLight};
    outline: none;
  }

  &:disabled {
    color: ${colors.gray};
    cursor: default;
    background: transparent;
  }

  svg {
    width: 17px;
    height: 17px;
    color: ${colors.textDim};
    flex: none;
  }
`;

export const moreMenuDividerStyles = css`
  height: 1px;
  margin: 4px 6px;
  background: ${colors.border};
`;

// Placeholder when only subtitles are mounted.
export const noVideoStyles = css`
  aspect-ratio: 16 / 9;
  border-radius: 20px;
  border: 1px dashed ${colors.borderStrong};
  background: ${colors.surfaceSoft};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: ${colors.textDim};
`;

export const noVideoTitleStyles = css`
  font-family: ${fonts.display};
  font-size: 1.3rem;
  font-weight: 700;
  color: ${colors.text};
`;

// Inline status row (ProgressArea in the workspace).
export const inlineStatusBarStyles = css`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 16px;
  background: ${colors.surface};
  border: 1px solid ${colors.border};
`;

export const inlineStatusRowStyles = css`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

export const inlineStatusActivityStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  flex: none;

  i {
    display: block;
    width: 4px;
    height: 18px;
    border-radius: 2px;
    background: ${colors.primary};
    transform-origin: center;
    animation: ${pulse} 1s ease-in-out infinite;
  }

  i:nth-of-type(2) {
    animation-delay: 0.15s;
  }

  i:nth-of-type(3) {
    animation-delay: 0.3s;
  }

  i:nth-of-type(4) {
    animation-delay: 0.45s;
  }

  @media (prefers-reduced-motion: reduce) {
    i {
      animation: none;
    }
  }
`;

export const inlineStatusMainStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 10px;
  row-gap: 2px;
  min-width: 0;
  flex: 1;
`;

export const inlineStatusTitleStyles = css`
  font-weight: 600;
  font-size: 0.98rem;
  color: ${colors.text};
`;

export const inlineStatusStageStyles = css`
  margin: 0;
  font-size: 0.88rem;
  color: ${colors.textDim};
  overflow-wrap: anywhere;
`;

export const inlineStatusMetaStyles = css`
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  color: ${colors.textDim};
  flex: none;
`;

export const inlineStatusCancelStyles = css`
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 16px;
  border: 1px solid ${colors.borderStrong};
  background: transparent;
  color: ${colors.textDim};
  font-size: 1rem;
  cursor: pointer;

  &:hover {
    color: ${colors.text};
    border-color: ${colors.text};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export const inlineStatusTrackStyles = css`
  height: 6px;
  border-radius: 3px;
  background: ${colors.grayMedium};
  overflow: hidden;
`;

export const inlineStatusFillStyles = (color: string, progress: number) => css`
  height: 100%;
  width: ${Math.max(0, Math.min(progress, 100))}%;
  background: ${color};
  border-radius: 3px;
  transition: width 0.3s ease;
`;

export const idleStatusStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 16px;
  background: ${colors.surface};
  border: 1px solid ${colors.border};
  font-size: 0.92rem;
  color: ${colors.textDim};

  strong {
    color: ${colors.text};
    font-weight: 600;
  }
`;

export const idleDotStyles = (color: string) => css`
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: ${color};
  flex: none;
`;

export const exportSheetBodyStyles = css`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
