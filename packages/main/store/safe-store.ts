import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';
import {
  openStoreSafely,
  resolveDeviceId,
  salvageDeviceId,
  type QuarantinedStoreFile,
} from './safe-store-core.js';

type StoreOptions<T extends Record<string, any>> = ConstructorParameters<
  typeof Store<T>
>[0] & { name: string };

function storeFilePath(options: { name: string; cwd?: string }): string {
  const cwd = options.cwd
    ? path.resolve(app.getPath('userData'), options.cwd)
    : app.getPath('userData');
  return path.join(cwd, `${options.name}.json`);
}

/**
 * Every electron-store in the app goes through here: a damaged file is moved
 * aside (`<name>.corrupt-<timestamp>.json`) and the store starts fresh
 * instead of crashing the main process before a window exists.
 */
export function createSafeStore<T extends Record<string, any>>(
  options: StoreOptions<T>,
  hooks: { onQuarantined?: (info: QuarantinedStoreFile) => void } = {}
): Store<T> {
  return openStoreSafely({
    filePath: storeFilePath(options),
    create: () => new Store<T>(options),
    logger: log,
    onQuarantined: hooks.onQuarantined,
  });
}

// The device id ties the user's credits to this install. It lives in
// device-config.json and is mirrored into stage5-auth.json so either file
// can restore it when the other is damaged.
type DeviceIdShape = { deviceId?: string };
const salvagedDeviceIds: string[] = [];
const rememberSalvaged = ({ rawContent }: QuarantinedStoreFile) => {
  const id = salvageDeviceId(rawContent);
  if (id) salvagedDeviceIds.push(id);
};

let deviceConfigStore: Store<DeviceIdShape> | null = null;
let deviceIdMirrorStore: Store<DeviceIdShape> | null = null;

function getDeviceIdStores() {
  deviceConfigStore ??= createSafeStore<DeviceIdShape>(
    { name: 'device-config' },
    { onQuarantined: rememberSalvaged }
  );
  deviceIdMirrorStore ??= createSafeStore<DeviceIdShape>(
    { name: 'stage5-auth' },
    { onQuarantined: rememberSalvaged }
  );
  return { primary: deviceConfigStore, mirror: deviceIdMirrorStore };
}

export function getPersistentDeviceId(): string {
  const { primary, mirror } = getDeviceIdStores();
  const resolved = resolveDeviceId({
    primary: primary.get('deviceId'),
    mirror: mirror.get('deviceId'),
    salvaged: salvagedDeviceIds,
    generate: uuidv4,
  });
  if (resolved.writePrimary) primary.set('deviceId', resolved.id);
  if (resolved.writeMirror) mirror.set('deviceId', resolved.id);
  return resolved.id;
}

/** Records an id salvaged from another quarantined store file. */
export function noteSalvagedDeviceId(info: QuarantinedStoreFile): void {
  rememberSalvaged(info);
}
