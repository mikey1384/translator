import { WIRE_APP_BUILD_HEADER } from '../../shared/constants/wire-protocol.js';

/**
 * "dev" for an unpackaged run from source, "test" for a scripted launch of a
 * packaged build (STAGE5_TEST_RUN=1), null for a real install. Only used so
 * the server can leave these launches out of funnel numbers.
 */
export function appBuildKind({
  isPackaged,
  env = process.env,
}: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
}): 'dev' | 'test' | null {
  if (!isPackaged) return 'dev';
  return env.STAGE5_TEST_RUN === '1' ? 'test' : null;
}

export function appBuildHeaders(isPackaged: boolean): Record<string, string> {
  const kind = appBuildKind({ isPackaged });
  return kind ? { [WIRE_APP_BUILD_HEADER]: kind } : {};
}
