import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import {
  APP_SETTINGS_DEFAULTS,
  type AppSettingsSchema,
} from './settings-schema.js';

export type SettingsStoreType = Store<AppSettingsSchema>;

const settingsStorePath = path.join(app.getPath('userData'), 'app-settings.json');
const hadExistingSettingsFile = fs.existsSync(settingsStorePath);

const STORE_DEFAULTS: Partial<AppSettingsSchema> = {
  ...APP_SETTINGS_DEFAULTS,
};

// Keep new installs on the new OpenAI review default without rewriting the
// legacy implicit-Claude behavior for existing profiles that never stored this key.
delete (STORE_DEFAULTS as Partial<AppSettingsSchema>).preferClaudeReview;

export const settingsStore: SettingsStoreType = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: STORE_DEFAULTS,
});

if (!settingsStore.has('preferClaudeReview')) {
  settingsStore.set(
    'preferClaudeReview',
    hadExistingSettingsFile ? true : APP_SETTINGS_DEFAULTS.preferClaudeReview
  );
}
