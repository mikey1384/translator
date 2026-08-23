export interface PackagedSocketPathOptions {
  platformName?: NodeJS.Platform;
  homeDirectory?: string;
  appDataDirectory?: string;
  configDirectory?: string;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
}

export interface PackagedSocketDiscoveryCandidate {
  socketPath: string;
  protocolVersion: number | null;
  instanceToken: string | null;
}

export function getPackagedSocketPath(
  options?: PackagedSocketPathOptions
): string;

export function getPackagedSocketPathCandidates(
  options?: PackagedSocketPathOptions
): string[];

export function getPackagedSocketDiscoveryCandidates(
  options?: PackagedSocketPathOptions
): PackagedSocketDiscoveryCandidate[];
