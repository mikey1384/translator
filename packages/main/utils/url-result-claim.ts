type UrlResultLike = {
  kind: string;
};

export function claimPendingUrlResultFilePath<Entry extends UrlResultLike>(
  registry: Pick<Map<string, Entry>, 'get'>,
  id: string,
  deleteEntry: (id: string) => void
): string | null {
  const entry = registry.get(id);
  if (!entry || entry.kind !== 'url-result') {
    return null;
  }

  const filePath = (entry as Entry & { filePath: string }).filePath;
  deleteEntry(id);
  return filePath;
}
