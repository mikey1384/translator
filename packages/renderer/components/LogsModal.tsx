import { css } from '@emotion/css';
import { useMemo } from 'react';
import { colors } from '../styles';
import { useLogsStore, formatLog } from '../state/logs-store';
import { useTranslation } from 'react-i18next';

export default function LogsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const logs = useLogsStore(s => s.logs);
  const last30 = useMemo(() => {
    const copy = logs.slice();
    return copy.slice(Math.max(0, copy.length - 200));
  }, [logs]);

  if (!open) return null;

  const textBlob = last30.map(formatLog).join('\n');

  const copyToClipboard = async () => {
    try {
      let deviceInfo: any = null;
      try {
        deviceInfo = await (window as any).electron?.getSystemInfo?.();
      } catch {
        // Do nothing
      }
      if (!deviceInfo) {
        const ua = navigator.userAgent;
        const platform =
          (navigator as any).userAgentData?.platform || navigator.platform;
        deviceInfo = { platform, ua } as any;
      }
      const header = `${t('logs.deviceInfoHeader', 'Device Info')}:
${JSON.stringify(deviceInfo)}

`;
      await navigator.clipboard.writeText(header + textBlob);
      alert(t('logs.copied', 'Logs copied to clipboard'));
    } catch (err) {
      console.error('[LogsModal] copy failed', err);
      alert(t('logs.copyFailed', 'Copy failed'));
    }
  };

  const emailToDev = () => {
    const subject = encodeURIComponent(
      t('logs.emailSubject', 'Stage5 Debug Logs')
    );
    const prefix = t(
      'logs.emailBodyPrefix',
      'Hi,\n\nPlease find my recent logs below to help debug the issue.\n\n'
    );
    (async () => {
      let deviceInfo: any = null;
      try {
        deviceInfo = await (window as any).electron?.getSystemInfo?.();
      } catch {
        // Do nothing
      }
      if (!deviceInfo) {
        const ua = navigator.userAgent;
        const platform =
          (navigator as any).userAgentData?.platform || navigator.platform;
        deviceInfo = { platform, ua } as any;
      }
      const header = `${t('logs.deviceInfoHeader', 'Device Info')}:
${JSON.stringify(deviceInfo)}

`;
      const body = encodeURIComponent(prefix + header + textBlob);
      const mailto = `mailto:mikey@stage5.tools?subject=${subject}&body=${body}`;
      window.location.href = mailto;
    })();
  };

  return (
    <div
      className={css`
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `}
      role="dialog"
      aria-modal="true"
      aria-label="Logs"
      onClick={onClose}
    >
      <div
        className={css`
          background: ${colors.light};
          border: 1px solid ${colors.border};
          border-radius: 10px;
          width: min(820px, 95vw);
          max-height: 85vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        `}
        onClick={e => e.stopPropagation()}
      >
        <div
          className={css`
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid ${colors.border};
          `}
        >
          <div style={{ color: colors.dark, fontWeight: 600 }}>
            {t('logs.title', 'Recent Logs')}
          </div>
        </div>
        <div
          className={css`
            display: grid;
            grid-template-columns: 1fr 160px; /* content | side buttons */
            gap: 0;
            flex: 1 1 auto;
            min-height: 0; /* allow inner scrolls */
          `}
        >
          <div
            className={css`
              overflow: auto;
              padding: 12px;
              background: ${colors.light};
            `}
          >
            <pre
              className={css`
                margin: 0;
                white-space: pre-wrap;
                word-break: break-word;
                font-family:
                  ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
                  'Liberation Mono', 'Courier New', monospace;
                font-size: 12px;
                color: ${colors.dark};
              `}
            >
              {textBlob || t('logs.empty', 'No logs yet.')}
            </pre>
          </div>
          <div
            className={css`
              border-left: 1px solid ${colors.border};
              padding: 12px;
              display: flex;
              flex-direction: column;
              gap: 10px;
              background: ${colors.light};
            `}
          >
            <button
              className={css`
                background: ${colors.grayLight};
                color: ${colors.dark};
                border: 1px solid ${colors.border};
                border-radius: 6px;
                padding: 8px 10px;
                cursor: pointer;
              `}
              onClick={copyToClipboard}
              aria-label={t('logs.copy', 'Copy')}
            >
              {t('logs.copy', 'Copy')}
            </button>
            <button
              className={css`
                background: ${colors.primary};
                color: white;
                border: 1px solid ${colors.primary};
                border-radius: 6px;
                padding: 8px 10px;
                cursor: pointer;
              `}
              onClick={emailToDev}
              aria-label={t('logs.email', 'Email to Dev')}
            >
              {t('logs.email', 'Email to Dev')}
            </button>
          </div>
        </div>
        <div
          className={css`
            padding: 10px 12px;
            border-top: 1px solid ${colors.border};
            display: flex;
            justify-content: flex-end;
            background: ${colors.light};
          `}
        >
          <button
            className={css`
              background: transparent;
              color: ${colors.dark};
              border: 1px solid ${colors.border};
              border-radius: 6px;
              padding: 6px 12px;
              cursor: pointer;
            `}
            onClick={onClose}
            aria-label={t('logs.close', 'Close')}
          >
            {t('logs.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
