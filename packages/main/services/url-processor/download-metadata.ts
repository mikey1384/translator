const YTDLP_METADATA_PRINT_PREFIX = '__stage5_meta__';

const YTDLP_METADATA_PRINT_FIELDS = [
  ['title', 'title'],
  ['fulltitle', 'fulltitle'],
  ['thumbnail', 'thumbnail'],
  ['channel', 'channel'],
  ['uploader', 'uploader'],
  ['channel_url', 'channel_url'],
  ['uploader_url', 'uploader_url'],
  ['duration', 'duration'],
  ['release_timestamp', 'release_timestamp'],
  ['timestamp', 'timestamp'],
  ['upload_date', 'upload_date'],
] as const;

type PrintedMetadataKey = (typeof YTDLP_METADATA_PRINT_FIELDS)[number][0];

function normalizePrintedMetadataValue(value: string): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'NA' || normalized === 'null') {
    return undefined;
  }
  return normalized;
}

export function buildYtDlpMetadataPrintArgs(): string[] {
  const args: string[] = [];

  for (const [key, template] of YTDLP_METADATA_PRINT_FIELDS) {
    args.push(
      '--print',
      `before_dl:${YTDLP_METADATA_PRINT_PREFIX}${key}\t%(${template})s`
    );
  }

  return args;
}

export function applyPrintedYtDlpMetadataLine(
  current: Record<string, unknown> | null,
  line: string
): Record<string, unknown> | null {
  if (!line.startsWith(YTDLP_METADATA_PRINT_PREFIX)) {
    return current;
  }

  const payload = line.slice(YTDLP_METADATA_PRINT_PREFIX.length);
  const separatorIndex = payload.indexOf('\t');
  if (separatorIndex <= 0) {
    return current;
  }

  const key = payload.slice(0, separatorIndex) as PrintedMetadataKey;
  const value = normalizePrintedMetadataValue(payload.slice(separatorIndex + 1));
  if (!value) {
    return current;
  }

  const next = current ? { ...current } : {};
  next[key] = value;
  return next;
}
