import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { DevAppController } from './dev-app-controller.mjs';
import { TranslationSessionStore } from './session-store.mjs';

const store = new TranslationSessionStore({
  root: process.env.TRANSLATOR_AGENT_SESSION_ROOT || undefined,
});
const app = new DevAppController();

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function buildServer() {
  const server = new McpServer(
    { name: 'stage5-translator', version: '0.1.0' },
    {
      instructions:
        "Use translation sessions to translate or review SRT cues with the connected LLM subscription. This path has no Translator inference charge because the client model supplies the text. Transcription, dubbing, and hosted AI remain outside this free tool set. Call create_translation_session, then repeatedly get_translation_batch and submit_translation_batch, then export_translation_srt. The development-app tools are local-only and require app_launch first. app_video_search and app_video_search_more invoke the app's configured Stage5-credit or BYO recommendation model; status, library, and download tools do not invoke that model. Batch downloads must use current recommendation result IDs and are bounded to eight items. Navigation tools may open visible app sections or explicit web pages but cannot interact with forms. app_open_credit_checkout may create and open a Stripe checkout session, but entering or submitting payment information remains exclusively manual. Settings tools never return stored secret values; completed purchases, entitlement checkout submission, and admin resets remain manual-only.",
    }
  );

  server.registerTool(
    'create_translation_session',
    {
      description:
        'Create a persistent, local SRT translation or review session. No network request or paid inference is performed.',
      inputSchema: z.object({
        source_srt: z.string().min(1),
        target_language: z.string().min(1),
        source_language: z.string().default('auto'),
        existing_translation_srt: z.string().min(1).optional(),
      }),
    },
    async input =>
      result(
        await store.create({
          sourceSrt: input.source_srt,
          targetLanguage: input.target_language,
          sourceLanguage: input.source_language,
          existingTranslationSrt: input.existing_translation_srt,
        })
      )
  );

  server.registerTool(
    'get_translation_batch',
    {
      description:
        'Get the next untranslated or unreviewed SRT cues with adjacent context.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translate', 'review']).default('translate'),
        limit: z.number().int().min(1).max(20).default(8),
      }),
    },
    async input =>
      result(
        await store.getBatch(input.session_id, {
          mode: input.mode,
          limit: input.limit,
        })
      )
  );

  server.registerTool(
    'submit_translation_batch',
    {
      description:
        'Write translated or reviewed cue text into a local session. Existing translations can be revised safely.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translate', 'review']).default('translate'),
        translations: z
          .array(z.object({ id: z.string().min(1), text: z.string().min(1) }))
          .min(1)
          .max(20),
      }),
    },
    async input =>
      result(
        await store.submit(input.session_id, {
          mode: input.mode,
          translations: input.translations,
        })
      )
  );

  server.registerTool(
    'translation_session_status',
    {
      description: 'Return completion and review counts for a local session.',
      inputSchema: z.object({ session_id: z.string().min(8) }),
    },
    async input => result(await store.status(input.session_id))
  );

  server.registerTool(
    'export_translation_srt',
    {
      description:
        'Export a completed session as translation-only or bilingual SRT for Translator.',
      inputSchema: z.object({
        session_id: z.string().min(8),
        mode: z.enum(['translation', 'dual', 'source']).default('dual'),
        output_path: z.string().min(1).optional(),
      }),
    },
    async input =>
      result(
        await store.export(input.session_id, {
          mode: input.mode,
          outputPath: input.output_path,
        })
      )
  );

  server.registerTool(
    'app_launch',
    {
      description:
        'Launch the local development build of Translator under agent control.',
      inputSchema: z.object({}),
    },
    async () => result(await app.launch())
  );

  server.registerTool(
    'app_status',
    {
      description: 'Inspect the current local development-app state.',
      inputSchema: z.object({}),
    },
    async () => result(await app.status())
  );

  server.registerTool(
    'app_navigation_list',
    {
      description:
        'List named Translator destinations and whether each is currently rendered. This does not navigate or start checkout.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('navigationSnapshot'))
  );

  server.registerTool(
    'app_navigate',
    {
      description:
        'Open and focus a named Translator workspace or settings section for the user. This is a visible navigation handoff and does not submit forms.',
      inputSchema: z.object({
        destination: z.enum([
          'home',
          'create',
          'video-search',
          'downloads',
          'channels',
          'editor',
          'settings',
          'settings-credits',
          'settings-quality',
          'settings-provider',
          'settings-byo',
          'settings-api-keys',
        ]),
      }),
    },
    async input => result(await app.call('navigate', input))
  );

  server.registerTool(
    'app_open_web_page',
    {
      description:
        "Open an explicit http/https page in the user's default browser for viewing. The tool does not transfer credentials, fill forms, click buttons, or submit anything.",
      inputSchema: z.object({ url: z.url() }),
    },
    async input => result(await app.call('openExternalWebPage', input))
  );

  server.registerTool(
    'app_open_credit_checkout',
    {
      description:
        'Open Translator Settings at Credits and launch the selected Stage5 credit pack in secure Stripe checkout. Creating the checkout does not charge the user; card entry and payment submission remain manual.',
      inputSchema: z.object({
        pack: z.enum(['MICRO', 'STARTER', 'STANDARD', 'PRO']),
      }),
    },
    async input => result(await app.call('openCreditCheckout', input))
  );

  server.registerTool(
    'app_settings_show',
    {
      description:
        'Open or close Translator Settings in the local development app and return a masked settings snapshot.',
      inputSchema: z.object({ open: z.boolean().default(true) }),
    },
    async input => result(await app.call('showSettings', input))
  );

  server.registerTool(
    'app_settings_get',
    {
      description:
        'Read current Translator settings, credit status, entitlements, provider choices, and provider-key presence. Stored key values are never returned.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('settingsSnapshot'))
  );

  server.registerTool(
    'app_settings_update',
    {
      description:
        'Update one or more local Translator preferences. Quality choices can affect future credit or provider costs but this tool does not itself run AI or purchase credits.',
      inputSchema: z
        .object({
          quality_translation: z.boolean().optional(),
          quality_transcription: z.boolean().optional(),
          review_provider: z.enum(['openai', 'anthropic']).optional(),
          summary_quality: z.enum(['standard', 'high']).optional(),
          summary_provider: z.enum(['openai', 'anthropic']).optional(),
          stage5_dubbing_tts_provider: z
            .enum(['openai', 'elevenlabs'])
            .optional(),
          stage5_video_suggestion_mode: z.enum(['standard', 'high']).optional(),
          dub_voice: z
            .enum([
              'rachel',
              'adam',
              'josh',
              'sarah',
              'charlie',
              'emily',
              'matilda',
              'brian',
              'alloy',
              'echo',
              'fable',
              'onyx',
              'nova',
              'shimmer',
            ])
            .optional(),
          dub_ambient_mix: z.number().min(0).max(1).optional(),
          api_key_mode: z.boolean().optional(),
          translation_draft_provider: z
            .enum(['openai', 'anthropic'])
            .optional(),
          byo_video_suggestion_model: z
            .enum(['gpt-5.1', 'gpt-5.5', 'claude-sonnet-5', 'claude-opus-4-8'])
            .optional(),
          transcription_provider: z
            .enum(['stage5', 'openai', 'elevenlabs'])
            .optional(),
          dubbing_provider: z
            .enum(['stage5', 'openai', 'elevenlabs'])
            .optional(),
          openai_enabled: z.boolean().optional(),
          anthropic_enabled: z.boolean().optional(),
          elevenlabs_enabled: z.boolean().optional(),
        })
        .refine(
          input => Object.values(input).some(value => value !== undefined),
          {
            message: 'Provide at least one setting to update.',
          }
        ),
    },
    async input =>
      result(
        await app.call('updateSettings', {
          qualityTranslation: input.quality_translation,
          qualityTranscription: input.quality_transcription,
          reviewProvider: input.review_provider,
          summaryQuality: input.summary_quality,
          summaryProvider: input.summary_provider,
          stage5DubbingTtsProvider: input.stage5_dubbing_tts_provider,
          stage5VideoSuggestionMode: input.stage5_video_suggestion_mode,
          dubVoice: input.dub_voice,
          dubAmbientMix: input.dub_ambient_mix,
          apiKeyMode: input.api_key_mode,
          translationDraftProvider: input.translation_draft_provider,
          byoVideoSuggestionModel: input.byo_video_suggestion_model,
          transcriptionProvider: input.transcription_provider,
          dubbingProvider: input.dubbing_provider,
          openAiEnabled: input.openai_enabled,
          anthropicEnabled: input.anthropic_enabled,
          elevenLabsEnabled: input.elevenlabs_enabled,
        })
      )
  );

  server.registerTool(
    'app_settings_store_provider_key',
    {
      description:
        'Validate and securely replace a provider key in the development app. The value is passed to the app but is never returned or logged by the tool.',
      inputSchema: z.object({
        provider: z.enum(['openai', 'anthropic', 'elevenlabs']),
        api_key: z.string().min(8),
        validate: z.boolean().default(true),
      }),
    },
    async input =>
      result(
        await app.call('storeProviderKey', {
          provider: input.provider,
          apiKey: input.api_key,
          validate: input.validate,
        })
      )
  );

  server.registerTool(
    'app_settings_clear_provider_key',
    {
      description:
        'Delete a stored provider key and reconcile dependent provider choices. Requires the explicit confirmation value CLEAR.',
      inputSchema: z.object({
        provider: z.enum(['openai', 'anthropic', 'elevenlabs']),
        confirm: z.literal('CLEAR'),
      }),
    },
    async input => result(await app.call('clearProviderKey', input))
  );

  server.registerTool(
    'app_open_video',
    {
      description: 'Open an existing local video in the development app.',
      inputSchema: z.object({ path: z.string().min(1) }),
    },
    async input => result(await app.call('openVideo', { path: input.path }))
  );

  server.registerTool(
    'app_mount_subtitles',
    {
      description: 'Mount an existing local SRT in the development app.',
      inputSchema: z.object({ path: z.string().min(1) }),
    },
    async input =>
      result(await app.call('mountSubtitles', { path: input.path }))
  );

  server.registerTool(
    'app_set_subtitle_display',
    {
      description:
        'Show original text, translation, or both in the development app.',
      inputSchema: z.object({
        mode: z.enum(['original', 'translation', 'dual']),
      }),
    },
    async input => result(await app.call('setDisplayMode', input))
  );

  server.registerTool(
    'app_set_subtitle_style',
    {
      description: 'Choose the development app subtitle style.',
      inputSchema: z.object({
        style: z.enum(['Default', 'Classic', 'Boxed', 'LineBox']),
      }),
    },
    async input => result(await app.call('setSubtitleStyle', input))
  );

  server.registerTool(
    'app_show_download_history',
    {
      description: 'Open the development app Downloads library.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('showDownloadHistory'))
  );

  server.registerTool(
    'app_downloads_list',
    {
      description:
        'List Translator Downloads library entries by stable ID, including whether each saved local file is currently available. This returns library metadata, not arbitrary filesystem access.',
      inputSchema: z.object({
        query: z.string().optional(),
        availability: z.enum(['all', 'local', 'missing']).default('all'),
        limit: z.number().int().min(1).max(100).default(30),
      }),
    },
    async input => result(await app.call('listDownloadHistory', input))
  );

  server.registerTool(
    'app_downloads_open',
    {
      description:
        'Open an existing, locally available Downloads library item in Translator by its stable entry ID.',
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async input => result(await app.call('openDownloadHistoryItem', input))
  );

  server.registerTool(
    'app_downloads_redownload',
    {
      description:
        "Re-download a selected Downloads library item by stable ID through Translator's normal terms-compliant downloader. Uses only the source URL already stored for that entry. Poll app_status for progress.",
      inputSchema: z.object({
        id: z.string().min(1),
        quality: z
          .enum([
            'high',
            'mid',
            'low',
            '4320p',
            '2160p',
            '1440p',
            '1080p',
            '720p',
            '480p',
            '360p',
            '240p',
          ])
          .default('1080p'),
      }),
    },
    async input => result(await app.call('redownloadHistoryItem', input))
  );

  server.registerTool(
    'app_start_video_download',
    {
      description:
        "Start a terms-compliant video download from an explicit http/https URL using Translator's existing downloader. The file is added to the local Downloads library. Poll app_status for progress.",
      inputSchema: z.object({
        url: z.url(),
        quality: z
          .enum([
            'high',
            'mid',
            'low',
            '4320p',
            '2160p',
            '1440p',
            '1080p',
            '720p',
            '480p',
            '360p',
            '240p',
          ])
          .default('1080p'),
      }),
    },
    async input => result(await app.call('startVideoDownload', input))
  );

  server.registerTool(
    'app_video_search',
    {
      description:
        "Run Translator's built-in ranked YouTube recommendation/search agent and place its results in the visible app. This invokes the active Stage5-credit or BYO model and may incur the corresponding model/search cost.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(2000),
        preferred_language: z.string().min(2).max(24).optional(),
        target_country: z.string().max(100).optional(),
        recency: z.enum(['any', 'day', 'week', 'month', 'year']).optional(),
        include_download_history: z.boolean().optional(),
        include_watched_channels: z.boolean().optional(),
      }),
    },
    async input =>
      result(
        await app.call('searchVideos', {
          prompt: input.prompt,
          preferredLanguage: input.preferred_language,
          targetCountry: input.target_country,
          recency: input.recency,
          includeDownloadHistory: input.include_download_history,
          includeWatchedChannels: input.include_watched_channels,
        })
      )
  );

  server.registerTool(
    'app_video_search_more',
    {
      description:
        'Continue the current Translator video search and append new ranked results. This may invoke the configured recommendation model if cached candidates are exhausted.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('searchMoreVideos'))
  );

  server.registerTool(
    'app_video_search_status',
    {
      description:
        'Inspect the current recommendation search, progress trace, continuation availability, and ranked result IDs without running another paid search.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('videoSearchStatus'))
  );

  server.registerTool(
    'app_video_batch_download',
    {
      description:
        'Queue up to 8 current recommendation result IDs for sequential download into the Translator Downloads library. This uses the normal downloader, does not call the recommendation model, and does not mount every file as it completes.',
      inputSchema: z.object({
        result_ids: z.array(z.string().min(1)).min(1).max(8),
        quality: z
          .enum([
            'high',
            'mid',
            'low',
            '4320p',
            '2160p',
            '1440p',
            '1080p',
            '720p',
            '480p',
            '360p',
            '240p',
          ])
          .default('1080p'),
      }),
    },
    async input =>
      result(
        await app.call('startSuggestedVideoBatch', {
          ids: input.result_ids,
          quality: input.quality,
        })
      )
  );

  server.registerTool(
    'app_video_batch_cancel',
    {
      description:
        'Stop scheduling remaining items in the current recommendation download batch and cancel the active download when possible.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('cancelSuggestedVideoBatch'))
  );

  server.registerTool(
    'app_video_batch_status',
    {
      description:
        'Inspect the current recommendation download queue, active item, completed items, failures, and cookie/manual-verification state.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('suggestedVideoBatchStatus'))
  );

  return server;
}

process.on('SIGINT', async () => {
  await app.close();
  process.exit(0);
});

void serveStdio(buildServer);
console.error('Stage5 Translator MCP server running on stdio');
