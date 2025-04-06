import { css } from '@emotion/css';

const logoTextColor = '#FAF0E6';

const logoContainerStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const translatorTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  color: ${logoTextColor};
  margin: 0;
  line-height: 1.1;
  text-align: center;
`;

const bylineTextStyles = css`
  font-family: 'Montserrat', 'Nunito Sans', 'Poppins', sans-serif;
  font-weight: 500;
  font-size: 0.7rem;
  color: ${logoTextColor};
  margin: 0;
  margin-top: 2px;
  line-height: 1;
  text-align: center;
`;

export default function LogoDisplay() {
  return (
    <div className={logoContainerStyles}>
      <div className={translatorTextStyles}>translator</div>
      <div className={bylineTextStyles}>by stage_5</div>
    </div>
  );
}
