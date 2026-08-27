import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type FontAccess = (fontPath: string, mode: number) => Promise<unknown>;

export type ReadableSubtitleRenderFont = {
  path: string;
  url: string;
};

function resolveFontPath(reference: string): string {
  const value = String(reference || '').trim();
  if (!value) {
    throw new Error(
      'Subtitle rendering requires the bundled Noto Sans font, but no font asset was configured.'
    );
  }
  return value.startsWith('file:') ? fileURLToPath(value) : path.resolve(value);
}

export async function assertSubtitleRenderFontReadable(
  reference: string,
  access: FontAccess = fs.access
): Promise<ReadableSubtitleRenderFont> {
  const fontPath = resolveFontPath(reference);
  try {
    await access(fontPath, fsConstants.R_OK);
  } catch (error) {
    throw new Error(
      `Subtitle rendering requires the bundled Noto Sans font, but it is unreadable at ${fontPath}. Reinstall or repair Translator before rendering.`,
      { cause: error }
    );
  }
  return {
    path: fontPath,
    url: pathToFileURL(fontPath).href,
  };
}
