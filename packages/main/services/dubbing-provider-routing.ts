// Dubbing routing lives in shared so the renderer uses the same rules.
export {
  API_KEY_MODE_DUBBING_BLOCKER_MESSAGES,
  getApiKeyModeDubbingBlocker,
  resolveDubbingRoute,
  type ApiKeyModeDubbingBlocker,
  type DubbingRoute,
} from '../../shared/helpers/dubbing-route.js';
