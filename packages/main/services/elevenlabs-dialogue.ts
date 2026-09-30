import { Buffer } from 'node:buffer';

// Keep the existing per-subtitle limit, but obey the dialogue endpoint's
// conservative 2,000-character request limit without discarding long lines.
export function splitDialogueText(text: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + 2000, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end - 1);
      if (space > offset + 1000) end = space + 1;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}


function withoutLeadingId3Tags(buffer: Buffer): Buffer {
  let offset = 0;
  while (buffer.length >= offset + 10 && buffer.toString('ascii', offset, offset + 3) === 'ID3') {
    const sizeBytes = buffer.subarray(offset + 6, offset + 10);
    if (sizeBytes.some(byte => byte > 127)) throw new Error('Invalid speech MP3 metadata');
    const size = sizeBytes.reduce((value, byte) => value * 128 + byte, 0);
    const footer = buffer[offset + 5] & 0x10 ? 10 : 0;
    offset += 10 + size + footer;
    if (offset >= buffer.length) throw new Error('Speech MP3 has no audio frames');
  }
  return buffer.subarray(offset);
}

export async function synthesizeElevenV4({
  text, voiceId, outputFormat, apiKey, signal, fetchImpl = fetch,
}: {
  text: string; voiceId: string; outputFormat: string; apiKey: string;
  signal?: AbortSignal; fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const audio: Buffer[] = [];
  for (const chunk of splitDialogueText(text)) {
    const response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${encodeURIComponent(outputFormat)}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({model_id: 'eleven_v4', inputs: [{text: chunk, voice_id: voiceId}]}),
        signal,
      }
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs v4 synthesis failed (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('ElevenLabs returned empty audio');
    audio.push(buffer);
  }
  if (!audio.length) throw new Error('Speech text is empty');
  // PCM is joined before its single WAV header is written by the caller.
  // An ID3 tag at an internal MP3 boundary is decoded as a broken packet.
  // Keep the first file's metadata and join only MPEG frames thereafter.
  return Buffer.concat(audio.map((part, index) => index > 0 && outputFormat.startsWith('mp3_')
    ? withoutLeadingId3Tags(part) : part));
}
