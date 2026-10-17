import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTextLanguage, isTextInLanguage } from './detectTextLanguage';

const english = [
  'Okay, so what are we doing today?',
  'I think we should go to the store and get some food.',
  'You know, that is not what I said.',
  'They were here just a minute ago.',
];

test('detects English subtitle lines', () => {
  assert.equal(detectTextLanguage(english), 'english');
  assert.equal(isTextInLanguage(english, 'english'), true);
  assert.equal(isTextInLanguage(english, 'spanish'), false);
});

test('detects languages by script', () => {
  assert.equal(
    detectTextLanguage([
      '안녕하세요, 오늘 뭐 할 거예요?',
      '저는 잘 모르겠어요.',
    ]),
    'korean'
  );
  assert.equal(
    detectTextLanguage(['今日は何をしますか？', '私はよくわかりません。']),
    'japanese'
  );
  assert.equal(
    detectTextLanguage(['我们今天要做什么？', '这个问题我还没有想过。']),
    'chinese_simplified'
  );
  assert.equal(
    detectTextLanguage(['我們今天要做什麼？', '這個問題我還沒有想過。']),
    'chinese_traditional'
  );
  assert.equal(
    detectTextLanguage(['مرحبا، كيف حالك اليوم؟', 'أنا بخير، شكرا لك.']),
    'arabic'
  );
  assert.equal(
    detectTextLanguage(['Привет, как у тебя дела сегодня?', 'Всё хорошо.']),
    'russian'
  );
  assert.equal(
    detectTextLanguage([
      'Привіт, як твої справи сьогодні?',
      'Усе добре, дякую.',
    ]),
    'ukrainian'
  );
});

test('tells Latin-script languages apart', () => {
  assert.equal(
    detectTextLanguage([
      'No sé qué está pasando con el coche.',
      'Pero los niños están en la casa y es muy tarde.',
    ]),
    'spanish'
  );
  assert.equal(
    detectTextLanguage([
      'Je ne sais pas ce que tu veux dire.',
      'Il est dans la cuisine avec les enfants, et elle est sur le balcon.',
    ]),
    'french'
  );
  assert.equal(
    detectTextLanguage([
      'Ich weiß nicht, was du meinst.',
      'Das ist nicht so einfach, aber wir sind auf dem Weg.',
    ]),
    'german'
  );
});

test('returns null when it cannot tell', () => {
  assert.equal(detectTextLanguage([]), null);
  assert.equal(detectTextLanguage(['OK', '...', '♪']), null);
  assert.equal(detectTextLanguage(['Hello 안녕']), null);
  assert.equal(isTextInLanguage(english, 'original'), false);
  assert.equal(isTextInLanguage(english, null), false);
});
