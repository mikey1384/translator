/**
 * Exact installed-app methods exposed by the packaged MCP bridge.
 * Human-gated checkout, settings mutation, and provider-key methods are
 * intentionally absent. This module is shared with the app-side socket gate.
 */
export const PACKAGED_TOOL_MAP = Object.freeze({
  app_status: 'status',
  app_navigation_list: 'navigationSnapshot',
  app_navigate: 'navigate',
  app_open_web_page: 'openExternalWebPage',
  app_settings_show: 'showSettings',
  app_settings_get: 'settingsSnapshot',
  app_open_video: 'openVideo',
  app_mount_subtitles: 'mountSubtitles',
  app_set_subtitle_display: 'setDisplayMode',
  app_set_subtitle_style: 'setSubtitleStyle',
  app_show_download_history: 'showDownloadHistory',
  app_downloads_list: 'listDownloadHistory',
  app_downloads_open: 'openDownloadHistoryItem',
  app_downloads_redownload: 'redownloadHistoryItem',
  app_video_search: 'searchVideos',
  app_video_search_more: 'searchMoreVideos',
  app_video_search_status: 'videoSearchStatus',
  app_video_search_cancel: 'cancelVideoSearch',
  app_video_batch_download: 'startSuggestedVideoBatch',
  app_video_batch_cancel: 'cancelSuggestedVideoBatch',
  app_video_batch_status: 'suggestedVideoBatchStatus',
  app_start_video_download: 'startVideoDownload',
  app_start_transcription: 'startTranscription',
  app_start_translation: 'startTranslation',
  app_start_dubbing: 'startDubbing',
  app_start_summary: 'startSummary',
  app_start_cue_translation: 'startCueTranslation',
  app_start_cue_transcription: 'startCueTranscription',
  app_start_merge: 'startMerge',
  app_start_media_workflow: 'startMediaWorkflow',
  app_processing_status: 'processingStatus',
  app_processing_cancel: 'cancelProcessing',
  app_subtitles_get: 'subtitlesBatch',
  app_subtitles_update: 'updateSubtitles',
  app_subtitles_mutate: 'mutateSubtitles',
  app_subtitles_export: 'exportSubtitles',
});

export const PACKAGED_AGENT_METHODS = Object.freeze([
  ...Object.values(PACKAGED_TOOL_MAP),
  // Internal primitives used only by the persistent high-level MCP v2
  // service. They remain behind the same authenticated app socket and its
  // main-process path authorization boundary.
  'mcpContext',
  'mcpDoctor',
  'probeSource',
  'fetchSourceCaptions',
  'inspectOutputDirectory',
  'applyTranslationSession',
  'startPresetRender',
  'renderPreview',
  'inspectMedia',
  'writeAgentOutputText',
]);
