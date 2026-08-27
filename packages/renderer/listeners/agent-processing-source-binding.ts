export const AGENT_SOURCE_BINDING_STATES = ['preparing', 'mounted'] as const;
export const AGENT_SOURCE_BINDING_PROTOCOL_VERSION = 1 as const;

export type AgentSourceBindingState =
  (typeof AGENT_SOURCE_BINDING_STATES)[number];

export type AgentSourceBinding = {
  sourceKey: string;
  sourceKind: string;
  plannedDurationSeconds: number | null;
  state: AgentSourceBindingState;
};

type AgentWorkspaceSnapshot = {
  source: Record<string, unknown>;
  subtitles: Record<string, unknown>;
  outputs: Record<string, unknown>;
};

const SOURCE_KINDS = new Set([
  'url',
  'local_file',
  'library_item',
  'transcript',
  'mock',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseAgentSourceBinding(
  value: unknown
): AgentSourceBinding | null {
  if (!isRecord(value)) return null;
  const sourceKey = String(value.source_key || '').trim();
  const sourceKind = String(value.source_kind || '').trim();
  const state = String(value.state || '') as AgentSourceBindingState;
  const rawDuration = value.planned_duration_seconds;
  const plannedDurationSeconds =
    rawDuration === null || rawDuration === undefined
      ? null
      : Number(rawDuration);

  if (
    !sourceKey ||
    sourceKey.length > 4096 ||
    /[\p{Cc}]/u.test(sourceKey) ||
    !SOURCE_KINDS.has(sourceKind) ||
    !AGENT_SOURCE_BINDING_STATES.includes(state) ||
    (plannedDurationSeconds !== null &&
      (!Number.isFinite(plannedDurationSeconds) || plannedDurationSeconds < 0))
  ) {
    return null;
  }

  return {
    sourceKey,
    sourceKind,
    plannedDurationSeconds,
    state,
  };
}

export function agentSourceBindingsMatch(
  left: AgentSourceBinding | null,
  right: AgentSourceBinding | null
): boolean {
  return (
    agentSourceBindingIdentitiesMatch(left, right) &&
    left?.state === right?.state
  );
}

export function agentSourceBindingIdentitiesMatch(
  left: AgentSourceBinding | null,
  right: AgentSourceBinding | null
): boolean {
  return (
    left?.sourceKey === right?.sourceKey &&
    left?.sourceKind === right?.sourceKind &&
    left?.plannedDurationSeconds === right?.plannedDurationSeconds
  );
}

export function serializeAgentSourceBinding(
  binding: AgentSourceBinding
): Record<string, unknown> {
  return {
    source_key: binding.sourceKey,
    source_kind: binding.sourceKind,
    planned_duration_seconds: binding.plannedDurationSeconds,
    state: binding.state,
  };
}

export function projectAgentWorkspaceSnapshot(
  binding: AgentSourceBinding | null,
  observed: AgentWorkspaceSnapshot
): AgentWorkspaceSnapshot & {
  source_binding?: Record<string, unknown>;
} {
  if (!binding) return observed;
  if (binding.state === 'mounted') {
    return {
      ...observed,
      source_binding: serializeAgentSourceBinding(binding),
    };
  }

  // A persistent job can be pinned to a tab that already has another video
  // open. Until the planned source is mounted, none of that tab workspace is
  // evidence about this operation.
  return {
    source_binding: serializeAgentSourceBinding(binding),
    source: {
      videoPath: null,
      videoReady: false,
      durationSeconds: binding.plannedDurationSeconds,
    },
    subtitles: {
      cueCount: null,
      translatedCueCount: null,
      targetLanguage: null,
      kind: null,
      activeFilePath: null,
    },
    outputs: {
      dubbedVideoPath: null,
      dubbedAudioPath: null,
      downloadedFilePath: null,
    },
  };
}
