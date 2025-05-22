import { css } from '@emotion/css';
import { colors } from '../../../styles.js';
import { useTranslation } from 'react-i18next';

interface CostHintProps {
  costStr: string;
}

const hintStyle = css`
  font-size: 0.85em;
  color: ${colors.text};
  margin-top: 8px;
  margin-bottom: 0px;
  text-align: center;
`;

export default function CostHint({ costStr }: CostHintProps) {
  const { t } = useTranslation();

  return (
    <p className={hintStyle}>
      {t('generateSubtitles.costHint', { hours: costStr })}
    </p>
  );
}
