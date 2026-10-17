const RTL_UI = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * A whole-dollar price in the user's language: "$5", "5 $", "1 US$".
 * Prices are always US dollars. Bidi marks are dropped, and in RTL UIs the
 * price is wrapped in a left-to-right isolate so a sentence like
 * "إكمال الترجمة · 1 US$" can't flip it into "$US 1".
 */
export function formatUsd(price: number, locale: string): string {
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    })
      .format(price)
      .replace(/[‎‏؜]/g, '');
  } catch {
    text = `$${price}`;
  }
  const ui = String(locale || '')
    .split('-')[0]
    .toLowerCase();
  return RTL_UI.has(ui) ? `⁦${text}⁩` : text;
}
