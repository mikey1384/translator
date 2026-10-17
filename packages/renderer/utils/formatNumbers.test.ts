import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatByteSize,
  formatPercent,
  formatUiDecimal,
  formatUiInteger,
} from './formatNumbers';

test('percentages use the UI language digits and sign', () => {
  assert.equal(formatPercent(65, 'en'), '65%');
  assert.equal(formatPercent(65, 'fa'), '۶۵٪');
  assert.equal(formatPercent(65, 'bn'), '৬৫%');
  assert.equal(formatPercent(65, 'mr'), '६५%');
  assert.equal(formatPercent(12.34, 'en', 1), '12.3%');
  assert.equal(formatPercent(Number.NaN, 'en'), '0%');
});

test('integers and decimals use native digits', () => {
  assert.equal(formatUiInteger(350000, 'en'), '350,000');
  assert.match(formatUiInteger(350000, 'fa'), /^[۰-۹٬]+$/);
  assert.equal(formatUiDecimal(0.5, 2, 'en'), '0.50');
  assert.equal(formatUiDecimal(0.5, 2, 'bn'), '০.৫০');
});

test('byte sizes pick a unit and localize it', () => {
  assert.equal(formatByteSize(512, 'en'), '512 byte');
  assert.equal(formatByteSize(12 * 1024 * 1024, 'en'), '12 MB');
  assert.equal(formatByteSize(1.4 * 1024 ** 3, 'en'), '1.4 GB');
  assert.doesNotMatch(formatByteSize(1.4 * 1024 ** 3, 'fa'), /[0-9]/);
});
