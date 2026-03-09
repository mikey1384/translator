import { css } from '@emotion/css';
import {
  colors,
  metaPillStyles,
  selectStyles,
  subtleSurfaceCardStyles,
} from '../../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../../components/design-system/tokens.js';

export const sidePanelShellStyles = css`
  ${subtleSurfaceCardStyles}
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: ${spacing.sm};
  background: rgba(12, 17, 27, 0.86);
  border-color: rgba(167, 183, 210, 0.22);
  padding: ${spacing.sm};
  height: 100%;
  overflow: auto;
`;

export const sidePanelSectionStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const sidePanelLabelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const sidePanelWarningStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.xs};
  padding: ${spacing.sm};
  border-radius: ${borderRadius.lg};
  border: 1px solid rgba(240, 180, 75, 0.3);
  background: rgba(240, 180, 75, 0.1);
  color: ${colors.text};
`;

export const sidePanelWarningIconStyles = css`
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  margin-top: 1px;
  border-radius: ${borderRadius.full};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.warning};
  background: rgba(240, 180, 75, 0.16);
`;

export const sidePanelWarningTextStyles = css`
  min-width: 0;
  color: ${colors.text};
  font-size: ${fontSize.xs};
  line-height: ${lineHeight.relaxed};
`;

export const sidePanelEmptyCopyStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  padding: ${spacing.sm};
`;

export const sidePanelDividerStyles = css`
  height: 1px;
  background: ${colors.border};
  margin: ${spacing.xs} 0;
`;

export const sidePanelTabsStyles = css`
  display: flex;
  gap: ${spacing.sm};
`;

export const sidePanelTabButtonStyles = (active: boolean) => css`
  ${metaPillStyles}
  cursor: pointer;
  justify-content: center;
  border-color: ${active
    ? 'rgba(125, 167, 255, 0.24)'
    : colors.border};
  background: ${active ? 'rgba(125, 167, 255, 0.12)' : 'rgba(255,255,255,0.03)'};
  color: ${active ? colors.text : colors.textDim};
`;

export const sidePanelListStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

export const sidePanelItemButtonStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  border-radius: ${borderRadius.lg};
  cursor: pointer;
  font-size: ${fontSize.sm};
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: ${colors.text};
  outline: none;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: ${colors.border};
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px rgba(125, 167, 255, 0.18);
  }
`;

export const sidePanelMetaRowStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  white-space: nowrap;
`;

export const sidePanelNewBadgeStyles = css`
  color: ${colors.warning};
  font-weight: ${fontWeight.bold};
`;

export const sidePanelButtonContentStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
`;

export const sidePanelSelectStyles = css`
  ${selectStyles}
  max-width: none;
  width: 100%;
  min-height: 44px;
  height: 44px;
  text-align: left;
`;

export const sidePanelFieldStackStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
`;

export const sidePanelButtonRowStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${spacing.sm};
`;

export const sidePanelActionRowStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const speedMenuStyles = (placement: 'up' | 'down') => css`
  ${subtleSurfaceCardStyles}
  position: absolute;
  right: 0;
  ${placement === 'down' ? `top: calc(100% + ${spacing.sm});` : `bottom: calc(100% + ${spacing.sm});`}
  list-style: none;
  margin: 0;
  padding: ${spacing.xs};
  z-index: 99999;
  min-width: 100px;
`;

export const speedMenuItemStyles = (active: boolean) => css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  border-radius: ${borderRadius.md};
  color: ${active ? colors.text : colors.textDim};
  font-weight: ${active ? fontWeight.semibold : fontWeight.normal};
  font-size: ${fontSize.xs};
  cursor: pointer;
  background: ${active ? 'rgba(125, 167, 255, 0.12)' : 'transparent'};

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: ${colors.text};
  }
`;

export const videoPlayerRootStyles = css`
  position: relative;
`;

export const videoPlayerWrapperStyles = css`
  min-width: 0;
  position: relative;
  height: 100%;
`;

export const videoPlayerCenterStateStyles = (
  tone: 'warning' | 'error' = 'warning'
) => css`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(640px, calc(100% - ${spacing['2xl']}));
  display: grid;
  gap: ${spacing.lg};
  padding: ${spacing.xl} ${spacing['2xl']};
  border-radius: ${borderRadius['2xl']};
  border: 1px solid
    ${tone === 'warning' ? 'rgba(240, 180, 75, 0.36)' : colors.danger};
  background: ${tone === 'warning'
    ? 'rgba(19, 22, 29, 0.96)'
    : 'rgba(24, 12, 16, 0.94)'};
  color: ${colors.text};
  box-shadow: 0 18px 42px rgba(4, 9, 18, 0.3);
  box-sizing: border-box;
`;

export const videoPlayerCenterStateHeaderStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.lg};
`;

export const videoPlayerCenterStateIconStyles = (
  tone: 'warning' | 'error' = 'warning'
) => css`
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: ${borderRadius.full};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${tone === 'warning' ? colors.warning : colors.danger};
  background: ${tone === 'warning'
    ? 'rgba(240, 180, 75, 0.16)'
    : 'rgba(255, 109, 114, 0.14)'};
`;

export const videoPlayerCenterStateCopyStyles = css`
  min-width: 0;
  display: grid;
  gap: ${spacing.xs};
`;

export const videoPlayerCenterStateTitleStyles = css`
  color: ${colors.text};
  font-size: ${fontSize.xl};
  font-weight: ${fontWeight.semibold};
  line-height: ${lineHeight.tight};
  letter-spacing: -0.02em;
`;

export const videoPlayerCenterStateBodyStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.md};
  line-height: ${lineHeight.relaxed};
`;

export const videoPlayerCenterStateHintStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  line-height: ${lineHeight.relaxed};
`;

export const videoPlayerCenterStateProgressTrackStyles = css`
  position: relative;
  height: 10px;
  overflow: hidden;
  border-radius: ${borderRadius.full};
  border: 1px solid rgba(240, 180, 75, 0.22);
  background: rgba(255, 255, 255, 0.06);
`;

export const videoPlayerCenterStateProgressFillStyles = css`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 38%;
  border-radius: ${borderRadius.full};
  background: linear-gradient(
    90deg,
    rgba(240, 180, 75, 0.18) 0%,
    rgba(240, 180, 75, 0.95) 48%,
    rgba(240, 180, 75, 0.18) 100%
  );
  animation: player-waiting-progress 1.8s ease-in-out infinite;

  @keyframes player-waiting-progress {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(310%);
    }
  }
`;

const overlayControlsBaseStyles = css`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 15px;
  opacity: var(--player-overlay-opacity, 0);
  transition: opacity 0.2s ease;
  pointer-events: none;

  &:hover {
    opacity: 1;
  }

  & > * {
    pointer-events: auto;
  }
`;

export const videoPlayerOverlayControlsStyles = (
  isFullScreen: boolean
) => css`
  ${overlayControlsBaseStyles}
  height: ${isFullScreen ? '100px' : '80px'};
  padding: 0 ${isFullScreen ? '40px' : '20px'};
  background: ${isFullScreen
    ? `linear-gradient(
        to top,
        rgba(0, 0, 0, 0.9) 0%,
        rgba(0, 0, 0, 0.7) 30%,
        transparent 100%
      )`
    : `linear-gradient(
        to top,
        rgba(0, 0, 0, 0.8) 0%,
        rgba(0, 0, 0, 0.5) 60%,
        transparent 100%
      )`};
`;

const playerSeekbarBaseStyles = css`
  width: 100%;
  cursor: pointer;
  appearance: none;
  background: linear-gradient(
    to right,
    ${colors.primary} 0%,
    ${colors.primary} var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) 100%
  );
  border-radius: 4px;
  outline: none;
  position: relative;
  z-index: 2;
  margin: 0;

  &::-webkit-slider-thumb {
    appearance: none;
    background: ${colors.surface};
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }

  &::-moz-range-thumb {
    background: ${colors.surface};
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }
`;

export const videoPlayerSeekbarStyles = (isFullScreen: boolean) => css`
  ${playerSeekbarBaseStyles}
  height: ${isFullScreen ? '12px' : '8px'};

  &::-webkit-slider-thumb {
    width: ${isFullScreen ? '24px' : '16px'};
    height: ${isFullScreen ? '24px' : '16px'};
  }

  &::-moz-range-thumb {
    width: ${isFullScreen ? '24px' : '16px'};
    height: ${isFullScreen ? '24px' : '16px'};
  }
`;

const videoPlayerTimeBaseStyles = css`
  font-family: monospace;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  text-align: center;
`;

export const videoPlayerTimeStyles = (isFullScreen: boolean) => css`
  ${videoPlayerTimeBaseStyles}
  font-size: ${isFullScreen ? '1.2rem' : '0.9rem'};
  min-width: ${isFullScreen ? '70px' : '50px'};
`;

const videoPlayerIconButtonBaseStyles = css`
  background: transparent !important;
  border: none !important;
  padding: 5px;
  color: white;
  cursor: pointer;

  &:hover {
    color: ${colors.primary};
  }
`;

export const videoPlayerIconButtonStyles = (isFullScreen: boolean) => css`
  ${videoPlayerIconButtonBaseStyles}

  svg {
    width: ${isFullScreen ? '32px' : '24px'};
    height: ${isFullScreen ? '32px' : '24px'};
  }
`;

const fixedVideoContainerBaseStyles = css`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background-color: rgba(20, 24, 33, 0.94);
  border: 1px solid ${colors.border};
  overflow: hidden;

  &:focus,
  &:focus-visible {
    outline: none;
    box-shadow: none;
  }

  &.cursor-off {
    cursor: none !important;
  }

  video {
    position: absolute;
    inset: 0;
    margin: auto;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }
`;

export const fixedVideoContainerStyles = (isFullScreen: boolean) => css`
  ${fixedVideoContainerBaseStyles}

  ${isFullScreen
    ? `
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        transform: none;
        padding: 0;
        border-radius: 0;
        z-index: 9999;
        background-color: black;
        display: flex;
        flex-direction: column;
        gap: 0;

        video {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
        }
      `
    : `
        width: calc(95% - 30px);
        height: 35vh;
        padding: 10px;
        border-radius: 0 0 8px 8px;
        margin-bottom: 0;
        display: grid;
        grid-template-columns: 28% 1fr 28%;
        grid-auto-rows: 1fr;
        column-gap: 12px;
        align-items: stretch;

        @media (max-height: 700px) {
          height: 30vh;
        }
      `}
`;

export const videoPlayerGrowStyles = css`
  flex-grow: 1;
`;

export const videoPlayerAnchorStyles = css`
  position: relative;
`;
