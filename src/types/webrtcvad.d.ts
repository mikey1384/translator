declare module 'webrtcvad' {
  class Vad {
    constructor(sampleRate: 8000 | 16000 | 32000 | 48000, level: 0 | 1 | 2 | 3); // Takes sampleRate and level/mode
    process(audio: Buffer): boolean; // Correct method name and signature
  }
  export default Vad;
}
