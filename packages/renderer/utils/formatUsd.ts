const RTL_UI = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * A whole-dollar price in the user's language, always labelled as US
 * dollars: "US$5" in every locale. A bare "$" reads as local money in Brazil
 * and Spanish-speaking Latin America (R$, MX$, COL$…), so the currency is
 * never left implicit. Digits follow the UI language. Bidi marks are dropped,
 * and in RTL UIs the price is wrapped in a left-to-right isolate so a
 * sentence like "إكمال الترجمة · US$1" can't flip it into "1$US".
 */
export function formatUsd(price: number, locale: string): string {
  let digits: string;
  try {
    digits = new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
      useGrouping: true,
    })
      .format(price)
      .replace(/[‎‏؜]/g, '');
  } catch {
    digits = String(price);
  }
  const text = `US$${digits}`;
  const ui = String(locale || '')
    .split('-')[0]
    .toLowerCase();
  return RTL_UI.has(ui) ? `⁦${text}⁩` : text;
}
