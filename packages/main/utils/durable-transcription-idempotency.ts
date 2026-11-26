export function buildDurableTranscriptionRequestIdempotencyKey({
  recoveryKey,
  fallbackIdempotencyKey,
  nonce,
}: {
  recoveryKey?: string;
  fallbackIdempotencyKey?: string;
  nonce?: string;
}): string | undefined {
  const normalizedRecoveryKey = String(recoveryKey || '').trim();
  const normalizedNonce = String(nonce || '').trim();
  if (normalizedRecoveryKey) {
    return normalizedNonce
      ? `durable-transcription-request-v1:${normalizedRecoveryKey}:${normalizedNonce}`
      : `durable-transcription-request-v1:${normalizedRecoveryKey}`;
  }
  const normalizedFallback = String(fallbackIdempotencyKey || '').trim();
  return normalizedFallback || undefined;
}
