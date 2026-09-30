import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDialogueText, synthesizeElevenV4 } from '../services/elevenlabs-dialogue.js';

test('dialogue splits without losing text or splitting an emoji', () => {
  for (const text of ['Hello '.repeat(700), '가'.repeat(4999), 'x'.repeat(1999) + '😀' + 'y'.repeat(2010)]) {
    const pieces = splitDialogueText(text);
    assert.equal(pieces.join(''), text);
    assert.ok(pieces.every(piece => piece.length <= 2000 && !/[\uD800-\uDBFF]$/.test(piece)));
  }
});

test('v4 uses dialogue requests with explicit model and forwards cancellation; PCM parts retain all samples', async () => {
  const calls: any[] = []; const signal = new AbortController().signal;
  const audio = await synthesizeElevenV4({text:'x'.repeat(4500),voiceId:'voice',outputFormat:'pcm_44100',apiKey:'test',signal,
    fetchImpl: async (url: any, options?: any) => {
      assert.match(String(url), /\/text-to-dialogue\?/); assert.equal(options.signal,signal);
      const body = JSON.parse(options.body); calls.push(body);
      assert.equal(body.model_id,'eleven_v4'); assert.equal(body.voice_settings,undefined);
      assert.equal(body.inputs[0].voice_id,'voice'); assert.ok(body.inputs[0].text.length <= 2000);
      return new Response(new Uint8Array([calls.length,0]));
    }});
  assert.equal(calls.map(c => c.inputs[0].text).join(''), 'x'.repeat(4500));
  assert.deepEqual([...audio], [1,0,2,0,3,0]);
});

test('empty or failed provider audio is rejected instead of becoming a silent successful dub', async () => {
  for (const response of [new Response('',{status:400}),new Response(new Uint8Array())]) {
    await assert.rejects(synthesizeElevenV4({text:'Hi',voiceId:'voice',outputFormat:'mp3_44100_128',apiKey:'test',fetchImpl:async()=>response}));
  }
});


test('joined MP3 clips omit interior ID3 metadata instead of emitting a broken decoder packet', async () => {
  const header=Buffer.from([73,68,51,4,0,0,0,0,0,0]);
  const part=Buffer.concat([header,Buffer.from([255,251,1,2])]);
  const joined=await synthesizeElevenV4({text:'x'.repeat(2100),voiceId:'voice',outputFormat:'mp3_44100_128',apiKey:'test',
    fetchImpl:async()=>new Response(new Uint8Array(part))});
  assert.deepEqual([...joined], [...part,255,251,1,2]);
});
