import type { VideoSuggestionMessage } from '@shared-types/app';
import { compactText } from './shared.js';

export function toPlannerMessages(
  history: VideoSuggestionMessage[] | undefined
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const cleaned = (history || [])
    .map((msg): { role: 'user' | 'assistant'; content: string } => ({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: compactText(msg?.content),
    }))
    .map(msg => {
      if (msg.role === 'assistant' && msg.content.startsWith('__i18n__:')) {
        // Drop unresolved placeholder keys from context so the agent receives
        // conversational text only.
        return { ...msg, content: '' };
      }
      return msg;
    })
    .filter(msg => msg.content.length > 0)
    .slice(-12);
  return cleaned;
}
