import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../state';
import { colors } from '../styles';

const switcherContainer = css`
  display: inline-flex;
  align-items: center;
  gap: 0;
  border: 1px solid ${colors.border};
  border-radius: 999px;
  background-color: ${colors.light};
  padding: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
`;

const switcherWrapper = css`
  display: flex;
  justify-content: center;
  margin: 12px 0 20px;
`;

const switcherButton = css`
  position: relative;
  border: none;
  background: transparent;
  color: ${colors.gray};
  font-size: 0.9rem;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    color: ${colors.dark};
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px ${colors.primary}33;
  }
`;

const switcherButtonActive = css`
  color: #fff;
  background: linear-gradient(
    135deg,
    ${colors.primary},
    ${colors.progressTranslate}
  );
  box-shadow: 0 6px 14px rgba(67, 97, 238, 0.25);
`;

type ShellOption = {
  id: 'workspace' | 'learning';
  label: string;
};

export default function ShellSwitcher() {
  const { t } = useTranslation();
  const activeShell = useUIStore(s => s.activeShell);
  const setActiveShell = useUIStore(s => s.setActiveShell);

  const options: ShellOption[] = [
    {
      id: 'workspace',
      label: t('shellSwitcher.workspace', 'Translator'),
    },
    {
      id: 'learning',
      label: t('shellSwitcher.learning', 'Learning'),
    },
  ];

  return (
    <div className={switcherWrapper} role="tablist" aria-label="Workspace mode">
      <div className={switcherContainer}>
        {options.map(option => {
          const isActive = activeShell === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cx(switcherButton, isActive && switcherButtonActive)}
              onClick={() => setActiveShell(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
