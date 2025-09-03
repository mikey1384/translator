import { css } from '@emotion/css';
import { useMemo } from 'react';
import { colors } from '../styles';
import { useLogsStore, formatLog } from '../state/logs-store';

export default function LogsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const logs = useLogsStore(s => s.logs);
  const last30 = useMemo(() => {
    const copy = logs.slice();
    return copy.slice(Math.max(0, copy.length - 30));
  }, [logs]);

  if (!open) return null;

  const textBlob = last30.map(formatLog).join('\n');

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(textBlob);
      alert('Logs copied to clipboard');
    } catch (err) {
      console.error('[LogsModal] copy failed', err);
      alert('Copy failed');
    }
  };

  const emailToDev = () => {
    const subject = encodeURIComponent('Stage5 Debug Logs');
    const body = encodeURIComponent(
      'Hi,\n\nPlease find my recent logs below to help debug the issue.\n\n' +
        textBlob
    );
    const mailto = `mailto:mikey@stage5.tools?subject=${subject}&body=${body}`;
    window.location.href = mailto;
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
          <div style={{ color: colors.dark, fontWeight: 600 }}>Recent Logs</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={css`
                background: ${colors.grayLight};
                color: ${colors.dark};
                border: 1px solid ${colors.border};
                border-radius: 6px;
                padding: 6px 10px;
                cursor: pointer;
              `}
              onClick={copyToClipboard}
              aria-label="Copy logs"
            >
              Copy
            </button>
            <button
              className={css`
                background: ${colors.primary};
                color: white;
                border: 1px solid ${colors.primary};
                border-radius: 6px;
                padding: 6px 10px;
                cursor: pointer;
              `}
              onClick={emailToDev}
              aria-label="Email logs"
            >
              Email to Dev
            </button>
            <button
              className={css`
                background: transparent;
                color: ${colors.dark};
                border: 1px solid ${colors.border};
                border-radius: 6px;
                padding: 6px 10px;
                cursor: pointer;
              `}
              onClick={onClose}
              aria-label="Close logs"
            >
              Close
            </button>
          </div>
        </div>
        <div
          className={css`
            flex: 1 1 auto;
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
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
              font-size: 12px;
              color: ${colors.dark};
            `}
          >
            {textBlob || 'No logs yet.'}
          </pre>
        </div>
      </div>
    </div>
  );
}

