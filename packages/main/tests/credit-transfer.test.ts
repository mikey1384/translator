import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTransferCodeInput,
  parseCreateTransferCodeResponse,
  parseRedeemTransferResponse,
  summarizeCreditLedger,
} from '../utils/credit-transfer';

test('transfer-code success carries the code, amount and unlock', () => {
  assert.deepEqual(
    parseCreateTransferCodeResponse(200, {
      code: 'ABCDE-FGH23',
      expiresInMinutes: 30,
      transferableCredits: 150000,
      byoUnlock: true,
    }),
    {
      success: true,
      code: 'ABCDE-FGH23',
      expiresInMinutes: 30,
      transferableCredits: 150000,
      byoUnlock: true,
    }
  );
});

test('transfer errors surface the server code and message', () => {
  assert.deepEqual(
    parseCreateTransferCodeResponse(409, {
      error: 'nothing_to_transfer',
      message:
        'There are no purchased credits or unlocks on this device to move.',
    }),
    {
      success: false,
      error: 'nothing_to_transfer',
      message:
        'There are no purchased credits or unlocks on this device to move.',
    }
  );
  const redeem = parseRedeemTransferResponse(400, {
    error: 'same_device',
    message: 'Enter the code on the other computer, not the one that made it.',
  });
  assert.equal(redeem.success, false);
  assert.equal(!redeem.success && redeem.error, 'same_device');

  const unknown = parseRedeemTransferResponse(502, '<html>bad gateway</html>');
  assert.equal(unknown.success, false);
  assert.equal(!unknown.success && unknown.error, 'transfer_failed');
  assert.ok(!unknown.success && unknown.message.length > 0);
});

test('redeem success reports what arrived', () => {
  assert.deepEqual(
    parseRedeemTransferResponse(200, {
      transferredCredits: 12000,
      creditBalance: 18300,
      byoUnlock: false,
    }),
    {
      success: true,
      transferredCredits: 12000,
      creditBalance: 18300,
      byoUnlock: false,
    }
  );
});

test('pasted codes are normalized', () => {
  assert.equal(normalizeTransferCodeInput(' abcde-fgh23 \n'), 'ABCDEFGH23');
  assert.equal(normalizeTransferCodeInput(undefined), '');
});

test('ledger summary tells welcome-only devices apart', () => {
  assert.deepEqual(
    summarizeCreditLedger([
      { delta: -300, reason: 'TRANSCRIBE' },
      { delta: 6300, reason: 'WELCOME' },
    ]),
    { everHadCredits: true, onlyWelcomeCredits: true }
  );
  assert.deepEqual(
    summarizeCreditLedger([
      { delta: 15000, reason: 'PACK_MICRO' },
      { delta: 6300, reason: 'WELCOME' },
    ]),
    { everHadCredits: true, onlyWelcomeCredits: false }
  );
  assert.deepEqual(
    summarizeCreditLedger([{ delta: 9000, reason: 'TRANSFER_IN' }]),
    { everHadCredits: true, onlyWelcomeCredits: false }
  );
  // A reservation refund is not a purchase.
  assert.deepEqual(
    summarizeCreditLedger([
      { delta: 200, reason: 'TRANSLATE' },
      { delta: -500, reason: 'TRANSLATE' },
      { delta: 6300, reason: 'WELCOME' },
    ]),
    { everHadCredits: true, onlyWelcomeCredits: true }
  );
  assert.deepEqual(summarizeCreditLedger([]), {
    everHadCredits: false,
    onlyWelcomeCredits: false,
  });
  assert.equal(summarizeCreditLedger({ error: 'nope' }), null);
});

test('a full ledger page never claims welcome-only', () => {
  const rows = [
    ...Array.from({ length: 99 }, () => ({ delta: -10, reason: 'TRANSLATE' })),
    { delta: 6300, reason: 'WELCOME' },
  ];
  assert.equal(summarizeCreditLedger(rows)?.onlyWelcomeCredits, false);
});
