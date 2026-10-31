import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd } from './formatUsd';

test('prices keep their shape inside RTL sentences', () => {
  assert.equal(formatUsd(5, 'en'), 'US$5');
  assert.match(formatUsd(1, 'ar'), /^⁦US\$\S+⁩$/);
  assert.ok(!/[‎‏؜]/.test(formatUsd(1, 'he')));
});

test('prices always say US dollars, never a bare local-looking "$"', () => {
  // pt-BR / es-419 used to render "$ 1", which reads as reais or pesos.
  for (const locale of [
    'en',
    'pt',
    'pt-BR',
    'es',
    'es-419',
    'es-MX',
    'es-AR',
    'vi',
    'de',
    'hi',
    'ko',
    'ja',
    'fr',
  ]) {
    const text = formatUsd(1, locale);
    assert.ok(text.startsWith('US$'), `${locale}: ${text}`);
    assert.ok(!/^\$|\s\$|^1\s?\$/.test(text), `${locale}: ${text}`);
  }
  assert.equal(formatUsd(1, 'pt'), 'US$1');
  assert.equal(formatUsd(50, 'es'), 'US$50');
  assert.equal(formatUsd(10, 'de'), 'US$10');
});
