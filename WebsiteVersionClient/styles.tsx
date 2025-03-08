import { css } from '@emotion/css';

// Form input styles
export const inputStyles = css`
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid #e9ecef;
  font-size: 0.95rem;
  transition: all 0.2s ease;
  width: 100%;
  max-width: 320px;
  background-color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);

  &:focus {
    outline: none;
    border-color: #4361ee;
    box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.15);
  }
`;

export const selectStyles = css`
  ${inputStyles}
  height: 42px;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236c757d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='6 9 12 15 18 9'%3E%3C/polygon%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 35px;
  appearance: none;
`;

export const fileInputWrapperStyles = css`
  margin-bottom: 16px;

  label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
  }
`;

export const containerStyles = css`
  margin-top: 20px;
`;

export const videoContainerStyles = css`
  position: sticky;
  top: 10px;
  z-index: 100;
  background-color: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(5px);
  padding: 10px;
  border-bottom: 1px solid rgba(238, 238, 238, 0.8);
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-height: 50vh;
  overflow: visible;
  transition: max-height 0.3s ease;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
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
`;

export const textAreaStyles = css`
  width: 100%;
  min-height: 80px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: #4361ee;
    box-shadow: 0 0 0 2px rgba(67, 97, 238, 0.15);
  }
`;

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
  white: '#ffffff'
};
