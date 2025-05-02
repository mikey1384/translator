declare module 'electron-store' {
  type ElectronStoreOptions<T extends Record<string, any>> = {
    name?: string;
    defaults?: Partial<T>;
    cwd?: string;
    encryptionKey?: string | Buffer;
    fileExtension?: string;
    clearInvalidConfig?: boolean;
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    accessPropertiesByDotNotation?: boolean;
    watch?: boolean;
    migrations?: Record<string, (store: ElectronStore<T>) => void>;
    beforeEachMigration?: (
      store: ElectronStore<T>,
      context: { fromVersion: string; toVersion: string }
    ) => void;
    afterEachMigration?: (
      store: ElectronStore<T>,
      context: { fromVersion: string; toVersion: string }
    ) => void;
    projectVersion?: string;
    scheme?: 'file' | 'app';
  };

  class ElectronStore<T extends Record<string, any> = Record<string, unknown>> {
    constructor(options?: ElectronStoreOptions<T>);

    // Properties
    readonly path: string;
    readonly size: number;

    // Methods
    get<K extends keyof T>(key: K): T[K];
    get<K extends keyof T, D>(key: K, defaultValue: D): T[K] | D;
    get(): T;

    set<K extends keyof T>(key: K, value: T[K]): void;
    set(value: Partial<T>): void;

    has<K extends keyof T>(key: K): boolean;

    reset(...keys: Array<keyof T>): void;
    reset(): void;

    delete<K extends keyof T>(key: K): boolean;

    clear(): void;

    onDidChange<K extends keyof T>(
      key: K,
      callback: (newValue: T[K], oldValue: T[K]) => void
    ): () => void;

    onDidAnyChange(callback: (newValue: T, oldValue: T) => void): () => void;

    store: T;
  }

  export default ElectronStore;
}

// Type definitions for node-machine-id
declare module 'node-machine-id' {
  /**
   * Returns the machine id synchronously
   * @param original - If true, returns the original value, not a hashed one
   */
  export function machineIdSync(original?: boolean): string;

  /**
   * Returns the machine id asynchronously
   * @param original - If true, returns the original value, not a hashed one
   */
  export function machineId(original?: boolean): Promise<string>;

  const pkg: {
    machineIdSync: typeof machineIdSync;
    machineId: typeof machineId;
  };

  export default pkg;
}

// Type definitions for webrtcvad
declare module 'webrtcvad' {
  /**
   * Voice Activity Detection modes
   * 0 = Quality mode - least aggressive
   * 1 = Low bitrate mode
   * 2 = Aggressive mode
   * 3 = Very aggressive mode
   */
  export type VadMode = 0 | 1 | 2 | 3;

  class Vad {
    /**
     * Creates a new Vad instance
     * @param sampleRate The sample rate of the audio (usually 16000, 32000, etc)
     * @param mode The mode to use (0-3), default 2
     */
    constructor(sampleRate: number, mode?: VadMode);

    /**
     * Set the mode
     * @param mode The mode to use (0-3)
     */
    setMode(mode: VadMode): void;

    /**
     * Process a chunk of PCM audio data
     * @param audioFrame PCM audio data buffer
     * @returns Boolean indicating whether voice was detected
     */
    process(audioFrame: Buffer): boolean;
  }

  export default Vad;
}
