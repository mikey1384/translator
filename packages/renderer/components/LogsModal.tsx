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
  const [attachDiagnostics, setAttachDiagnostics] = useState(true);
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
  const resolvedPrompt = reportPrompt ? resolveReportPrompt(reportPrompt) : '';
  const defaultIntro = t(
    'logs.reportPrompt',
    'Something went wrong. Report this to the creator for a quick fix.'
  );

  useEffect(() => {
    if (!open) {
      setUserMessage('');
      setAttachDiagnostics(true);
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
      return t('logs.preparingReport', 'Preparing diagnostic bundle...');
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

  const openMailto = async (subjectText: string, bodyText: string) => {
    const mailto = `mailto:mikey@stage5.tools?subject=${encodeURIComponent(
      subjectText
    )}&body=${encodeURIComponent(bodyText)}`;
    if (window.appShell?.openExternal) {
      await window.appShell.openExternal(mailto);
    } else {
      window.location.href = mailto;
    }
  };

  const emailToDev = async () => {
    if (!attachDiagnostics) {
      // Feedback only: the user's words plus the app version, nothing else.
      setBusyAction('send');
      try {
        const version = window.env?.appVersion;
        await openMailto(
          t('logs.feedbackEmailSubject', 'Translator feedback'),
          `${userMessage.trim()}\n\n—\nTranslator${version ? ` v${version}` : ''}`
        );
      } catch (err) {
        console.error('[LogsModal] send feedback failed', err);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    setBusyAction('send');
    const subject = t('logs.emailSubject', 'Stage5 Debug Logs');
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

      await openMailto(
        subject,
        buildMailtoBody({
          intro,
          bundle: report,
          fullBundleCopiedToClipboard: copied,
        })
      );
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
      title={t('logs.feedbackTitle', 'Send feedback or report a problem')}
      onClose={onClose}
      contentClassName={css`
        width: min(640px, 95vw);
        max-height: 88vh;
      `}
      bodyClassName={css`
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      `}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('logs.close', 'Close')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void emailToDev()}
            disabled={
              busyAction !== null ||
              (!attachDiagnostics && userMessage.trim().length === 0)
            }
          >
            {t('common.send', 'Send')}
          </Button>
        </>
      }
      closeLabel={t('logs.close', 'Close')}
    >
      {reportPrompt ? <Alert variant="error">{resolvedPrompt}</Alert> : null}
      <label
        className={css`
          display: grid;
          gap: 8px;
          color: ${colors.text};
          font-size: 0.92rem;
        `}
      >
        {t(
          'logs.whatHappened',
          'What happened, or what would you like to tell us?'
        )}
        <textarea
          value={userMessage}
          onChange={e => setUserMessage(e.target.value)}
          placeholder={t(
            'logs.optionalMessagePlaceholder',
            'What were you trying to do?'
          )}
          autoFocus
          className={css`
            min-height: 140px;
            resize: vertical;
            border: 1px solid ${colors.border};
            border-radius: 10px;
            padding: 10px 12px;
            font: inherit;
            font-size: 0.92rem;
            background: ${colors.bg};
            color: ${colors.text};
            caret-color: ${colors.text};

            &::placeholder {
              color: ${colors.textDim};
              opacity: 1;
            }

            &:focus-visible {
              outline: 2px solid ${colors.primaryLight};
              outline-offset: 1px;
            }
          `}
        />
      </label>
      <label
        className={css`
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: ${colors.text};
          font-size: 0.88rem;
          cursor: pointer;
        `}
      >
        <input
          type="checkbox"
          checked={attachDiagnostics}
          onChange={e => setAttachDiagnostics(e.target.checked)}
          className={css`
            margin-top: 3px;
          `}
        />
        <span>
          {t(
            'logs.attachDiagnostics',
            'Attach diagnostic details (recommended for problems)'
          )}
          <span
            className={css`
              display: block;
              color: ${colors.textDim};
              font-size: 0.8rem;
              margin-top: 2px;
            `}
          >
            {t(
              'logs.attachDiagnosticsHint',
              'Recent app logs, app version and system info. No videos or subtitles.'
            )}
          </span>
        </span>
      </label>
      {attachDiagnostics && mainContextError ? (
        <Alert variant="warning">
          {t(
            'logs.reportContextWarning',
            'Some diagnostic context could not be loaded. The report will still include renderer-side details.'
          )}
        </Alert>
      ) : null}
      {attachDiagnostics ? (
        <details
          className={css`
            border: 1px solid ${colors.border};
            border-radius: 10px;
            background: ${colors.surface};
            padding: 8px 12px;

            & > summary {
              cursor: pointer;
              color: ${colors.textDim};
              font-size: 0.85rem;
            }
          `}
        >
          <summary>{t('logs.showDetails', 'Show what will be sent')}</summary>
          <div
            className={css`
              display: flex;
              justify-content: flex-end;
              margin: 8px 0;
            `}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={copyToClipboard}
              disabled={busyAction !== null}
            >
              {t('logs.copy', 'Copy')}
            </Button>
          </div>
          <pre
            dir="ltr"
            lang="en"
            className={css`
              margin: 0;
              max-height: 40vh;
              overflow: auto;
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
        </details>
      ) : null}
    </Modal>
  );
}
