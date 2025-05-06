import { css } from '@emotion/css';

// Screen sizes for responsive design
export const breakpoints = {
  mobileMaxWidth: '576px',
  tabletMaxWidth: '768px',
  laptopMaxWidth: '992px',
  desktopMaxWidth: '1200px',
};

// Colors system - Dark Theme
export const colors = {
  primary: '#5876F5', // Brighter blue accent
  primaryLight: '#7B97FF',
  primaryDark: '#3A57D1',
  secondary: '#4A43C9', // Adjusted secondary accent
  success: '#4CE0B3', // Brighter teal/green
  info: '#5BC0DE', // Adjusted info blue
  warning: '#F7559A', // Adjusted pink/warning
  danger: '#E65E6A', // Adjusted red/danger
  light: '#1E1E1E', // Secondary dark background (e.g., cards, inputs on main bg)
  dark: '#F5F5F5', // Primary light text color
  gray: '#8A8A8A', // Medium gray for secondary text/elements
  grayLight: '#2A2A2A', // Surface color (slightly lighter than main bg)
  grayDark: '#E0E0E0', // Secondary light text color
  white: '#080808', // Darker main background
  border: '#333333', // Subtle border color
  text: '#eee',
  textDim: '#bbb',
  background: '#222',
  backgroundLight: '#333',
};

// Advanced gradient system - Removed for flat design
export const gradients = {};

// Shadow system - Removed for flat design
export const shadows = {
  sm: 'none',
  md: 'none',
  lg: 'none',
  xl: 'none',
  inner: 'none',
  button: 'none',
  buttonHover: 'none',
  section: 'none',
  sectionHover: 'none',
};

// Form input styles - Dark Theme
export const inputStyles = css`
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid ${colors.border};
  font-size: 0.95rem;
  transition: border-color 0.2s ease;
  width: 100%;
  max-width: 320px;
  background-color: ${colors.light};
  color: ${colors.dark};
  box-shadow: ${shadows.sm};
  box-sizing: border-box;
  line-height: 1.2;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: none;
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
  height: 40px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(
    colors.gray
  )}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='6 9 12 15 18 9'%3E%3C/polygon%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 35px;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  box-sizing: border-box;
  vertical-align: middle;
  width: auto;
  text-align: center;
  max-width: 320px;

  &:disabled {
    background-color: ${colors.grayLight};
    color: ${colors.gray};
    cursor: not-allowed;
    border-color: ${colors.border};
  }

  option {
    background-color: ${colors.light};
    color: ${colors.dark};
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
  margin-bottom: 16px;
  width: 100%;
  box-sizing: border-box;

  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    font-size: 0.95rem;
    color: ${colors.dark};
  }
`;

// Container Styles - No theme change needed usually
export const containerStyles = css`
  width: 100%;
  margin: 0 auto;
  padding: 1.5rem;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex-grow: 1;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: 1rem;
    max-width: 95%;
  }
`;

// Video Container - Dark Theme (adjust background/border)
export const videoContainerStyles = css`
  position: relative;
  z-index: 1;
  background-color: rgba(30, 30, 30, 0.9);
  backdrop-filter: blur(8px);
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
  transition: all 0.2s ease-out;
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
  font-size: 2.5rem;
  color: ${colors.dark};
  margin-bottom: 1.5rem;
  font-weight: 700;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    font-size: 2rem;
    margin-bottom: 1rem;
  }
`;

// Section Styles - Dark Theme
export const sectionStyles = css`
  background-color: ${colors.grayLight};
  border-radius: 8px;
  box-shadow: ${shadows.section};
  padding: 1.5rem;
  margin-bottom: 2rem;
  transition: none;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid ${colors.border};

  &:hover {
    box-shadow: ${shadows.sectionHover};
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: 1rem;
    margin-bottom: 1.5rem;
  }
`;

// Section Title - Dark Theme
export const sectionTitleStyles = css`
  font-size: 1.5rem;
  font-weight: 600;
  color: ${colors.dark};
  margin-top: 0;
  margin-bottom: 1.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid ${colors.border};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    font-size: 1.3rem;
    margin-bottom: 1rem;
  }
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
  background-color: ${colors.light};
  color: ${colors.dark};

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
  background-color: ${colors.light};
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
  background-image: linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.08) 25%,
    transparent 25%,
    transparent 50%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.08) 75%,
    transparent 75%,
    transparent
  );
  background-size: 30px 30px;
  animation: progress-bar-stripes 1s linear infinite;

  @keyframes progress-bar-stripes {
    from {
      background-position: 30px 0;
    }
    to {
      background-position: 0 0;
    }
  }
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
  background-color: ${colors.light};
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 0.875rem;
  box-shadow: ${shadows.inner};
  color: ${colors.dark};
  width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
`;

// General page wrapper - Dark Theme
export const pageWrapperStyles = css`
  background-color: ${colors.white};
  color: ${colors.dark};
  min-height: 100vh;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
`;

// Status Item - Dark Theme
export const statusItemStyles = css`
  padding: 1rem;
  background-color: ${colors.light};
  border-radius: 8px;
  box-shadow: ${shadows.sm};
  transition: none;
  border: 1px solid ${colors.border};

  &:hover {
    transform: none;
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
  color: ${colors.dark};
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
  color: ${colors.dark};
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
  background-color: ${colors.light};
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
  background-color: ${colors.light};
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
    transition: all 0.2s ease;
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

// Add new animation styles from checklist
export const strikeFade = css`
  color: ${colors.danger};
  text-decoration: line-through;
  opacity: 1;
  animation: strikeOutKey 300ms forwards;
  pointer-events: none;
`;

// Define keyframes globally
export const globalAnimations = css`
  @keyframes fadeInKey {
    0% {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes flashHighlightKey {
    0% {
      background: rgba(253, 216, 53, 0.7);
    }
    70% {
      background: rgba(253, 216, 53, 0.2);
    }
    100% {
      background: transparent;
    }
  }

  @keyframes strikeOutKey {
    to {
      opacity: 0;
      transform: translateX(-8px);
    }
  }

  .highlight-subtitle {
    background: transparent;
    animation: flashHighlightKey 450ms ease-in-out;
    outline: 2px solid #fdd835;
  }
`;

export const fadeIn = css`
  opacity: 0;
  animation: fadeInKey 0.3s forwards;
`;

export const dummyKey = css`
  animation: fadeInKey 0s;
`;
