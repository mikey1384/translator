import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { DisconnectAwareStdioServerTransport } from './disconnect-aware-stdio-transport.mjs';
import { DevAppController } from './dev-app-controller.mjs';
import { createNativeOwnerMonitor } from './native-owner-monitor.mjs';
import { TranslationSessionStore } from './session-store.mjs';
import { PersistentJobStore } from './job-store.mjs';
import {
  MCP_SERVER_NAMES,
  MCP_SERVER_VERSION,
  MCP_V2_PROTOCOL_VERSION,
  MCP_V2_TOOL_DEFINITIONS,
} from './mcp-v2-contract.mjs';
import {
  McpV2Service,
  legacyToolDescription,
  legacyResultContext,
  legacyToolBilling,
} from './mcp-v2-service.mjs';
import {
  installTransportBoundLifecycle,
  shouldForceDevelopmentShutdown,
} from './transport-bound-lifecycle.mjs';

const store = new TranslationSessionStore({
  root: process.env.TRANSLATOR_AGENT_SESSION_ROOT || undefined,
});
let lifecycle = null;
const ownerMonitor = createNativeOwnerMonitor({
  onOwnershipLost: reason => lifecycle?.requestShutdown(reason, 1),
});
const app = new DevAppController({ ownerMonitor });
const jobStore = new PersistentJobStore({ environment: 'development' });
const v2Service = new McpV2Service({
  environment: 'development',
  store: jobStore,
  callApp: async (method, params) => {
    await app.launch();
    return app.call(method, params);
  },
});
const optionalHistoryId = z.string().min(1).max(512).optional();
const optionalOperationId = z.string().min(1).max(200).optional();

function result(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function v2Result(execution) {
  return {
    content: [{ type: 'text', text: JSON.stringify(execution.value, null, 2) }],
    structuredContent: execution.value,
    ...(execution.isError ? { isError: true } : {}),
  };
}

function registerV2Tools(server) {
  for (const [name, definition] of Object.entries(MCP_V2_TOOL_DEFINITIONS)) {
    // This legacy session tool keeps its established name. It is registered
    // below with a discriminated session/job schema and dispatches v2 calls
    // when job_id is present.
    if (name === 'submit_translation_batch') continue;
    server.registerTool(
      name,
      {
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema),
      },
      async input => v2Result(await v2Service.execute(name, input))
    );
  }
}

async function developmentLegacyContext() {
  try {
    const raw = await app.call('mcpContext', {});
    return {
      connected: true,
      version: raw?.app?.version || null,
      stage5: raw?.stage5 || { account: null, credits: null },
      providers: raw?.providers || {},
    };
  } catch (error) {
    return {
      connected: false,
      version: null,
      stage5: { account: null, credits: null },
      providers: {},
      connection_error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function decorateLegacyToolResult(toolResult, toolName, args) {
  const structured = toolResult?.structuredContent;
  if (
    structured?.schema_version === 1 &&
    typeof structured?.environment === 'string'
  ) {
    return toolResult;
  }
  const context = await developmentLegacyContext();
  const metadata = legacyResultContext(
    'development',
    context,
    toolName,
    legacyToolBilling(toolName, args, context)
  );
  const decorated = isPlainObject(structured)
    ? { ...structured, _mcp: metadata }
    : { value: structured ?? null, _mcp: metadata };
  return {
    ...toolResult,
    structuredContent: decorated,
    content: [{ type: 'text', text: JSON.stringify(decorated, null, 2) }],
  };
}

async function legacyToolErrorResult(error, toolName, args) {
  const context = await developmentLegacyContext();
  const decorated = {
    error: {
      code: error?.code || 'LEGACY_TOOL_FAILED',
      message: error instanceof Error ? error.message : String(error),
      delivery_state: error?.deliveryState || null,
    },
    _mcp: legacyResultContext(
      'development',
      context,
      toolName,
      legacyToolBilling(toolName, args, context)
    ),
  };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(decorated, null, 2) }],
    structuredContent: decorated,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildServer() {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAMES.development,
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Use translation sessions to translate or review SRT cues with the connected LLM subscription. That local session path has no Translator inference charge because the client model supplies the text. The development-app tools are local-only and require app_launch first. app_start_media_workflow provides complete URL/path -> transcription -> summary/highlights, translation, or dubbing orchestration; the individual app_start_transcription, app_start_translation, app_start_dubbing, and app_start_summary tools operate on mounted media or subtitles. These app processing tools use Translator's configured Stage5 credits or BYO providers exactly like the visible UI, return immediately, and must be followed with app_processing_status. Mounted cues can be inspected, edited, and exported with the app_subtitles tools. app_video_search and app_video_search_more also invoke the configured Stage5-credit or BYO model; status, library, and download-only tools do not. Batch downloads use current recommendation IDs and are bounded to eight items. Navigation can open visible app sections or explicit web pages but cannot interact with forms. app_open_credit_checkout may create and open a Stripe checkout session, but payment entry and submission remain manual. Settings never return stored secret values; completed purchases, entitlement checkout submission, cookie/login verification, and admin resets remain manual-only.",
    }
  );

  const registerTool = server.registerTool.bind(server);
  server.registerTool = (name, config, callback) =>
    registerTool(
      name,
      Object.hasOwn(MCP_V2_TOOL_DEFINITIONS, name)
        ? config
        : {
            ...config,
            description: legacyToolDescription(name, config.description),
          },
      async (...callbackArgs) => {
        try {
          const toolResult = await callback(...callbackArgs);
          return decorateLegacyToolResult(
            toolResult,
            name,
            callbackArgs[0] || {}
          );
        } catch (error) {
          return legacyToolErrorResult(error, name, callbackArgs[0] || {});
        }
      }
    );

  registerV2Tools(server);

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
        'Submit an exact issued MCP v2 job batch, or update a legacy local translation session.',
      inputSchema: z.union([
        z
          .object({
            job_id: z.string().min(8).max(80),
            batch_id: z.string().min(8).max(120),
            translations: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(200),
                    text: z.string().min(1).max(10_000),
                  })
                  .strict()
              )
              .min(1)
              .max(40),
          })
          .strict(),
        z
          .object({
            session_id: z.string().min(8).max(120),
            mode: z.enum(['translate', 'review']).default('translate'),
            translations: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(200),
                    text: z.string().min(1).max(10_000),
                  })
                  .strict()
              )
              .min(1)
              .max(40),
          })
          .strict(),
      ]),
    },
    async input => {
      if (input.job_id && input.batch_id) {
        return v2Result(
          await v2Service.execute('submit_translation_batch', {
            job_id: input.job_id,
            batch_id: input.batch_id,
            translations: input.translations,
          })
        );
      }
      return result(
        await store.submit(input.session_id, {
          mode: input.mode,
          translations: input.translations,
        })
      );
    }
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
      inputSchema: z.object({ history_id: optionalHistoryId }),
    },
    async input => result(await app.status({ historyId: input.history_id }))
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
      description:
        'Open an existing local video in the development app. Existing mounted subtitles are preserved unless replacement is explicitly authorized.',
      inputSchema: z.object({
        path: z.string().min(1),
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
      }),
    },
    async input =>
      result(
        await app.call('openVideo', {
          path: input.path,
          replaceSubtitles: input.replace_subtitles,
        })
      )
  );

  server.registerTool(
    'app_mount_subtitles',
    {
      description:
        'Mount an existing local SRT in the development app. Existing mounted subtitles are preserved unless replacement is explicitly authorized.',
      inputSchema: z.object({
        path: z.string().min(1),
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
      }),
    },
    async input =>
      result(
        await app.call('mountSubtitles', {
          path: input.path,
          replaceSubtitles: input.replace_subtitles,
        })
      )
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
      inputSchema: z.object({
        id: z.string().min(1),
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
      }),
    },
    async input =>
      result(
        await app.call('openDownloadHistoryItem', {
          id: input.id,
          replaceSubtitles: input.replace_subtitles,
        })
      )
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
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
      }),
    },
    async input =>
      result(
        await app.call('redownloadHistoryItem', {
          id: input.id,
          quality: input.quality,
          replaceSubtitles: input.replace_subtitles,
        })
      )
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
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
      }),
    },
    async input =>
      result(
        await app.call('startVideoDownload', {
          url: input.url,
          quality: input.quality,
          replaceSubtitles: input.replace_subtitles,
        })
      )
  );

  server.registerTool(
    'app_start_transcription',
    {
      description:
        "Start transcription of the currently mounted video with Translator's configured Stage5-credit or BYO provider. Returns immediately; poll app_processing_status.",
      inputSchema: z.object({
        replace_subtitles: z.enum(['fail', 'discard', 'save']).default('fail'),
        history_id: optionalHistoryId,
      }),
    },
    async input =>
      result(
        await app.call('startTranscription', {
          replaceSubtitles: input.replace_subtitles,
          historyId: input.history_id,
        })
      )
  );

  server.registerTool(
    'app_start_translation',
    {
      description:
        "Translate every mounted subtitle cue to a target language with Translator's configured Stage5-credit or BYO provider. Returns immediately; poll app_processing_status.",
      inputSchema: z.object({
        target_language: z.string().min(2).max(80),
        history_id: optionalHistoryId,
      }),
    },
    async input =>
      result(
        await app.call('startTranslation', {
          targetLanguage: input.target_language,
          historyId: input.history_id,
        })
      )
  );

  server.registerTool(
    'app_start_dubbing',
    {
      description:
        "Generate dubbed media from mounted subtitles with Translator's configured Stage5-credit or BYO provider. Missing translations can be generated first. Returns immediately; poll app_processing_status.",
      inputSchema: z.object({
        target_language: z.string().min(2).max(80).optional(),
        voice: z
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
        translate_if_needed: z.boolean().default(true),
      }),
    },
    async input =>
      result(
        await app.call('startDubbing', {
          targetLanguage: input.target_language,
          voice: input.voice,
          translateIfNeeded: input.translate_if_needed,
        })
      )
  );

  server.registerTool(
    'app_start_summary',
    {
      description:
        "Generate a summary, sections, and optional highlights from mounted subtitles with Translator's configured Stage5-credit or BYO provider. Returns immediately; poll app_processing_status for the result.",
      inputSchema: z.object({
        target_language: z.string().min(2).max(80).optional(),
        effort_level: z.enum(['standard', 'high']).optional(),
        include_highlights: z.boolean().default(true),
      }),
    },
    async input =>
      result(
        await app.call('startSummary', {
          targetLanguage: input.target_language,
          effortLevel: input.effort_level,
          includeHighlights: input.include_highlights,
        })
      )
  );

  server.registerTool(
    'app_start_cue_translation',
    {
      description:
        "Translate or improve one mounted cue by stable ID with nearby context, using Translator's configured Stage5-credit or BYO provider. The existing translation is preserved unless a new result succeeds. Poll app_processing_status.",
      inputSchema: z.object({
        id: z.string().min(1),
        target_language: z.string().min(2).max(80),
      }),
    },
    async input =>
      result(
        await app.call('startCueTranslation', {
          id: input.id,
          targetLanguage: input.target_language,
        })
      )
  );

  server.registerTool(
    'app_start_cue_transcription',
    {
      description:
        "Retranscribe or improve one mounted cue by stable ID from the mounted source video, using Translator's configured Stage5-credit or BYO provider. Existing text is preserved unless a new result succeeds. Poll app_processing_status.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async input =>
      result(await app.call('startCueTranscription', { id: input.id }))
  );

  server.registerTool(
    'app_start_merge',
    {
      description:
        'Burn the mounted subtitles into the mounted video using the current display/style settings and save to an explicit absolute MP4 path without a native save dialog. Existing files are refused unless confirm_overwrite=OVERWRITE. Returns immediately; poll app_processing_status.',
      inputSchema: z.object({
        output_path: z.string().min(1),
        confirm_overwrite: z.literal('OVERWRITE').optional(),
        history_id: optionalHistoryId,
      }),
    },
    async input =>
      result(
        await app.call('startMerge', {
          outputPath: input.output_path,
          overwrite: input.confirm_overwrite === 'OVERWRITE',
          historyId: input.history_id,
        })
      )
  );

  server.registerTool(
    'app_start_media_workflow',
    {
      description:
        'Run the complete Translator workflow from an explicit URL, local path, or currently mounted video through download/open, transcription, summary/highlights, translation, or dubbing. Paid inference follows the app settings. Returns immediately; poll app_processing_status.',
      inputSchema: z
        .object({
          url: z.url().optional(),
          path: z.string().min(1).optional(),
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
          run_to: z
            .enum(['download', 'transcribe', 'summary', 'translate', 'dub'])
            .default('transcribe'),
          target_language: z.string().min(2).max(80).optional(),
          summary_effort_level: z.enum(['standard', 'high']).optional(),
          include_highlights: z.boolean().default(true),
          voice: z
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
          replace_subtitles: z
            .enum(['fail', 'discard', 'save'])
            .default('fail'),
        })
        .refine(input => !(input.url && input.path), {
          message: 'Choose either url or path, not both.',
        })
        .refine(
          input =>
            !['translate', 'dub'].includes(input.run_to) ||
            Boolean(input.target_language),
          {
            message:
              'target_language is required when run_to is translate or dub.',
          }
        ),
    },
    async input =>
      result(
        await app.call('startMediaWorkflow', {
          url: input.url,
          path: input.path,
          quality: input.quality,
          runTo: input.run_to,
          targetLanguage: input.target_language,
          summaryEffortLevel: input.summary_effort_level,
          includeHighlights: input.include_highlights,
          voice: input.voice,
          replaceSubtitles: input.replace_subtitles,
        })
      )
  );

  server.registerTool(
    'app_processing_status',
    {
      description:
        'Inspect the active or last app-controlled download, transcription, translation, dubbing, summary, and merge operation with progress and output paths.',
      inputSchema: z.object({
        history_id: optionalHistoryId,
        operation_id: optionalOperationId,
      }),
    },
    async input =>
      result(
        await app.call('processingStatus', {
          historyId: input.history_id,
          operationId: input.operation_id,
        })
      )
  );

  server.registerTool(
    'app_processing_cancel',
    {
      description:
        'Cancel the active Translator download or media-processing operation and preserve any previously completed durable results.',
      inputSchema: z.object({
        history_id: optionalHistoryId,
        operation_id: optionalOperationId,
      }),
    },
    async input =>
      result(
        await app.call('cancelProcessing', {
          historyId: input.history_id,
          operationId: input.operation_id,
        })
      )
  );

  server.registerTool(
    'app_subtitles_get',
    {
      description:
        'Read a bounded page of mounted subtitle cues, including stable IDs, timing, original text, and translations.',
      inputSchema: z.object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        history_id: optionalHistoryId,
      }),
    },
    async input =>
      result(
        await app.call('subtitlesBatch', {
          offset: input.offset,
          limit: input.limit,
          historyId: input.history_id,
        })
      )
  );

  server.registerTool(
    'app_subtitles_update',
    {
      description:
        'Update mounted subtitle text or timing by stable cue ID. Changes stay in the app until saved or exported.',
      inputSchema: z.object({
        updates: z
          .array(
            z
              .object({
                id: z.string().min(1),
                original: z.string().optional(),
                translation: z.string().optional(),
                start: z.number().min(0).optional(),
                end: z.number().positive().optional(),
              })
              .refine(
                update =>
                  update.original !== undefined ||
                  update.translation !== undefined ||
                  update.start !== undefined ||
                  update.end !== undefined,
                { message: 'Each cue update must change at least one field.' }
              )
          )
          .min(1)
          .max(100),
      }),
    },
    async input => result(await app.call('updateSubtitles', input))
  );

  server.registerTool(
    'app_subtitles_mutate',
    {
      description:
        'Insert, remove, or shift mounted subtitle cues by stable ID. Removing a cue requires confirm=REMOVE; only one structural mutation is accepted per call.',
      inputSchema: z
        .object({
          operation: z.enum(['insert_after', 'remove', 'shift', 'shift_all']),
          id: z.string().min(1).optional(),
          seconds: z.number().finite().optional(),
          confirm: z.string().optional(),
        })
        .superRefine((input, ctx) => {
          if (input.operation !== 'shift_all' && !input.id) {
            ctx.addIssue({
              code: 'custom',
              path: ['id'],
              message: 'id is required for this subtitle mutation.',
            });
          }
          if (
            ['shift', 'shift_all'].includes(input.operation) &&
            (!Number.isFinite(input.seconds) || input.seconds === 0)
          ) {
            ctx.addIssue({
              code: 'custom',
              path: ['seconds'],
              message: 'A finite, non-zero seconds value is required.',
            });
          }
          if (input.operation === 'remove' && input.confirm !== 'REMOVE') {
            ctx.addIssue({
              code: 'custom',
              path: ['confirm'],
              message: 'Removing a cue requires confirm=REMOVE.',
            });
          }
        }),
    },
    async input =>
      result(
        await app.call('mutateSubtitles', {
          operation: input.operation,
          id: input.id,
          seconds: input.seconds,
          confirm: input.confirm,
        })
      )
  );

  server.registerTool(
    'app_subtitles_export',
    {
      description:
        'Export the mounted subtitle document to an explicit absolute local SRT path without opening a native save dialog. Existing files are refused unless confirm_overwrite=OVERWRITE.',
      inputSchema: z.object({
        path: z.string().min(1),
        mode: z.enum(['original', 'translation', 'dual']).default('dual'),
        confirm_overwrite: z.literal('OVERWRITE').optional(),
        history_id: optionalHistoryId,
      }),
    },
    async input =>
      result(
        await app.call('exportSubtitles', {
          path: input.path,
          mode: input.mode,
          overwrite: input.confirm_overwrite === 'OVERWRITE',
          historyId: input.history_id,
        })
      )
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
    'app_video_search_cancel',
    {
      description:
        'Cancel the active Translator video-recommendation search without clearing previously completed results.',
      inputSchema: z.object({}),
    },
    async () => result(await app.call('cancelVideoSearch'))
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

let stdioHandle = null;
let jobStoreClosePromise = null;
function closeJobStore() {
  if (jobStoreClosePromise) return jobStoreClosePromise;
  jobStoreClosePromise = Promise.resolve().then(async () => {
    try {
      await v2Service.close('development_controller_shutdown');
    } finally {
      jobStore.close();
    }
  });
  return jobStoreClosePromise;
}
lifecycle = installTransportBoundLifecycle({
  close: async () => {
    await app.close();
    await ownerMonitor.close();
    await closeJobStore();
  },
  forceClose: async () => {
    await app.forceClose();
    void ownerMonitor.close().catch(() => {});
    v2Service.prepareForShutdown('development_controller_forced_shutdown');
    void closeJobStore().catch(() => {});
  },
  forceOnFirstShutdown: shouldForceDevelopmentShutdown,
  closeTransport: () => stdioHandle?.close(),
});

async function main() {
  try {
    await ownerMonitor.start();
  } catch (error) {
    try {
      process.stderr.write(
        `Stage5 Translator MCP ownership setup failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    } catch {
      // A failed output channel is already an ownership-loss condition.
    }
    await lifecycle.requestShutdown('owner-monitor:exit', 1);
    return;
  }

  const transport = new DisconnectAwareStdioServerTransport({
    onDisconnect: lifecycle.transportClosed,
  });
  stdioHandle = serveStdio(buildServer, { transport });
  console.error('Stage5 Translator MCP server running on stdio');
}

void main()
  .catch(() => lifecycle.requestShutdown('startup:error', 1))
  .catch(() => {});
