import { useTranslation } from 'react-i18next';
import { CREDIT_PACKS } from '../../shared/constants';
import { estimateTranslatableHours } from '../utils/creditEstimates';
import { transcriptionMinutesForCredits } from '../utils/creditShortfall';
import BuyCreditsButton from './BuyCreditsButton';

type MicroOfferPlacement = 'zero-credit-banner' | 'credit-ran-out-dialog';

interface MicroCreditCheckoutButtonProps {
  placement: MicroOfferPlacement;
  onCheckoutCreated?: () => void;
  // What the pack is described in. Defaults to transcription time, which every
  // credit-paid path starts with; translation hours (shown only for a
  // translation refusal) overstate what the pack buys otherwise.
  basis?: 'translation' | 'transcription' | 'none';
}

export default function MicroCreditCheckoutButton({
  placement,
  onCheckoutCreated,
  basis = 'transcription',
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

  const coverageLabel =
    basis === 'transcription'
      ? t(
          'credits.transcriptionMinutesShort',
          '{{minutes}} min of transcription',
          {
            minutes: transcriptionMinutesForCredits(pack.credits),
          }
        )
      : basis === 'translation'
        ? `${formattedHours} ${translationHoursLabel}`
        : null;

  return (
    <BuyCreditsButton
      packId="MICRO"
      label={`${t('credits.buyCredits', 'Buy Credits')} — US$${pack.price}${
        coverageLabel ? ` · ${coverageLabel}` : ''
      }`}
      variant="primary"
      size="sm"
      dataLog={`${placement}-buy-micro-credits`}
      placement={placement}
      onCheckoutCreated={onCheckoutCreated}
    />
  );
}
