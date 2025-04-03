import { css } from '@emotion/css';
import { colors, shadows, breakpoints } from '../styles';

interface ElectronFileButtonProps {
  label?: string;
  buttonText: string;
  onClick: () => void;
}

const labelStyles = css`
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
`;

const buttonStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  background-color: #f8f9fa;
  border: 1px dashed #ced4da;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  color: #212529;
  min-width: 140px;
  text-align: center;
  height: 40px;
  line-height: 1;
  box-sizing: border-box;
  white-space: nowrap;

  &:hover {
    background-color: #e9ecef;
    border-color: ${colors.primary};
    transform: translateY(-1px);
    box-shadow: ${shadows.md};
  }

  &:active {
    transform: translateY(0);
    box-shadow: ${shadows.sm};
  }

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

const containerStyles = css`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  width: 100%;
  box-sizing: border-box;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: flex-start;

    > * {
      width: 100%;
    }
  }
`;

export default function ElectronFileButton({
  label,
  buttonText,
  onClick,
}: ElectronFileButtonProps) {
  return (
    <div>
      {label && <label className={labelStyles}>{label}</label>}
      <div className={containerStyles}>
        <button className={buttonStyles} onClick={onClick} type="button">
          <div
            className={css`
              display: flex;
              align-items: center;
              justify-content: center;
              line-height: 1;
            `}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={css`
                margin-right: 8px;
                flex-shrink: 0;
                position: relative;
                top: 0px;
              `}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{buttonText}</span>
          </div>
        </button>
      </div>
    </div>
  );
}
