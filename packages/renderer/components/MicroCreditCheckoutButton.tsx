import { useTranslation } from 'react-i18next';
import { CREDIT_PACKS } from '../../shared/constants';
import { estimateTranslatableHours } from '../utils/creditEstimates';
import BuyCreditsButton from './BuyCreditsButton';

type MicroOfferPlacement = 'zero-credit-banner' | 'credit-ran-out-dialog';

interface MicroCreditCheckoutButtonProps {
  placement: MicroOfferPlacement;
  onCheckoutCreated?: () => void;
}

export default function MicroCreditCheckoutButton({
  placement,
  onCheckoutCreated,
}: MicroCreditCheckoutButtonProps) {
  const { t } = useTranslation();
  const pack = CREDIT_PACKS.MICRO;
  const translationHours = estimateTranslatableHours(pack.credits, false);
  const formattedHours =
    typeof translationHours === 'number'
      ? translationHours.toLocaleString(undefined, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : '';
  const translationHoursLabel = t(
    'credits.translationHoursShort',
    'translation hrs'
  );

  return (
    <BuyCreditsButton
      packId="MICRO"
      label={`${t('credits.buyCredits', 'Buy Credits')} — US$${
        pack.price
      } · ${formattedHours} ${translationHoursLabel}`}
      variant="primary"
      size="sm"
      dataLog={`${placement}-buy-micro-credits`}
      onCheckoutCreated={onCheckoutCreated}
    />
  );
}
