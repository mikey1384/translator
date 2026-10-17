import { css } from '@emotion/css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openLogs } from '../state/modal-store';
import { colors } from '../styles';
import { logButton } from '../utils/logger';
import { RELOAD_REQUEST_EVENT } from './FloatingActionButtons';

const wrapper = css`
  position: relative;
`;

const trigger = css`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  border: 1px solid ${colors.border};
  background: transparent;
  color: ${colors.muted};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    border-color: ${colors.borderStrong};
    color: ${colors.text};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primaryLight};
    outline-offset: 2px;
  }
`;

const menu = css`
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 1100;
  min-width: 220px;
  padding: 6px;
  border-radius: 14px;
  background: ${colors.surfaceRaised};
  border: 1px solid ${colors.borderStrong};
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
`;

const item = css`
  text-align: start;
  padding: 10px 12px;
  border-radius: 10px;
  border: 0;
  background: transparent;
  color: ${colors.text};
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: ${colors.grayLight};
    outline: none;
  }
`;

/** Rarely needed actions (reload, report an issue) out of the main view. */
export default function HeaderMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={trigger}
        aria-label={t('common.moreActions', 'More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="19" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div className={menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              logButton('header_menu_reload');
              window.dispatchEvent(new Event(RELOAD_REQUEST_EVENT));
            }}
          >
            {t('common.reloadPage')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              logButton('report_issue');
              openLogs();
            }}
          >
            {t('common.reportIssue', 'Report issue or feedback')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
