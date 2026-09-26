import { css } from '@emotion/css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CreditTransferCodeResult,
  CreditTransferRedeemResult,
} from '@shared-types/app';
import Section from '../../components/Section';
import Button from '../../components/Button';
import { colors } from '../../styles';
import * as SystemIPC from '../../ipc/system';
import { useCreditStore } from '../../state';
import { settingsCenterColumnStyles } from './styles';

const mutedText = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: 0.9rem;
  line-height: 1.5;
`;

const buttonRow = css`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const panel = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid ${colors.border};
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: ${colors.text};
  font-size: 0.9rem;
  line-height: 1.5;
`;

const codeRow = css`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const codeText = css`
  font-family: monospace;
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: ${colors.primary};
  user-select: all;
`;

const codeInput = css`
  flex: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background: ${colors.surface};
  color: ${colors.text};
  font-family: monospace;
  font-size: 1.1rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const errorText = css`
  margin: 0;
  color: ${colors.danger};
`;

const successText = css`
  margin: 0;
  color: #22c55e;
  font-weight: 600;
`;

type Mode = 'idle' | 'send' | 'receive';

export default function CreditTransferSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Extract<
    CreditTransferCodeResult,
    { success: true }
  > | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeInputValue, setCodeInputValue] = useState('');
  const [received, setReceived] = useState<Extract<
    CreditTransferRedeemResult,
    { success: true }
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (next: Mode) => {
    setMode(next);
    setIssued(null);
    setReceived(null);
    setError(null);
    setCopied(false);
    setCodeInputValue('');
  };

  const handleCreateCode = async () => {
    reset('send');
    setBusy(true);
    try {
      const result = await SystemIPC.createCreditTransferCode();
      if (result.success) setIssued(result);
      else setError(result.message);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code stays selectable for a manual copy.
    }
  };

  const handleRedeem = async () => {
    if (busy || !codeInputValue.trim()) return;
    setBusy(true);
    setError(null);
    setReceived(null);
    try {
      const result = await SystemIPC.redeemCreditTransfer(codeInputValue);
      if (result.success) {
        setReceived(result);
        setCodeInputValue('');
        // Main already refreshed balance and entitlements; re-read history
        // so welcome-only messaging stops once paid credits arrive.
        useCreditStore.getState().refreshHistory();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      destination="settings-credit-transfer"
      title={t(
        'settings.creditTransfer.title',
        'Move credits between computers'
      )}
      className={settingsCenterColumnStyles}
    >
      <p className={mutedText}>
        {t(
          'settings.creditTransfer.description',
          'Purchased credits and the API-key unlock can move to another computer. Free welcome credits stay on this one.'
        )}
      </p>

      <div className={buttonRow}>
        <Button
          variant={mode === 'send' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => void handleCreateCode()}
          disabled={busy}
        >
          {t(
            'settings.creditTransfer.moveButton',
            'Move credits to another computer'
          )}
        </Button>
        <Button
          variant={mode === 'receive' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => reset('receive')}
          disabled={busy}
        >
          {t('settings.creditTransfer.receiveButton', 'Receive credits')}
        </Button>
      </div>

      {mode === 'send' && (
        <div className={panel} data-testid="credit-transfer-send">
          {busy && (
            <p className={mutedText}>
              {t('settings.creditTransfer.creating', 'Creating code…')}
            </p>
          )}
          {issued && (
            <>
              <div className={codeRow}>
                <span className={codeText} dir="ltr">
                  {issued.code}
                </span>
                <Button variant="secondary" size="sm" onClick={handleCopy}>
                  {copied
                    ? t('settings.creditTransfer.copied', 'Copied')
                    : t('settings.creditTransfer.copy', 'Copy')}
                </Button>
              </div>
              <p style={{ margin: 0 }}>
                {issued.transferableCredits > 0 &&
                  t(
                    'settings.creditTransfer.summaryCredits',
                    '{{credits}} credits will move.',
                    {
                      credits: issued.transferableCredits.toLocaleString(),
                    }
                  )}{' '}
                {issued.byoUnlock &&
                  t(
                    'settings.creditTransfer.summaryByo',
                    'The API-key unlock will move too.'
                  )}
              </p>
              <p className={mutedText}>
                {t(
                  'settings.creditTransfer.expires',
                  'This code works once and expires in {{minutes}} minutes.',
                  { minutes: issued.expiresInMinutes }
                )}
              </p>
              <p className={mutedText}>
                {t(
                  'settings.creditTransfer.steps',
                  'On the new computer: install Translator, open Settings, choose “Receive credits”, and enter this code.'
                )}
              </p>
            </>
          )}
          {error && <p className={errorText}>{error}</p>}
        </div>
      )}

      {mode === 'receive' && (
        <div className={panel} data-testid="credit-transfer-receive">
          <label htmlFor="credit-transfer-code" style={{ fontWeight: 600 }}>
            {t(
              'settings.creditTransfer.inputLabel',
              'Code from your other computer'
            )}
          </label>
          <form
            className={codeRow}
            onSubmit={event => {
              event.preventDefault();
              void handleRedeem();
            }}
          >
            <input
              id="credit-transfer-code"
              className={codeInput}
              value={codeInputValue}
              onChange={event => setCodeInputValue(event.target.value)}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              dir="ltr"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={busy || !codeInputValue.trim()}
            >
              {busy
                ? t('settings.creditTransfer.redeeming', 'Receiving…')
                : t('settings.creditTransfer.redeem', 'Receive')}
            </Button>
          </form>
          {received && (
            <>
              <p className={successText}>
                {received.transferredCredits > 0
                  ? t(
                      'settings.creditTransfer.received',
                      'Received {{credits}} credits.',
                      {
                        credits: received.transferredCredits.toLocaleString(),
                      }
                    )
                  : t(
                      'settings.creditTransfer.receivedNoCredits',
                      'The code worked.'
                    )}
              </p>
              {received.byoUnlock && (
                <p style={{ margin: 0 }}>
                  {t(
                    'settings.creditTransfer.receivedByo',
                    'The API-key unlock is active on this computer.'
                  )}
                </p>
              )}
            </>
          )}
          {error && <p className={errorText}>{error}</p>}
        </div>
      )}
    </Section>
  );
}
