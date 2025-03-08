import { css } from "@emotion/css";

// Colors system
export const colors = {
  primary: "#4361ee",
  primaryLight: "#4895ef",
  primaryDark: "#3a0ca3",
  secondary: "#3f37c9",
  success: "#4cc9f0",
  info: "#4895ef",
  warning: "#f72585",
  danger: "#e63946",
  light: "#f8f9fa",
  dark: "#212529",
  gray: "#6c757d",
  grayLight: "#f1f3f5",
  grayDark: "#343a40",
  white: "#ffffff",
};

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
    border-color: ${colors.primary};
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
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  padding: 2rem;
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

export const titleStyles = css`
  font-size: 2.5rem;
  color: ${colors.dark};
  margin-bottom: 1.5rem;
  font-weight: 700;
`;

export const sectionStyles = css`
  background-color: ${colors.white};
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  padding: 1.5rem;
  margin-bottom: 2rem;
`;

export const sectionTitleStyles = css`
  font-size: 1.25rem;
  font-weight: 600;
  color: ${colors.dark};
  margin-bottom: 1rem;
  display: flex;
  align-items: center;

  &::before {
    content: "";
    display: inline-block;
    width: 4px;
    height: 18px;
    background: linear-gradient(
      135deg,
      ${colors.primary} 0%,
      ${colors.primaryDark} 100%
    );
    margin-right: 10px;
    border-radius: 2px;
  }
`;

export const progressBarStyles = css`
  width: 100%;
  height: 8px;
  background-color: ${colors.grayLight};
  border-radius: 4px;
  overflow: hidden;
  margin: 1rem 0;
`;

export const progressBarFillStyles = (progress: number) => css`
  height: 100%;
  width: ${progress}%;
  background: linear-gradient(
    90deg,
    ${colors.primaryLight} 0%,
    ${colors.primary} 100%
  );
  border-radius: 4px;
  transition: width 0.3s ease;
`;

export const progressStageStyles = css`
  font-size: 0.875rem;
  color: ${colors.gray};
  margin-bottom: 0.5rem;
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
`;

export const pageWrapperStyles = css`
  min-height: 100vh;
  background-color: ${colors.grayLight};
  padding: 1rem 0;
`;

export const statusItemStyles = css`
  padding: 1rem;
  background-color: ${colors.grayLight};
  border-radius: 8px;
`;

export const statusGridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
`;

export const statusLabelStyles = css`
  font-weight: 500;
  margin-bottom: 0.5rem;
`;

export const formGroupStyles = css`
  margin-bottom: 1.5rem;
`;

export const formLabelStyles = css`
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
`;

export const formRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
`;

export const actionButtonsStyles = css`
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
`;

export const errorMessageStyles = css`
  background-color: ${colors.danger};
  color: white;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
`;

export const resultsHeaderStyles = css`
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
`;

export const statusIndicatorStyles = (status: boolean) => css`
  display: inline-flex;
  align-items: center;

  &::before {
    content: "";
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: ${status ? colors.success : colors.danger};
    margin-right: 8px;
    box-shadow: 0 0 0 2px
      ${status ? "rgba(76, 201, 240, 0.3)" : "rgba(230, 57, 70, 0.3)"};
  }
`;
