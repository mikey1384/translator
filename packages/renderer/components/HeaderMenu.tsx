import { css } from '@emotion/css';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openLogs } from '../state/modal-store';
import { colors } from '../styles';
import { logButton } from '../utils/logger';
import { RELOAD_REQUEST_EVENT } from './FloatingActionButtons';
import { useUpdateStore } from '../state/update-store';

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
  inset-inline-end: 0;
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

const separator = css`
  height: 1px;
  margin: 4px 6px;
  background: ${colors.border};
`;

const versionRow = css`
  padding: 8px 12px 6px;
  color: ${colors.textDim};
  font-size: 0.8rem;
`;

const statusText = css`
  display: block;
  margin-top: 2px;
  color: ${colors.textDim};
  font-size: 0.78rem;
`;

/** Rarely needed actions (reload, updates, feedback) out of the main view. */
export default function HeaderMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusFirstOnOpen = useRef(false);
  const checkStatus = useUpdateStore(s => s.checkStatus);
  const updateAvailable = useUpdateStore(s => s.available);
  const updateDownloading = useUpdateStore(s => s.downloading);
  const updateDownloaded = useUpdateStore(s => s.downloaded);
  const checkForUpdates = useUpdateStore(s => s.check);
  const canCheckForUpdates = Boolean(window.env?.isPackaged);
  const appVersion = window.env?.appVersion || '';

  const closeMenu = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const menuItems = (): HTMLElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])'
      ) ?? []
    );

  useEffect(() => {
    if (!open) return;
    // Keyboard openers land on the first item; mouse users keep focus put.
    if (focusFirstOnOpen.current) {
      focusFirstOnOpen.current = false;
      menuItems()[0]?.focus();
    }
    // Keep the menu on screen whichever side the trigger sits on.
    const menuEl = menuRef.current;
    if (menuEl) {
      menuEl.style.transform = '';
      const rect = menuEl.getBoundingClientRect();
      const overflowStart = 8 - rect.left;
      const overflowEnd = rect.right - (window.innerWidth - 8);
      if (overflowStart > 0) {
        menuEl.style.transform = `translateX(${overflowStart}px)`;
      } else if (overflowEnd > 0) {
        menuEl.style.transform = `translateX(${-overflowEnd}px)`;
      }
    }
    const onPointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu(true);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp')
      next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  const updateStatusLabel = (() => {
    if (updateDownloaded) {
      return t(
        'common.updateReadyToInstall',
        'Update downloaded. Restart to install.'
      );
    }
    if (updateDownloading) {
      return t('common.downloadingUpdateShort', 'Downloading update...');
    }
    if (checkStatus === 'checking') {
      return t('common.checkingForUpdates', 'Checking for updates…');
    }
    if (updateAvailable || checkStatus === 'available') {
      return t(
        'common.updateAvailableDownloading',
        'Update found. Downloading in the background.'
      );
    }
    if (checkStatus === 'none') {
      return t('common.upToDate', 'You’re on the latest version.');
    }
    if (checkStatus === 'error') {
      return t(
        'common.updateCheckFailed',
        'Couldn’t check for updates. Try again later.'
      );
    }
    return null;
  })();

  return (
    <div className={wrapper} ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={trigger}
        aria-label={t('common.moreActions', 'More actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (
            event.key === 'ArrowDown' ||
            event.key === 'Enter' ||
            event.key === ' '
          ) {
            event.preventDefault();
            focusFirstOnOpen.current = true;
            if (open) menuItems()[0]?.focus();
            else setOpen(true);
          }
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="19" cy="12" r="1.8" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menuRef}
          className={menu}
          role="menu"
          aria-label={t('common.moreActions', 'More actions')}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              logButton('header_menu_reload');
              // A plain reload: the update pill owns the download/install
              // branches, this item must never start an update instead.
              window.dispatchEvent(
                new CustomEvent(RELOAD_REQUEST_EVENT, {
                  detail: { plainReload: true },
                })
              );
            }}
          >
            {t('common.reloadPage')}
          </button>
          {canCheckForUpdates ? (
            <button
              type="button"
              role="menuitem"
              className={item}
              aria-disabled={checkStatus === 'checking' || undefined}
              aria-describedby={
                updateStatusLabel ? 'header-menu-update-status' : undefined
              }
              onClick={() => {
                if (checkStatus === 'checking') return;
                logButton('header_menu_check_updates');
                void checkForUpdates();
              }}
            >
              {t('common.checkForUpdates', 'Check for updates')}
              {updateStatusLabel ? (
                <span
                  id="header-menu-update-status"
                  className={statusText}
                  role="status"
                >
                  {updateStatusLabel}
                </span>
              ) : null}
            </button>
          ) : null}
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
          {appVersion ? (
            <>
              <div className={separator} role="separator" />
              <div className={versionRow}>
                {t('common.aboutVersion', 'Translator v{{version}}', {
                  version: appVersion,
                })}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
