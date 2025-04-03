import React from 'react';
import { css } from '@emotion/css';

// Color similar to the logo text - REVERTING TO OFF-WHITE
const logoTextColor = '#FAF0E6'; // Linen color

// Adjusted styles for a smaller, header-like display
const logoContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center; // Center horizontally
  // Remove background properties for transparency
  // background-color: #000000;
  // padding: 5px 8px;
  // border-radius: 4px;
`;

const translatorTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif; // Font stack
  font-weight: 700; // Bold
  font-size: 1.1rem; // Smaller font size
  color: ${logoTextColor}; // Use off-white color
  margin: 0;
  line-height: 1.1;
  text-align: center; // Align text center
  // Use a theme color if available, e.g., from your styles.ts
  // color: colors.logoText || logoTextColor;
`;

const bylineTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif; // Font stack
  font-weight: 500; // Medium weight
  font-size: 0.7rem; // Smaller font size
  color: ${logoTextColor}; // Use off-white color
  margin: 0;
  margin-top: 2px; // Small gap
  line-height: 1;
  text-align: center; // Align text center
  // Use a theme color if available
  // color: colors.logoText || logoTextColor;
`;

export default function LogoDisplay() {
  return (
    <div className={logoContainerStyles}>
      <div className={translatorTextStyles}>translator</div>
      <div className={bylineTextStyles}>by stage_5</div>
    </div>
  );
}
