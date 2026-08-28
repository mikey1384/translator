import type { BigIntStats } from 'node:fs';

import { fingerprintAgentOutputFile } from './agent-output-receipt.js';

export type AgentFileFingerprint = {
  sha256: string;
  bytes: number;
};

export type AgentTranscodeSourceVerification = {
  verified: boolean;
  metadataOnlyChange: boolean;
  reason:
    | null
    | 'identity_or_content_metadata_changed'
    | 'metadata_changed_without_fingerprint'
    | 'fingerprint_mismatch';
};

type FileSnapshot = Pick<
  BigIntStats,
  'dev' | 'ino' | 'size' | 'mtimeNs' | 'ctimeNs'
>;

function sameSnapshotFields(
  left: FileSnapshot,
  right: FileSnapshot,
  fields: Array<keyof FileSnapshot>
): boolean {
  return fields.every(field => left[field] === right[field]);
}

export function parseExpectedAgentFileFingerprint(
  value: {
    sha256?: unknown;
    bytes?: unknown;
  } | null
): AgentFileFingerprint | null {
  if (!value || (value.sha256 === undefined && value.bytes === undefined)) {
    return null;
  }
  const sha256 =
    typeof value.sha256 === 'string' ? value.sha256.trim().toLowerCase() : '';
  const bytes = value.bytes;
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    typeof bytes !== 'number' ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0
  ) {
    throw new Error('Expected transcode source fingerprint is invalid.');
  }
  return { sha256, bytes };
}

export async function verifyAgentTranscodeSourceSnapshot({
  sourcePath,
  before,
  after,
  expectedFingerprint,
  fingerprintFile = fingerprintAgentOutputFile,
}: {
  sourcePath: string;
  before: FileSnapshot;
  after: FileSnapshot;
  expectedFingerprint: AgentFileFingerprint | null;
  fingerprintFile?: (filePath: string) => Promise<AgentFileFingerprint>;
}): Promise<AgentTranscodeSourceVerification> {
  const identityAndContentMetadataUnchanged = sameSnapshotFields(
    before,
    after,
    ['dev', 'ino', 'size', 'mtimeNs']
  );
  if (!identityAndContentMetadataUnchanged) {
    return {
      verified: false,
      metadataOnlyChange: false,
      reason: 'identity_or_content_metadata_changed',
    };
  }
  if (before.ctimeNs === after.ctimeNs) {
    return { verified: true, metadataOnlyChange: false, reason: null };
  }
  if (!expectedFingerprint) {
    return {
      verified: false,
      metadataOnlyChange: true,
      reason: 'metadata_changed_without_fingerprint',
    };
  }
  if (BigInt(expectedFingerprint.bytes) !== after.size) {
    return {
      verified: false,
      metadataOnlyChange: true,
      reason: 'fingerprint_mismatch',
    };
  }
  const actual = await fingerprintFile(sourcePath);
  const verified =
    actual.bytes === expectedFingerprint.bytes &&
    actual.sha256 === expectedFingerprint.sha256;
  return {
    verified,
    metadataOnlyChange: true,
    reason: verified ? null : 'fingerprint_mismatch',
  };
}
