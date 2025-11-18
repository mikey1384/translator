import { css } from '@emotion/css';
import { useMemo } from 'react';
import { colors } from '../styles';
import { useLogsStore, formatLog } from '../state/logs-store';
import { useTranslation } from 'react-i18next';
import type { LogEntry } from '../state/logs-store';

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

  const textBlob = useMemo(() => compactAndFormatLogs(last30), [last30]);
  if (!open) return null;

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
      // Ensure deviceId is present if available
      try {
        if (!deviceInfo?.deviceId) {
          const id = await (window as any).electron?.getDeviceId?.();
          if (id) deviceInfo = { ...deviceInfo, deviceId: id };
        }
      } catch {
        // Ignore device info retrieval errors
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
      // Ensure deviceId is present if available
      try {
        if (!deviceInfo?.deviceId) {
          const id = await (window as any).electron?.getDeviceId?.();
          if (id) deviceInfo = { ...deviceInfo, deviceId: id };
        }
      } catch {
        // Ignore device info retrieval errors
      }
      const header = `${t('logs.deviceInfoHeader', 'Device Info')}:
${JSON.stringify(deviceInfo)}

`;
      const compact = compactAndFormatLogs(last30);
      const body = encodeURIComponent(prefix + header + compact);
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
