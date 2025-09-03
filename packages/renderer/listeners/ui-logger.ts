import { logButton } from '../utils/logger';

// Log changes to selects, checkboxes, radios (concise)
document.addEventListener(
  'change',
  e => {
    const target = e.target as HTMLInputElement | HTMLSelectElement | null;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== 'select' && !(tag === 'input' && /^(checkbox|radio)$/i.test(target.type))) {
      return;
    }
    try {
      const name = target.getAttribute('aria-label') || target.getAttribute('name') || target.id || tag;
      const value = (target as any).value ?? (target as any).checked;
      logButton(`${tag}_change:${name}`, { value });
    } catch {}
  },
  true
);

