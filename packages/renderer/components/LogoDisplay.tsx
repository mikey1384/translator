import { css } from '@emotion/css';

const logoContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const translatorTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  color: white !important;
  margin: 0;
  line-height: 1.1;
  text-align: center;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  background: transparent;
  text-shadow:
    0 0 1px rgba(255, 255, 255, 0.8),
    0 0 2px rgba(255, 255, 255, 0.3);
  filter: contrast(1.2) brightness(1.1);
  font-display: swap;
`;

const bylineTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif;
  font-weight: 500;
  font-size: 0.7rem;
  color: white !important;
  margin: 0;
  margin-top: 2px;
  line-height: 1;
  text-align: center;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  background: transparent;
  text-shadow:
    0 0 1px rgba(255, 255, 255, 0.8),
    0 0 2px rgba(255, 255, 255, 0.3);
  filter: contrast(1.2) brightness(1.1);
  font-display: swap;
`;

export default function LogoDisplay() {
  return (
    <div className={logoContainerStyles}>
      <div className={translatorTextStyles}>translator</div>
      <div className={bylineTextStyles}>by stage_5</div>
    </div>
  );
}
