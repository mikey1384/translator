import test from 'node:test';
import assert from 'node:assert/strict';
import type { TFunction } from 'i18next';
import {
  buildCheckoutFailedNotice,
  checkoutSupportMailto,
  showCheckoutFailedNotice,
} from './checkout-failure';

const t = ((key: string, def?: any, vars?: any) => {
  const text = typeof def === 'string' ? def : key;
  return text.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(vars?.[n] ?? ''));
}) as unknown as TFunction;

test('a failed checkout offers a retry and a person to contact', () => {
  const notice = buildCheckoutFailedNotice(t);
  assert.deepEqual(
    notice.buttons.map(b => b.id),
    ['close', 'support', 'retry']
  );
  assert.equal(notice.buttons.find(b => b.id === 'retry')?.variant, 'primary');
  assert.match(notice.message, /mikey@stage5\.tools/);
  assert.match(
    checkoutSupportMailto(t),
    /^mailto:mikey@stage5\.tools\?subject=/
  );
});

test('choosing support opens mail, retry is reported back', async () => {
  const opened: string[] = [];
  const support = await showCheckoutFailedNotice({
    t,
    openNotice: async () => 'support',
    openExternal: async url => {
      opened.push(url);
    },
  });
  assert.equal(support, 'support');
  assert.equal(opened.length, 1);
  const retry = await showCheckoutFailedNotice({
    t,
    openNotice: async () => 'retry',
    openExternal: async () => {},
  });
  assert.equal(retry, 'retry');
  const closed = await showCheckoutFailedNotice({
    t,
    openNotice: async () => null,
    openExternal: async () => {},
  });
  assert.equal(closed, 'close');
});
