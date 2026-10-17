import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { useAiStore, useCreditStore, useUIStore } from '../state';
import { currentVideoCost } from '../utils/freePreviewRun';
import { colors } from '../styles';

const line = (accent: string) => css`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.8rem;
  color: ${accent === colors.primary ? colors.primary : colors.textDim};

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: ${accent};
    flex: none;
  }
`;

function formatUsd(price: number, locale: string): string {
  try {
    // Prices are always US dollars: "$5" reads everywhere, and dropping the
    // bidi marks keeps RTL text from splitting the symbol off the number.
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    })
      .format(price)
      .replace(/[\u200e\u200f\u061c]/g, '');
  } catch {
    return `$${price}`;
  }
}

/**
 * What subtitling this video costs, said before anyone clicks: covered by
 * the user's minutes, the first minutes free, or the pack that finishes it.
 * Nothing in API-key mode or before the balance is known.
 */
export default function VideoCostLine({
  durationSec,
}: {
  durationSec?: number | null;
}) {
  const { t, i18n } = useTranslation();
  // Subscribe so the line updates when the balance or mode changes.
  useCreditStore(s => s.credits);
  useCreditStore(s => s.authoritative);
  useAiStore(s => s.useApiKeysMode);
  useUIStore(s => s.qualityTranslation);

  const cost = currentVideoCost(durationSec ?? null);
  if (!cost) return null;
  const locale = i18n.resolvedLanguage || i18n.language || 'en';

  if (cost.kind === 'covered') {
    return (
      <span className={line(colors.success)}>
        {t('videoCost.covered', 'Covered by your minutes')}
      </span>
    );
  }
  const price = formatUsd(cost.wholeVideoPrice, locale);
  if (cost.kind === 'preview') {
    return (
      <span className={line(colors.primary)}>
        {t(
          'videoCost.preview',
          'First {{minutes}} min free · whole video {{price}}',
          { minutes: cost.previewMinutes, price }
        )}
      </span>
    );
  }
  return (
    <span className={line(colors.gray)}>
      {t('videoCost.pack', 'Whole video {{price}}', { price })}
    </span>
  );
}
