import { css } from '@emotion/css';
import { useEffect, useMemo, useState } from 'react';
import { colors } from '../styles';
import { useLogsStore } from '../state/logs-store';
import { useTranslation } from 'react-i18next';
import type { ErrorReportContext } from '@shared-types/app';
import Button from './Button';
import Modal from './Modal';
import { Alert } from './design-system/index.js';
import * as SystemIPC from '../ipc/system';
import {
  buildErrorReportBundle,
  buildMailtoBody,
  buildReportPreview,
} from '../utils/error-report';

export default function LogsModal({
  open,
  reportPrompt,
  onClose,
}: {
  open: boolean;
  reportPrompt?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [userMessage, setUserMessage] = useState('');
  const [mainContext, setMainContext] = useState<ErrorReportContext | null>(
    null
  );
  const [mainContextError, setMainContextError] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [busyAction, setBusyAction] = useState<'copy' | 'send' | null>(null);
  const logs = useLogsStore(s => s.logs);
  const last30 = useMemo(() => {
    const copy = logs.slice();
    return copy.slice(Math.max(0, copy.length - 200));
  }, [logs]);

  const resolveReportPrompt = (rawPrompt?: string | null) => {
    const baseFallback = t(
      'logs.reportPrompt',
      'Something went wrong. Report this to the creator for a quick fix.'
    );
    const value = (rawPrompt || '').trim();
    if (!value) return baseFallback;
    if (value.startsWith('__i18n__:')) {
      return t(value.slice(9), baseFallback);
    }
    return value;
  };
  const resolvedPrompt = useMemo(
    () => (reportPrompt ? resolveReportPrompt(reportPrompt) : ''),
    [reportPrompt, t]
  );
  const defaultIntro = t(
    'logs.reportPrompt',
    'Something went wrong. Report this to the creator for a quick fix.'
  );

  useEffect(() => {
    if (!open) {
      setUserMessage('');
      setMainContext(null);
      setMainContextError(null);
      setLoadingContext(false);
      setBusyAction(null);
      return;
    }

    let cancelled = false;
    setLoadingContext(true);
    void SystemIPC.getErrorReportContext()
      .then(context => {
        if (cancelled) return;
        setMainContext(context);
        setMainContextError(null);
      })
      .catch(error => {
        if (cancelled) return;
        setMainContext(null);
        setMainContextError(String((error as any)?.message || error));
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingContext(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const bundle = useMemo(
    () =>
      buildErrorReportBundle({
        logs: last30,
        userMessage,
        reportPrompt: resolvedPrompt || null,
        mainContext,
        mainContextError,
      }),
    [last30, userMessage, resolvedPrompt, mainContext, mainContextError]
  );

  const previewText = useMemo(() => {
    if (loadingContext && !mainContext) {
      return t(
        'logs.preparingReport',
        'Preparing diagnostic bundle...'
      );
    }
    return buildReportPreview({ bundle, mainContext });
  }, [bundle, loadingContext, mainContext, t]);

  const loadFreshContext = async (): Promise<ErrorReportContext | null> => {
    try {
      const context = await SystemIPC.getErrorReportContext();
      setMainContext(context);
      setMainContextError(null);
      return context;
    } catch (error) {
      const message = String((error as any)?.message || error);
      setMainContextError(message);
      return null;
    }
  };

  const copyToClipboard = async () => {
    setBusyAction('copy');
    try {
      const freshContext = await loadFreshContext();
      const report = buildErrorReportBundle({
        logs: last30,
        userMessage,
        reportPrompt: resolvedPrompt || null,
        mainContext: freshContext ?? mainContext,
        mainContextError: freshContext ? null : mainContextError,
      });
      await navigator.clipboard.writeText(report.fullText);
      alert(t('logs.copied', 'Logs copied to clipboard'));
    } catch (err) {
      console.error('[LogsModal] copy failed', err);
      alert(t('logs.copyFailed', 'Copy failed'));
    } finally {
      setBusyAction(null);
    }
  };

  const emailToDev = async () => {
    setBusyAction('send');
    const subject = encodeURIComponent(
      t('logs.emailSubject', 'Stage5 Debug Logs')
    );
    const intro = `${resolvedPrompt || defaultIntro}\n\n${t(
      'logs.emailBodyPrefix',
      'Hi,\n\nPlease find my recent logs below to help debug the issue.\n\n'
    )}`;
    try {
      const freshContext = await loadFreshContext();
      const report = buildErrorReportBundle({
        logs: last30,
        userMessage,
        reportPrompt: resolvedPrompt || null,
        mainContext: freshContext ?? mainContext,
        mainContextError: freshContext ? null : mainContextError,
      });

      let copied = false;
      try {
        await navigator.clipboard.writeText(report.fullText);
        copied = true;
      } catch {
        copied = false;
      }

      const body = encodeURIComponent(
        buildMailtoBody({
          intro,
          bundle: report,
          fullBundleCopiedToClipboard: copied,
        })
      );
      const mailto = `mailto:mikey@stage5.tools?subject=${subject}&body=${body}`;
      if (window.appShell?.openExternal) {
        await window.appShell.openExternal(mailto);
      } else {
        window.location.href = mailto;
      }
    } catch (err) {
      console.error('[LogsModal] send report failed', err);
      alert(t('logs.copyFailed', 'Copy failed'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Modal
      open={open}
      title={t('logs.title', 'Recent Logs')}
      onClose={onClose}
      contentClassName={css`
        width: min(820px, 95vw);
        max-height: 85vh;
      `}
      bodyClassName={css`
        overflow: hidden;
      `}
      actions={
        <Button variant="secondary" onClick={onClose}>
          {t('logs.close', 'Close')}
        </Button>
      }
      closeLabel={t('logs.close', 'Close')}
    >
      {reportPrompt ? (
        <Alert
          variant="error"
          className={css`
            margin-bottom: 12px;
          `}
        >
          {resolvedPrompt}
        </Alert>
      ) : null}
      {mainContextError ? (
        <Alert
          variant="error"
          className={css`
            margin-bottom: 12px;
          `}
        >
          {t(
            'logs.reportContextWarning',
            'Some diagnostic context could not be loaded. The report will still include renderer-side details.'
          )}
        </Alert>
      ) : null}
      <div
        className={css`
          display: grid;
          grid-template-columns: 1fr 160px;
          gap: 0;
          min-height: min(60vh, 520px);

          @media (max-width: 760px) {
            grid-template-columns: 1fr;
          }
        `}
      >
        <div
          className={css`
            overflow: auto;
            padding: 12px;
            background: ${colors.surface};
            border: 1px solid ${colors.border};
            border-radius: 10px 0 0 10px;

            @media (max-width: 760px) {
              border-radius: 10px 10px 0 0;
            }
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
              color: ${colors.text};
            `}
          >
            {previewText || t('logs.empty', 'No logs yet.')}
          </pre>
        </div>
        <div
          className={css`
            border: 1px solid ${colors.border};
            border-left: none;
            border-radius: 0 10px 10px 0;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            background: ${colors.surface};

            @media (max-width: 760px) {
              border-left: 1px solid ${colors.border};
              border-top: none;
              border-radius: 0 0 10px 10px;
            }
          `}
        >
          <label
            className={css`
              display: grid;
              gap: 6px;
              font-size: 0.8rem;
              color: ${colors.gray};
            `}
          >
            {t('logs.optionalMessage', 'Optional message')}
            <textarea
              value={userMessage}
              onChange={e => setUserMessage(e.target.value)}
              placeholder={t(
                'logs.optionalMessagePlaceholder',
                'What were you trying to do?'
              )}
              className={css`
                min-height: 90px;
                resize: vertical;
                border: 1px solid ${colors.border};
                border-radius: 6px;
                padding: 8px;
                font-size: 0.82rem;
                background: ${colors.bg};
                color: ${colors.text};
                caret-color: ${colors.text};

                &::placeholder {
                  color: ${colors.textDim};
                  opacity: 1;
                }
              `}
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={copyToClipboard}
            disabled={busyAction !== null}
          >
            {t('logs.copy', 'Copy')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void emailToDev()}
            disabled={busyAction !== null}
          >
            {t('logs.sendReport', 'Send report')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
