import { css } from '@emotion/css';
import { useCreditStore } from '../state';
import Button from './Button';
import { colors } from '../styles';

const cardStyles = css`
  background: rgba(40, 40, 40, 0.6);
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 24px;
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const balanceStyles = css`
  font-size: 1.75rem;
  font-weight: 600;
  color: ${colors.primary};
`;

const buttonRowStyles = css`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

interface Pack {
  id: 'HOUR_1' | 'HOUR_5' | 'HOUR_10';
  label: string;
}

const PACKS: Pack[] = [
  { id: 'HOUR_1', label: '1 시간  ·  $2' },
  { id: 'HOUR_5', label: '5 시간  ·  $8' },
  { id: 'HOUR_10', label: '10 시간 · $14' },
];

export default function CreditCard() {
  const { balance, loading, error, buy } = useCreditStore();

  return (
    <section className={cardStyles}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        AI 사용 시간 (크레딧)
      </h2>

      {loading ? (
        <p style={{ color: colors.textDim }}>불러오는 중…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : (
        <>
          <span className={balanceStyles}>
            {(balance ?? 0).toFixed(1)}{' '}
            <span style={{ fontSize: '1rem', fontWeight: 400 }}>시간</span>
          </span>

          <div className={buttonRowStyles}>
            {PACKS.map(p => (
              <Button
                key={p.id}
                variant="primary"
                size="sm"
                onClick={() => buy(p.id)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
