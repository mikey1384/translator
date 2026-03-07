import { css } from '@emotion/css';
import { useEffect, useMemo, useState } from 'react';
import { colors } from '../styles';
import { useLogsStore, formatLog } from '../state/logs-store';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../state/logs-store';
import Button from './Button';
import Modal from './Modal';
import { Alert } from './design-system/index.js';

// Stable stringify for meta objects (sort keys recursively)
function stableStringify(val: any): string {
  const seen = new WeakSet();
  const helper = (v: any): any => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.map(helper);
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = helper(v[k]);
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(helper(val));
  } catch {
    return '';
  }
}

function compactAndFormatLogs(entries: LogEntry[]): string {
  type PhaseGroup = {
    task: 'transcription' | 'translation';
    base: string; // stage label without dynamic percents
    startTs: number;
    minPct: number | null;
    maxPct: number | null;
  } | null;

  type OutItem = { key: string; text: string; ts: number };
  const out: OutItem[] = [];

  let phaseGroup: PhaseGroup = null;

  const flushPhase = () => {
    if (!phaseGroup) return;
    const time = new Date(phaseGroup.startTs).toISOString();
    let range = '';
    if (phaseGroup.minPct != null && phaseGroup.maxPct != null) {
      const lo = Math.round(phaseGroup.minPct);
      const hi = Math.round(phaseGroup.maxPct);
      range = lo === hi ? ` ${lo}%` : ` ${lo}~${hi}%`;
    }
    const text = `[${time}] INFO task: ${phaseGroup.task}:phase:${phaseGroup.base}${range}`;
    const key = `PHASE|${phaseGroup.task}|${phaseGroup.base}|${range || ''}`;
    out.push({ key, text, ts: phaseGroup.startTs });
    phaseGroup = null;
  };

  const tryParsePhase = (
    e: LogEntry
  ): {
    task: 'transcription' | 'translation';
    base: string;
    pct: number | null; // stage-local percent if present, else appended percent, else null
  } | null => {
    if (e.kind !== 'task') return null;
    const m = /^(transcription|translation):phase:(.*)$/.exec(e.message);
    if (!m) return null;
    const task = m[1] as 'transcription' | 'translation';
    const stageText = m[2];
    const pctMatches = stageText.match(/(\d+(?:\.\d+)?)%/g) || [];
    const pctValues = pctMatches.map(v => parseFloat(v.replace('%', '')));
    const base = stageText
      .replace(/\s*\(\d+(?:\.\d+)?%\)/g, ' ')
      .replace(/\s*\d+(?:\.\d+)?%\s*/g, ' ')
      .replace(/\b\d+\s*\/\s*\d+\b/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const pct = pctValues.length ? pctValues[0] : null;
    return { task, base, pct };
  };

  const appendNonPhase = (e: LogEntry) => {
    const text = formatLog(e);
    const key = `${e.level}|${e.kind}|${e.message}|${stableStringify(e.meta)}`;
    out.push({ key, text, ts: e.ts });
  };

  for (const e of entries) {
    const parsed = tryParsePhase(e);
    if (!parsed) {
      // Do NOT flush the current phase group when non-phase logs arrive.
      // This lets us aggregate a single phase (e.g., "Transcribed chunks")
      // across interleaved network logs, and then emit one summarized line
      // with a percent range once the phase actually changes.
      appendNonPhase(e);
      continue;
    }

    if (
      phaseGroup &&
      phaseGroup.task === parsed.task &&
      phaseGroup.base === parsed.base
    ) {
      if (parsed.pct != null) {
        phaseGroup.minPct =
          phaseGroup.minPct == null
            ? parsed.pct
            : Math.min(phaseGroup.minPct, parsed.pct);
        phaseGroup.maxPct =
          phaseGroup.maxPct == null
            ? parsed.pct
            : Math.max(phaseGroup.maxPct, parsed.pct);
      }
      continue;
    }

    flushPhase();
    phaseGroup = {
      task: parsed.task,
      base: parsed.base,
      startTs: e.ts,
      minPct: parsed.pct,
      maxPct: parsed.pct,
    };
  }

  flushPhase();

  // Second pass: collapse consecutive identical keys (run-length encode)
  const finalLines: string[] = [];
  let lastKey: string | null = null;
  let lastText = '';
  let count = 0;
  for (const item of out) {
    if (item.key === lastKey) {
      count += 1;
    } else {
      if (lastKey != null) {
        finalLines.push(count > 1 ? `${lastText} (x${count})` : lastText);
      }
      lastKey = item.key;
      lastText = item.text;
      count = 1;
    }
  }
  if (lastKey != null) {
    finalLines.push(count > 1 ? `${lastText} (x${count})` : lastText);
  }

  return finalLines.join('\n');
}

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
  const logs = useLogsStore(s => s.logs);
  const last30 = useMemo(() => {
    const copy = logs.slice();
    return copy.slice(Math.max(0, copy.length - 200));
  }, [logs]);

  const textBlob = useMemo(() => compactAndFormatLogs(last30), [last30]);
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

  useEffect(() => {
    if (!open) setUserMessage('');
  }, [open]);

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
      const compact = compactAndFormatLogs(last30);
      await navigator.clipboard.writeText(header + compact);
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
    const intro = resolveReportPrompt(reportPrompt);
    const prefix = `${intro}\n\n${t(
      'logs.emailBodyPrefix',
      'Hi,\n\nPlease find my recent logs below to help debug the issue.\n\n'
    )}`;
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
      const compact = compactAndFormatLogs(last30);
      const note = userMessage.trim()
        ? `${t('logs.optionalMessage', 'Optional message')}:\n${userMessage.trim()}\n\n`
        : '';
      const body = encodeURIComponent(
        prefix + '\n\n' + note + header + compact
      );
      const mailto = `mailto:mikey@stage5.tools?subject=${subject}&body=${body}`;
      window.location.href = mailto;
    })();
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
          {resolveReportPrompt(reportPrompt)}
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
            {textBlob || t('logs.empty', 'No logs yet.')}
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
          <Button variant="secondary" size="sm" onClick={copyToClipboard}>
            {t('logs.copy', 'Copy')}
          </Button>
          <Button variant="primary" size="sm" onClick={emailToDev}>
            {t('logs.sendReport', 'Send report')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
