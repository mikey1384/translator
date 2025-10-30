import { css } from '@emotion/css';
import { colors } from '../../styles';

export const layoutStyles = css`
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

export const listStyles = css`
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid ${colors.border};
  border-radius: 12px;
  overflow: hidden;
  background-color: ${colors.light};
`;

export const entryStyles = css`
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: ${colors.grayLight};
  }

  &:not(:last-of-type) {
    border-bottom: 1px solid ${colors.border};
  }
`;

export const entrySelectedStyles = css`
  background: linear-gradient(135deg, ${colors.grayLight}, ${colors.light});
  border-left: 3px solid ${colors.primary};
`;

export const entryTitleStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${colors.dark};
  font-weight: 600;
  font-size: 1rem;
`;

export const metaRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: ${colors.gray};
  font-size: 0.85rem;
`;

export const metaItemStyles = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

export const languagesRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

export const languageTagStyles = css`
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: ${colors.grayLight};
  color: ${colors.dark};
  font-size: 0.8rem;
  text-transform: capitalize;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: ${colors.primary};
    color: ${colors.white};
  }
`;

export const languageTagActiveStyles = css`
  background: ${colors.primary};
  color: ${colors.white};
`;

export const emptyStateStyles = css`
  text-align: center;
  padding: 32px;
  color: ${colors.gray};
  font-size: 0.95rem;
`;

export const infoStyles = css`
  color: ${colors.gray};
  font-size: 0.85rem;
`;

export const warningStyles = css`
  border: 1px solid ${colors.warning};
  background: rgba(247, 85, 154, 0.15);
  color: ${colors.dark};
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
`;

export const viewerStyles = css`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

export const previewVideoStyles = css`
  width: 100%;
  max-width: 720px;
  aspect-ratio: 16 / 9;
  background: ${colors.grayLight};
  border: 1px solid ${colors.border};
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
  object-fit: contain;
`;

export const transcriptListStyles = css`
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid ${colors.border};
  border-radius: 12px;
  background: ${colors.light};
`;

export const segmentRowStyles = css`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-bottom: 1px solid ${colors.border};
  padding-bottom: 8px;
  margin-bottom: 8px;

  &:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }
`;

export const segmentTimeStyles = css`
  font-size: 0.75rem;
  color: ${colors.gray};
`;

export const segmentTextStyles = css`
  color: ${colors.dark};
  font-size: 0.95rem;
  line-height: 1.4;
  white-space: pre-wrap;
`;
