import type {
  AllByoSettings,
  ByoVideoSuggestionModel,
  ErrorReportContext,
  AgentBridgeRequest,
  CreditPackId,
  PurchaseFailureReason,
  PurchaseFunnelEvent,
  PurchasePlacement,
  Stage5VideoSuggestionMode,
  VideoSuggestionModelPreference,
  VideoSuggestionRecency,
  VideoMetadataResult,
} from '@shared-types/app';

export function onHeartbeatPing(callback: () => void): () => void {
  return window.electron.onHeartbeatPing(callback) ?? (() => {});
}

export function trackPurchaseEvent(
  event: PurchaseFunnelEvent,
  context?: {
    packId?: CreditPackId;
    placement?: PurchasePlacement;
    failureReason?: PurchaseFailureReason;
  }
): Promise<{ success: boolean; error?: string }> {
  return window.electron.trackPurchaseEvent(event, context);
}

export function getAgentControlEnabled(): Promise<boolean> {
  return window.electron.getAgentControlEnabled();
}

export function setAgentControlEnabled(
  enabled: boolean
): Promise<{ success: boolean; enabled: boolean; error?: string }> {
  return window.electron.setAgentControlEnabled(enabled);
}

export function getAgentAllowedDirectories(): Promise<string[]> {
  return window.electron.getAgentAllowedDirectories();
}

export function addAgentAllowedDirectory(
  directory: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.addAgentAllowedDirectory(directory);
}

export function removeAgentAllowedDirectory(
  directory: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.removeAgentAllowedDirectory(directory);
}

export function getAgentSocketStatus(): Promise<{
  running: boolean;
  connectedClients: number;
  serverName: 'translator';
  transport: 'stdio';
  launcherPath: string | null;
  restartRequired: true;
}> {
  return window.electron.getAgentSocketStatus();
}

export function getAgentRuntimeContext(): Promise<Record<string, unknown>> {
  return window.electron.getAgentRuntimeContext();
}

export function agentV2ProbeSource(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2ProbeSource(input);
}

export function agentV2FetchSourceCaptions(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2FetchSourceCaptions(input);
}

export function agentV2InspectOutputDirectory(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2InspectOutputDirectory(input);
}

export function agentV2Doctor(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2Doctor(input);
}

export function agentV2InspectMedia(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2InspectMedia(input);
}

export function agentV2WriteTextOutput(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2WriteTextOutput(input);
}

export function agentV2TranscodeOutput(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2TranscodeOutput(input);
}

export function agentV2RenderPreview(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2RenderPreview(input);
}

export function agentV2ReserveTemporaryOutput(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2ReserveTemporaryOutput(input);
}

export function agentV2ClaimTemporaryOutput(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2ClaimTemporaryOutput(input);
}

export function agentV2DeleteTemporaryOutput(
  input: unknown
): Promise<Record<string, unknown>> {
  return window.electron.agentV2DeleteTemporaryOutput(input);
}

export function onAgentV2TranscodeProgress(
  callback: (progress: Record<string, unknown>) => void
): () => void {
  return window.electron.onAgentV2TranscodeProgress(callback);
}

export function checkAgentPathAllowed(filePath: string): Promise<boolean> {
  return window.electron.checkAgentPathAllowed(filePath);
}

export function showOpenDialog(options: {
  properties?: Array<'openDirectory' | 'createDirectory'>;
  title?: string;
}): Promise<{ canceled: boolean; filePaths: string[] }> {
  return window.electron.showOpenDialog(options);
}

export function onAgentBridgeRequest(
  callback: (request: AgentBridgeRequest) => void
): () => void {
  return window.electron.onAgentBridgeRequest(callback);
}

export function sendAgentBridgeResponse(
  channel: string,
  response: { result?: unknown; error?: string }
): void {
  window.electron.sendAgentBridgeResponse(channel, response);
}

export function reportAgentHistoryJobTerminal(payload: {
  historyId: string;
  operationId: string;
  routeToken: string;
}): void {
  window.electron.reportAgentHistoryJobTerminal(payload);
}

export function reportAgentMcpJobTerminal(payload: {
  jobId: string;
  operationId: string;
  routeToken: string;
}): void {
  window.electron.reportAgentMcpJobTerminal(payload);
}

export function onAgentControlChanged(
  callback: (payload: { enabled: boolean }) => void
): () => void {
  return window.electron.onAgentControlChanged(callback);
}

export function showMessage(message: string): Promise<void> {
  return window.electron.showMessage(message);
}

export function getLocaleUrl(lang: string): Promise<string> {
  return window.electron.getLocaleUrl(lang);
}

export function getLanguagePreference(): Promise<string | null> {
  return window.electron.getLanguagePreference();
}

export function setLanguagePreference(
  lang: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setLanguagePreference(lang);
}

export function getVideoMetadata(
  filePath: string
): Promise<VideoMetadataResult> {
  return window.electron.getVideoMetadata(filePath);
}

export function createCheckoutSession(
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO'
): Promise<string | null> {
  return window.electron.createCheckoutSession(packId);
}

export function createByoUnlockSession(): Promise<void> {
  return window.electron.createByoUnlockSession();
}

// Check if encryption is available for secure key storage
export function checkEncryptionAvailable(): Promise<boolean> {
  return window.electron.checkEncryptionAvailable();
}

export function getAllByoSettings(): Promise<AllByoSettings> {
  return window.electron.getAllByoSettings();
}

export function getOpenAiApiKey(): Promise<string | null> {
  return window.electron.getOpenAiApiKey();
}

export function setOpenAiApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setOpenAiApiKey(apiKey);
}

export function clearOpenAiApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearOpenAiApiKey();
}

export function validateOpenAiApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateOpenAiApiKey(apiKey);
}

export function getByoProviderEnabled(): Promise<boolean> {
  return window.electron.getByoProviderEnabled();
}

export function setByoProviderEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoProviderEnabled(enabled);
}

export function onCreditsUpdated(
  callback: (payload: {
    creditBalance: number;
    hoursBalance: number;
    creditsPerHour?: number;
    authoritative?: boolean;
    checkoutSessionId?: string | null;
  }) => void
): () => void {
  return window.electron.onCreditsUpdated(callback);
}

export function getCreditSnapshot(): Promise<{
  creditBalance: number;
  hoursBalance: number;
  creditsPerHour: number;
  authoritative: boolean;
  checkoutSessionId?: string | null;
} | null> {
  return window.electron.getCreditSnapshot();
}

export function refreshCreditSnapshot(force?: boolean): Promise<{
  creditBalance: number;
  hoursBalance: number;
  creditsPerHour: number;
  authoritative: boolean;
  checkoutSessionId?: string | null;
} | null> {
  return window.electron.refreshCreditSnapshot(force);
}

export function onCheckoutPending(callback: () => void): () => void {
  return window.electron.onCheckoutPending(callback);
}

export function onCheckoutConfirmed(callback: () => void): () => void {
  return window.electron.onCheckoutConfirmed(callback);
}

export function onCheckoutUnresolved(callback: () => void): () => void {
  return window.electron.onCheckoutUnresolved(callback);
}

export function onCheckoutCancelled(callback: () => void): () => void {
  return window.electron.onCheckoutCancelled(callback);
}

export function getEntitlements(): Promise<{
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  stage5AnthropicReviewAvailable: boolean;
  fetchedAt?: string;
}> {
  return window.electron.getEntitlements();
}

export function refreshEntitlements(): Promise<{
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  stage5AnthropicReviewAvailable: boolean;
  fetchedAt?: string;
}> {
  return window.electron.refreshEntitlements();
}

export function onEntitlementsUpdated(
  callback: (snapshot: {
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    stage5AnthropicReviewAvailable: boolean;
    fetchedAt?: string;
  }) => void
): () => void {
  return window.electron.onEntitlementsUpdated(callback);
}

export function onEntitlementsError(
  callback: (payload: { message: string }) => void
): () => void {
  return window.electron.onEntitlementsError(callback);
}

export function onByoUnlockPending(callback: () => void): () => void {
  return window.electron.onByoUnlockPending(callback);
}

export function onByoUnlockConfirmed(
  callback: (snapshot: {
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    stage5AnthropicReviewAvailable: boolean;
    fetchedAt?: string;
  }) => void
): () => void {
  return window.electron.onByoUnlockConfirmed(callback);
}

export function onByoUnlockCancelled(callback: () => void): () => void {
  return window.electron.onByoUnlockCancelled(callback);
}

export function onByoUnlockUnresolved(callback: () => void): () => void {
  return window.electron.onByoUnlockUnresolved(callback);
}

export function onByoUnlockError(
  callback: (payload: { message?: string }) => void
): () => void {
  return window.electron.onByoUnlockError(callback);
}

export function onOpenAiApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onOpenAiApiKeyChanged(callback);
}

// Anthropic API key functions
export function getAnthropicApiKey(): Promise<string | null> {
  return window.electron.getAnthropicApiKey();
}

export function setAnthropicApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setAnthropicApiKey(apiKey);
}

export function clearAnthropicApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearAnthropicApiKey();
}

export function validateAnthropicApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateAnthropicApiKey(apiKey);
}

export function getByoAnthropicEnabled(): Promise<boolean> {
  return window.electron.getByoAnthropicEnabled();
}

export function setByoAnthropicEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoAnthropicEnabled(enabled);
}

export function onAnthropicApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onAnthropicApiKeyChanged(callback);
}

export function isAdminMode(): Promise<boolean> {
  return window.electron.isAdminMode();
}

export function getErrorReportContext(): Promise<ErrorReportContext> {
  return window.electron.getErrorReportContext();
}

export function resetCredits(): Promise<{
  success: boolean;
  creditsAdded?: number;
  error?: string;
}> {
  return window.electron.resetCredits();
}

export function resetCreditsToZero(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.resetCreditsToZero();
}

// ElevenLabs API key functions
export function getElevenLabsApiKey(): Promise<string | null> {
  return window.electron.getElevenLabsApiKey();
}

export function setElevenLabsApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setElevenLabsApiKey(apiKey);
}

export function clearElevenLabsApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearElevenLabsApiKey();
}

export function validateElevenLabsApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateElevenLabsApiKey(apiKey);
}

export function getByoElevenLabsEnabled(): Promise<boolean> {
  return window.electron.getByoElevenLabsEnabled();
}

export function setByoElevenLabsEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoElevenLabsEnabled(enabled);
}

// API key mode
export function getApiKeyModeEnabled(): Promise<boolean> {
  return window.electron.getApiKeyModeEnabled();
}

export function setApiKeyModeEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setApiKeyModeEnabled(enabled);
}

// Claude translation preference
export function getPreferClaudeTranslation(): Promise<boolean> {
  return window.electron.getPreferClaudeTranslation();
}

export function setPreferClaudeTranslation(
  prefer: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferClaudeTranslation(prefer);
}

// Claude review preference
export function getPreferClaudeReview(): Promise<boolean> {
  return window.electron.getPreferClaudeReview();
}

export function setPreferClaudeReview(
  prefer: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferClaudeReview(prefer);
}

// Claude summary preference
export function getPreferClaudeSummary(): Promise<boolean> {
  return window.electron.getPreferClaudeSummary();
}

export function setPreferClaudeSummary(
  prefer: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferClaudeSummary(prefer);
}

export function getStage5VideoSuggestionMode(): Promise<Stage5VideoSuggestionMode> {
  return window.electron.getStage5VideoSuggestionMode();
}

export function setStage5VideoSuggestionMode(
  mode: Stage5VideoSuggestionMode
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setStage5VideoSuggestionMode(mode);
}

export function getByoVideoSuggestionModel(): Promise<ByoVideoSuggestionModel> {
  return window.electron.getByoVideoSuggestionModel();
}

export function setByoVideoSuggestionModel(
  model: ByoVideoSuggestionModel
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoVideoSuggestionModel(model);
}

export function getVideoSuggestionModelPreference(): Promise<VideoSuggestionModelPreference> {
  return window.electron.getVideoSuggestionModelPreference();
}

export function setVideoSuggestionModelPreference(
  model: VideoSuggestionModelPreference
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setVideoSuggestionModelPreference(model);
}

export function getVideoSuggestionTargetCountry(): Promise<string> {
  return window.electron.getVideoSuggestionTargetCountry();
}

export function setVideoSuggestionTargetCountry(
  country: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setVideoSuggestionTargetCountry(country);
}

export function getVideoSuggestionRecency(): Promise<VideoSuggestionRecency> {
  return window.electron.getVideoSuggestionRecency();
}

export function setVideoSuggestionRecency(
  recency: VideoSuggestionRecency
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setVideoSuggestionRecency(recency);
}

export function getVideoSuggestionPreferenceTopic(): Promise<string> {
  return window.electron.getVideoSuggestionPreferenceTopic();
}

export function setVideoSuggestionPreferenceTopic(
  value: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setVideoSuggestionPreferenceTopic(value);
}

// Transcription provider preference
export type TranscriptionProvider = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredTranscriptionProvider(): Promise<TranscriptionProvider> {
  return window.electron.getPreferredTranscriptionProvider();
}

export function setPreferredTranscriptionProvider(
  provider: TranscriptionProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferredTranscriptionProvider(provider);
}

// Dubbing provider preference
export type DubbingProvider = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredDubbingProvider(): Promise<DubbingProvider> {
  return window.electron.getPreferredDubbingProvider();
}

export function setPreferredDubbingProvider(
  provider: DubbingProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferredDubbingProvider(provider);
}

// Stage5 dubbing TTS provider (when using Stage5 API)
// 'openai' = cheaper ($15/1M chars), 'elevenlabs' = premium ($200/1M chars)
export type Stage5TtsProvider = 'openai' | 'elevenlabs';

export function getStage5DubbingTtsProvider(): Promise<Stage5TtsProvider> {
  return window.electron.getStage5DubbingTtsProvider();
}

export function setStage5DubbingTtsProvider(
  provider: Stage5TtsProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setStage5DubbingTtsProvider(provider);
}

export function onElevenLabsApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onElevenLabsApiKeyChanged(callback);
}
