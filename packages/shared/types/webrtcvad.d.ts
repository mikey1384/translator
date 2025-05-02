// src/types/webrtcvad.d.ts
declare module 'webrtcvad' {
  // 1. Define the actual class constructor type
  class VadClass {
    constructor(sampleRate: 8000 | 16000 | 32000 | 48000, level: 0 | 1 | 2 | 3);
    process(audio: Buffer): boolean;
  }

  // 2. Define the shape of the inner default object seen in the log
  interface InnerDefault {
    __esModule: true;
    default: typeof VadClass; // The *inner* default holds the class
  }

  // 3. Define the shape of the outer module object (what we import)
  interface VadModule {
    __esModule: true;
    default: InnerDefault; // The *outer* default holds the inner object
  }

  // 4. Export the shape of the entire module using 'export ='
  const moduleExport: VadModule;
  export = moduleExport;
}
