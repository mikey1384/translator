import { css } from '@emotion/css';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  shadows as tokenShadows,
  spacing,
  transitions,
} from './components/design-system/tokens.js';

// Screen sizes for responsive design
export const breakpoints = {
  mobileMaxWidth: '576px',
  tabletMaxWidth: '768px',
  laptopMaxWidth: '992px',
  desktopMaxWidth: '1200px',
};

// Colors system
export const colors = {
  primary: '#7da7ff',
  primaryLight: '#abc8ff',
  primaryDark: '#5d83de',
  secondary: '#62d0c4',
  success: '#39c887',
  info: '#57b6da',
  warning: '#f0b44b',
  danger: '#ff6d72',
  text: '#edf2fb',
  textDim: '#9aa8bd',
  surface: '#141b26',
  surfaceRaised: '#192231',
  surfaceSoft: '#101723',
  bg: '#090d14',
  gray: '#7f8ca3',
  grayLight: '#1b2432',
  grayMedium: '#4f5f78',
  grayDark: '#d7e0ee',
  muted: '#b6c1d2',
  border: 'rgba(150, 165, 191, 0.18)',
  borderStrong: 'rgba(167, 183, 210, 0.3)',
  overlay: 'rgba(6, 10, 17, 0.72)',
  // Progress bars
  progressDownload: '#FCBF49',
  progressMerge: '#F7559A',
  progressTranslate: '#5876F5',
  progressDub: '#FF8C42',
};

export const gradients = {
  page: `
    radial-gradient(circle at top left, rgba(125, 167, 255, 0.18), transparent 32%),
    radial-gradient(circle at top right, rgba(98, 208, 196, 0.08), transparent 26%),
    linear-gradient(180deg, #0b1019 0%, ${colors.bg} 100%)
  `,
  surface: `
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0)),
    ${colors.grayLight}
  `,
  surfaceRaised: `
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
    ${colors.surface}
  `,
};

export const shadows = {
  sm: tokenShadows.sm,
  md: tokenShadows.md,
  lg: '0 12px 28px rgba(4, 9, 18, 0.22)',
  xl: '0 18px 36px rgba(4, 9, 18, 0.28)',
  inner: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
  button: '0 10px 22px rgba(13, 28, 56, 0.26)',
  buttonHover: '0 16px 32px rgba(13, 28, 56, 0.32)',
  section: '0 10px 24px rgba(5, 10, 19, 0.2)',
  sectionHover: '0 14px 28px rgba(5, 10, 19, 0.24)',
};

// Form input styles - Dark Theme
export const inputStyles = css`
  padding: 0.75rem 0.95rem;
  min-height: 44px;
  border-radius: ${borderRadius.lg};
  border: 1px solid ${colors.border};
  font-size: ${fontSize.md};
  transition:
    border-color ${transitions.fast},
    box-shadow ${transitions.fast},
    background-color ${transitions.fast};
  width: 100%;
  max-width: 320px;
  background: ${gradients.surfaceRaised};
  color: ${colors.text};
  box-shadow: ${shadows.sm};
  box-sizing: border-box;
  line-height: ${lineHeight.normal};

  &:focus {
    outline: none;
    border-color: ${colors.primaryLight};
    box-shadow:
      ${shadows.sm},
      0 0 0 3px rgba(125, 167, 255, 0.16);
  }

  &::placeholder {
    color: ${colors.gray};
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    max-width: 100%;
  }
`;

// Select styles - Dark Theme
export const selectStyles = css`
  ${inputStyles}
  min-height: 44px;
  height: 44px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(
    colors.gray
  )}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='6 9 12 15 18 9'%3E%3C/polygon%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding: 0 40px 0 0.95rem;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  box-sizing: border-box;
  vertical-align: middle;
  width: auto;
  line-height: 1.2;
  text-align: left;
  max-width: 320px;

  &:disabled {
    background-color: ${colors.grayLight};
    color: ${colors.gray};
    cursor: not-allowed;
    border-color: ${colors.border};
  }

  option {
    background-color: ${colors.surface};
    color: ${colors.text};
    width: auto;
    max-width: none;
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    max-width: 100%;
    width: 100%;
  }

  &::-ms-expand {
    display: none;
  }
`;

// File Input Wrapper - Dark Theme
export const fileInputWrapperStyles = css`
  margin-bottom: ${spacing.lg};
  width: 100%;
  box-sizing: border-box;

  label {
    display: block;
    margin-bottom: ${spacing.sm};
    font-weight: ${fontWeight.medium};
    font-size: ${fontSize.sm};
    color: ${colors.text};
  }
`;

export const containerStyles = css`
  width: 100%;
  max-width: 1240px;
  margin: 0 auto;
  padding: ${spacing['3xl']} ${spacing['2xl']} ${spacing['5xl']};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
  flex-grow: 1;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.xl} ${spacing.lg} ${spacing['3xl']};
  }
`;

// Video Container - Dark Theme (adjust background/border)
export const videoContainerStyles = css`
  position: relative;
  z-index: 1;
  background-color: rgba(30, 30, 30, 0.9);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid ${colors.border};
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-height: 60vh;
  overflow: visible;
  box-shadow: ${shadows.md};

  @media (max-height: 700px) {
    max-height: 40vh;
    padding: 10px;
  }

  @media (max-height: 500px) {
    max-height: 30vh;
  }
`;

// Title Styles - Dark Theme
export const titleStyles = css`
  font-size: clamp(2.25rem, 4vw, 3.35rem);
  color: ${colors.text};
  margin-bottom: ${spacing.xl};
  font-weight: ${fontWeight.bold};
  line-height: 1.02;
  letter-spacing: -0.04em;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    margin-bottom: ${spacing.lg};
  }
`;

export const sectionStyles = css`
  background: ${gradients.surface};
  border-radius: ${borderRadius['2xl']};
  box-shadow: ${shadows.section};
  padding: ${spacing['2xl']};
  margin-bottom: ${spacing['3xl']};
  transition:
    box-shadow ${transitions.fast},
    border-color ${transitions.normal};
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid ${colors.border};
  position: relative;

  &:hover {
    box-shadow: ${shadows.sectionHover};
    border-color: ${colors.borderStrong};
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.xl};
    margin-bottom: ${spacing['2xl']};
  }
`;

export const sectionTitleStyles = css`
  font-size: clamp(1.25rem, 2vw, 1.6rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  margin-top: 0;
  margin-bottom: ${spacing.lg};
  letter-spacing: -0.02em;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    margin-bottom: ${spacing.md};
  }
`;

export const shellHeaderBlockStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  max-width: 760px;
  margin: 0 auto ${spacing.xl};
  text-align: center;
`;

export const shellEyebrowStyles = css`
  display: inline-flex;
  align-self: center;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.xs} ${spacing.md};
  border-radius: ${borderRadius.full};
  border: 1px solid rgba(125, 167, 255, 0.22);
  background: rgba(125, 167, 255, 0.08);
  color: ${colors.primaryLight};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

export const shellTitleStyles = css`
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: ${fontWeight.bold};
  line-height: 1.02;
  letter-spacing: -0.04em;
  margin: 0;
  color: ${colors.text};
`;

export const shellBodyStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.md};
  line-height: ${lineHeight.relaxed};
`;

export const surfaceCardStyles = css`
  background: ${gradients.surface};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius['2xl']};
  box-shadow: ${shadows.sm};
  position: relative;
`;

export const subtleSurfaceCardStyles = css`
  background: ${gradients.surfaceRaised};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.xl};
  box-shadow: ${shadows.sm};
`;

export const metaPillStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  padding: ${spacing.xs} ${spacing.md};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.medium};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

// Text Area Styles - Dark Theme
export const textAreaStyles = css`
  width: 100%;
  min-height: 80px;
  padding: 10px 14px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
  transition: border-color 0.2s ease;
  background-color: ${colors.surface};
  color: ${colors.text};

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: none;
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

// Progress Bar Background - Dark Theme
export const progressBarBackgroundStyles = css`
  height: 12px;
  background-color: ${colors.surface};
  border-radius: 6px;
  overflow: hidden;
  margin: 8px 0;
  border: 1px solid ${colors.border};
`;

// Progress Bar Fill - Dark Theme (adjusted stripe visibility)
export const progressBarFillStyles = (progress: number) => css`
  height: 100%;
  width: ${progress}%;
  background-color: ${colors.primary};
  border-radius: 6px 0 0 6px;
  transition: width 0.3s ease-in-out;
`;

// Progress Stage - Dark Theme
export const progressStageStyles = css`
  font-size: 0.875rem;
  color: ${colors.grayDark};
  margin-bottom: 0.5rem;
  font-weight: 500;
`;

// Results Area - Dark Theme
export const resultsAreaStyles = css`
  margin-top: 1rem;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  padding: 1rem;
  background-color: ${colors.surface};
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 0.875rem;
  box-shadow: ${shadows.inner};
  color: ${colors.text};
  width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
`;

// General page wrapper - Dark Theme
export const pageWrapperStyles = css`
  background: ${gradients.page};
  color: ${colors.text};
  min-height: 100vh;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
`;

// Status Item - Dark Theme
export const statusItemStyles = css`
  padding: ${spacing.xl};
  background: ${gradients.surfaceRaised};
  border-radius: ${borderRadius.xl};
  box-shadow: ${shadows.sm};
  transition: box-shadow ${transitions.fast};
  border: 1px solid ${colors.border};

  &:hover {
    box-shadow: ${shadows.md};
  }
`;

// Status Grid - No theme change needed
export const statusGridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    grid-template-columns: 1fr;
  }
`;

// Status Label - Dark Theme
export const statusLabelStyles = css`
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: ${colors.grayDark};
`;

// Form Group - No theme change needed
export const formGroupStyles = css`
  margin-bottom: 1.5rem;
  width: 100%;
  box-sizing: border-box;
`;

// Form Label - Dark Theme
export const formLabelStyles = css`
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: ${colors.text};
`;

// Form Row - No theme change needed
export const formRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;

    > * {
      width: 100%;
    }
  }
`;

// Action Buttons - No theme change needed
export const actionButtonsStyles = css`
  display: flex;
  gap: 1rem;
  margin-top: 1rem;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    width: 100%;

    button {
      width: 100%;
    }
  }
`;

// Error message styles - Dark Theme
export const errorMessageStyles = css`
  background-color: rgba(230, 94, 106, 0.15);
  color: ${colors.danger};
  border: 1px solid ${colors.danger};
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 0.95rem;
  font-weight: 500;
`;

// Results Header - Dark Theme
export const resultsHeaderStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: ${colors.text};
`;

// Key Status Indicators - Dark Theme
export const statusIndicatorStyles = (status: boolean) => css`
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  margin-left: 12px;
  vertical-align: middle;
  border: 1px solid ${status ? colors.success : colors.danger};
  background-color: ${status
    ? 'rgba(76, 201, 176, 0.1)'
    : 'rgba(230, 94, 106, 0.1)'};
  color: ${status ? colors.success : colors.danger};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

// Status Loading - Dark Theme
export const statusLoadingStyles = css`
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  margin-left: 12px;
  vertical-align: middle;
  border: 1px solid ${colors.gray};
  background-color: rgba(138, 138, 138, 0.1);
  color: ${colors.gray};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

// Timestamp Styles - Dark Theme
export const timestampStyles = css`
  margin-top: 5px;
  font-size: 14px;
  font-family: monospace;
  background-color: ${colors.surface};
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid ${colors.border};
  color: ${colors.grayDark};
  display: inline-block;
`;

// Controls Styles - Dark Theme
export const controlsStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1rem;
  background-color: ${colors.surface};
  padding: 0.75rem;
  border-radius: 6px;
  border: 1px solid ${colors.border};
`;

// Link Styles - Dark Theme
export const linkStyles = css`
  color: ${colors.primary};
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s ease;

  &:hover {
    color: ${colors.primaryLight};
    text-decoration: underline;
  }
`;

export const buttonGradientStyles = {
  base: css`
    position: relative;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition:
      box-shadow 0.15s ease,
      background-color 0.15s ease,
      border-color 0.15s ease;
    color: white !important;

    &:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      color: white !important;
    }

    &:active:not(:disabled) {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      color: white !important;
    }

    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      color: rgba(255, 255, 255, 0.9) !important;
    }
  `,
  primary: css`
    background: linear-gradient(
      135deg,
      rgba(0, 123, 255, 0.9),
      rgba(0, 80, 188, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(0, 143, 255, 0.95),
        rgba(0, 103, 204, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(0, 123, 255, 0.6),
        rgba(0, 80, 188, 0.6)
      ) !important;
    }
  `,
  success: css`
    background: linear-gradient(
      135deg,
      rgba(40, 167, 69, 0.9),
      rgba(30, 126, 52, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(50, 187, 79, 0.95),
        rgba(40, 146, 62, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(40, 167, 69, 0.6),
        rgba(30, 126, 52, 0.6)
      ) !important;
    }
  `,
  danger: css`
    background: linear-gradient(
      135deg,
      rgba(220, 53, 69, 0.9),
      rgba(189, 33, 48, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(240, 73, 89, 0.95),
        rgba(209, 53, 68, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(220, 53, 69, 0.6),
        rgba(189, 33, 48, 0.6)
      ) !important;
    }
  `,
  purple: css`
    background: linear-gradient(
      135deg,
      rgba(130, 71, 229, 0.9),
      rgba(91, 31, 193, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(150, 91, 249, 0.95),
        rgba(111, 51, 213, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(130, 71, 229, 0.6),
        rgba(91, 31, 193, 0.6)
      ) !important;
    }
  `,
};

export const mergeButtonStyles = css`
  ${buttonGradientStyles.base}
  ${buttonGradientStyles.purple}
`;

// Tasteful, dark-theme friendly accent button
export const subtleAccentButton = css`
  position: relative;
  color: ${colors.text} !important;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(0, 0, 0, 0.12)),
    rgba(28, 28, 28, 0.85);
  /* Always show a faint blue edge */
  border: 1px solid ${colors.primary}2A; /* subtle blue trace */
  border-radius: 10px;
  padding: 10px 16px;
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 2px ${colors.primary}14; /* faint outer ring */
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;

  &:hover:not(:disabled) {
    border-color: ${colors.primary};
    box-shadow:
      0 4px 14px rgba(0, 0, 0, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.06),
      0 0 0 4px ${colors.primary}33; /* stronger glow */
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 4px ${colors.primary}33;
  }
`;

export const noMarginStyle = css`
  margin-bottom: 0;
`;

export const noPaddingStyle = css`
  padding: 0;
`;

export const noShadowStyle = css`
  box-shadow: none;
  &:hover {
    box-shadow: none;
  }
`;

export const overflowVisibleStyle = css`
  overflow: visible;
`;

export const fadeIn = css`
  opacity: 0;
  animation: fadeInKey 0.3s forwards;
`;

export const dummyKey = css`
  animation: fadeInKey 0s;
`;
