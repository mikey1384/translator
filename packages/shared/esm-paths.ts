import { fileURLToPath } from 'url';
import { dirname } from 'path';

export const esmFilename = (metaUrl: string) => fileURLToPath(metaUrl);
export const esmDirname = (metaUrl: string) => dirname(esmFilename(metaUrl));
