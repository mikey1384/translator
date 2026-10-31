import { useTranslation } from 'react-i18next';
import { CREDIT_PACKS } from '../../shared/constants';
import BuyCreditsButton from './BuyCreditsButton';
import { formatUsd } from '../utils/formatUsd';
import { formatSubtitledVideoTime } from '../utils/creditEstimates';

type MicroOfferPlacement = 'zero-credit-banner' | 'credit-ran-out-dialog';

interface MicroCreditCheckoutButtonProps {
  placement: MicroOfferPlacement;
  onCheckoutCreated?: () => void;
  // Whether to say how much video the pack covers. It is quoted in minutes of
  // video, the unit the balance and the packs use; 'none' leaves it out.
  basis?: 'translation' | 'transcription' | 'none';
}

export default function MicroCreditCheckoutButton({
  placement,
  onCheckoutCreated,
  basis = 'transcription',
}: MicroCreditCheckoutButtonProps) {
  const { t, i18n } = useTranslation();
  const pack = CREDIT_PACKS.MICRO;
  const price = formatUsd(pack.price, i18n.language);

  const label =
    basis === 'none'
      ? t('credits.microPackLabelNoTime', 'Buy minutes — {{price}}', {
          price,
        })
      : t(
          'credits.microPackLabel',
          'Buy minutes — {{price}} · ≈ {{time}} of video',
          {
            price,
            time: formatSubtitledVideoTime(pack.credits, i18n.language),
          }
        );

  return (
    <BuyCreditsButton
      packId="MICRO"
      label={label}
      variant="primary"
      size="sm"
      dataLog={`${placement}-buy-micro-credits`}
      placement={placement}
      onCheckoutCreated={onCheckoutCreated}
    />
  );
}
