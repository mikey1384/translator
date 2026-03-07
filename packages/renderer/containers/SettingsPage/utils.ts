import { TTS_CREDITS_PER_MINUTE } from '../../../shared/constants';
import {
  formatDubbingTime as formatDubbingTimeFromEstimator,
  type TtsProvider,
} from '../../utils/creditEstimates';

export { TTS_CREDITS_PER_MINUTE };

export function formatDubbingTime(
  credits: number,
  provider: TtsProvider
): string {
  return formatDubbingTimeFromEstimator(credits, provider);
}
