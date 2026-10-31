import { css, cx } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import { colors } from '../styles';

const noteStyles = css`
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
  color: ${colors.textDim};
`;

/**
 * Prices in the app are US dollars; Stripe's checkout page shows (and
 * charges) the buyer's local currency where it can. Said once next to every
 * buy button so the amount on the Stripe page isn't a surprise.
 */
export default function CheckoutCurrencyNote({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <p className={cx(noteStyles, className)}>
      {t(
        'credits.localCurrencyNote',
        'Prices in US dollars. Checkout shows your local currency where available.'
      )}
    </p>
  );
}
