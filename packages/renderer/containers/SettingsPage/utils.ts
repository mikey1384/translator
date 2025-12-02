// TTS credits per minute of speech (based on ~750 chars/min average speech rate)
// OpenAI: $15/1M chars * 2 margin / USD_PER_CREDIT ≈ 1.05 credits/char → ~788 credits/min
// ElevenLabs: $200/1M chars * 2 margin / USD_PER_CREDIT ≈ 14 credits/char → ~10,500 credits/min
export const TTS_CREDITS_PER_MINUTE = {
  openai: 788,
  elevenlabs: 10500,
} as const;

export function formatDubbingTime(
  credits: number,
  provider: 'openai' | 'elevenlabs'
): string {
  const creditsPerMin = TTS_CREDITS_PER_MINUTE[provider];
  const minutes = credits / creditsPerMin;
  if (minutes < 1) {
    const seconds = Math.floor(minutes * 60);
    return `~${seconds}s`;
  }
  if (minutes < 60) {
    return `~${Math.floor(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = Math.floor(minutes % 60);
  if (remainingMins === 0) {
    return `~${hours}h`;
  }
  return `~${hours}h ${remainingMins}m`;
}
