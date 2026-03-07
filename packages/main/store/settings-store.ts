import Store from 'electron-store';
import {
  APP_SETTINGS_DEFAULTS,
  type AppSettingsSchema,
} from './settings-schema.js';

export type SettingsStoreType = Store<AppSettingsSchema>;

export const settingsStore: SettingsStoreType = new Store<AppSettingsSchema>({
  name: 'app-settings',
  defaults: APP_SETTINGS_DEFAULTS,
});
