import { css } from '@emotion/css';

// Screen sizes for responsive design
export const breakpoints = {
  mobileMaxWidth: '576px',
  tabletMaxWidth: '768px',
  laptopMaxWidth: '992px',
  desktopMaxWidth: '1200px',
};

// Colors system
export const colors = {
  primary: '#4361ee',
  primaryLight: '#4895ef',
  primaryDark: '#3a0ca3',
  secondary: '#3f37c9',
  success: '#4cc9f0',
  info: '#4895ef',
  warning: '#f72585',
  danger: '#e63946',
  light: '#f8f9fa',
  dark: '#212529',
  gray: '#6c757d',
  grayLight: '#f1f3f5',
  grayDark: '#343a40',
  white: '#ffffff',
};

// Advanced gradient system
export const gradients = {
  primary: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
  secondary: `linear-gradient(135deg, ${colors.secondary} 0%, ${colors.primaryDark} 100%)`,
  success: `linear-gradient(135deg, ${colors.success} 0%, #06d6a0 100%)`,
  danger: `linear-gradient(135deg, ${colors.danger} 0%, #f94144 100%)`,
  warning: `linear-gradient(135deg, ${colors.warning} 0%, #ff3d7f 100%)`,
  info: `linear-gradient(135deg, ${colors.info} 0%, #16b9ef 100%)`,
};

// Shadow system
export const shadows = {
  sm: '0 2px 4px rgba(0, 0, 0, 0.08)',
  md: '0 4px 8px rgba(0, 0, 0, 0.12)',
  lg: '0 8px 16px rgba(0, 0, 0, 0.15)',
  xl: '0 12px 20px rgba(0, 0, 0, 0.18)',
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.06)',
  button: '0 4px 10px rgba(67, 97, 238, 0.3)',
  buttonHover: '0 6px 15px rgba(67, 97, 238, 0.4)',
  section: '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)',
  sectionHover: '0 4px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.08)',
};

// Form input styles
export const inputStyles = css`
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid #e9ecef;
  font-size: 0.95rem;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  width: 100%;
  max-width: 320px;
  background-color: white;
  box-shadow: ${shadows.sm};
  box-sizing: border-box;
  line-height: 1.2;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.15);
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    max-width: 100%;
  }
`;

export const selectStyles = css`
  ${inputStyles}
  height: 40px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236c757d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='6 9 12 15 18 9'%3E%3C/polygon%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 35px;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  box-sizing: border-box;
  vertical-align: middle;
  width: 100%;
  max-width: 320px;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    max-width: 100%;
    width: 100%;
  }

  /* Fix for dropdown menu width in various browsers */
  &::-ms-expand {
    display: none;
  }

  /* Fix for Chrome/Safari/Firefox */
  option {
    width: auto;
    max-width: none;
  }
`;

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

export const containerStyles = css`
  max-width: 90%;
  width: 100%;
  margin: 0 auto;
  padding: 1.5rem;
  box-sizing: border-box;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: 1rem;
    max-width: 95%;
  }
`;

export const videoContainerStyles = css`
  position: relative;
  z-index: 1;
  background-color: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid rgba(238, 238, 238, 0.9);
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-height: 60vh;
  overflow: visible;
  transition: all 0.2s ease-out;
  box-shadow: ${shadows.md};

  /* Ensure the player isn't too tall on small screens */
  @media (max-height: 700px) {
    max-height: 40vh;
    padding: 10px;
  }

  /* On very small screens, reduce size further */
  @media (max-height: 500px) {
    max-height: 30vh;
  }
`;

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

export const sectionStyles = css`
  background-color: ${colors.white};
  border-radius: 8px;
  box-shadow: ${shadows.section};
  padding: 1.5rem;
  margin-bottom: 2rem;
  transition:
    box-shadow 0.3s ease,
    transform 0.3s ease;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;

  &:hover {
    box-shadow: ${shadows.sectionHover};
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: 1rem;
    margin-bottom: 1.5rem;
  }
`;

export const sectionTitleStyles = css`
  font-size: 1.5rem;
  font-weight: 600;
  color: ${colors.dark};
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid #dee2e6;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    font-size: 1.25rem;
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
  }
`;

export const textAreaStyles = css`
  width: 100%;
  min-height: 80px;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  resize: vertical;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);

  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px rgba(67, 97, 238, 0.15);
  }
`;

export const progressBarStyles = css`
  width: 100%;
  height: 8px;
  background-color: ${colors.grayLight};
  border-radius: 4px;
  overflow: hidden;
  margin: 1rem 0;
  box-shadow: ${shadows.inner};
`;

export const progressBarFillStyles = (progress: number) => css`
  height: 100%;
  width: ${progress}%;
  background: ${gradients.primary};
  border-radius: 4px;
  transition: width 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
`;

export const progressStageStyles = css`
  font-size: 0.875rem;
  color: ${colors.gray};
  margin-bottom: 0.5rem;
  font-weight: 500;
`;

export const resultsAreaStyles = css`
  margin-top: 1rem;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 1rem;
  background-color: ${colors.grayLight};
  max-height: 300px;
  overflow-y: auto;
  font-family: monospace;
  white-space: pre-wrap;
  font-size: 0.875rem;
  box-shadow: ${shadows.inner};
  width: 100%;
  box-sizing: border-box;
  overflow-x: auto;
`;

export const pageWrapperStyles = css`
  min-height: 100vh;
  background-color: ${colors.grayLight};
  padding: 1rem 0;
  box-sizing: border-box;
  width: 100%;
  overflow-x: hidden;
`;

export const statusItemStyles = css`
  padding: 1rem;
  background-color: ${colors.white};
  border-radius: 8px;
  box-shadow: ${shadows.sm};
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: ${shadows.md};
  }
`;

export const statusGridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    grid-template-columns: 1fr;
  }
`;

export const statusLabelStyles = css`
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: ${colors.grayDark};
`;

export const formGroupStyles = css`
  margin-bottom: 1.5rem;
  width: 100%;
  box-sizing: border-box;
`;

export const formLabelStyles = css`
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: ${colors.dark};
`;

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

export const errorMessageStyles = css`
  background-color: ${colors.danger};
  color: white;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  box-shadow: ${shadows.sm};
  width: 100%;
  box-sizing: border-box;
  word-break: break-word;
`;

export const resultsHeaderStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: ${colors.dark};
`;

export const statusIndicatorStyles = (status: boolean) => css`
  display: inline-flex;
  align-items: center;

  &::before {
    content: '';
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: ${status ? colors.success : colors.danger};
    margin-right: 8px;
    box-shadow: 0 0 0 2px
      ${status ? 'rgba(76, 201, 240, 0.3)' : 'rgba(230, 57, 70, 0.3)'};
  }
`;

export const timestampStyles = css`
  margin-top: 5px;
  font-size: 14px;
  font-family: monospace;
  background-color: rgba(248, 249, 250, 0.7);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(222, 226, 230, 0.7);
  display: inline-block;
`;

export const controlsStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;

  h3 {
    margin: 0;
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
`;
