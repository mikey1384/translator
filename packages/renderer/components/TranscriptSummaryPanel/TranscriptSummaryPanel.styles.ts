import { css } from '@emotion/css';
import {
  colors,
  metaPillStyles,
  selectStyles,
  subtleSurfaceCardStyles,
  surfaceCardStyles,
} from '../../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../design-system/tokens.js';

export const panelStyles = css`
  ${surfaceCardStyles}
  padding: ${spacing.xl};
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
`;

export const highlightsTabStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
`;

export const tabsRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

export const tabButtonStyles = (active: boolean) => css`
  ${metaPillStyles}
  cursor: pointer;
  border-color: ${active
    ? 'rgba(125, 167, 255, 0.24)'
    : colors.border};
  background: ${active ? 'rgba(125, 167, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)'};
  color: ${active ? colors.text : colors.textDim};
`;

export const headerRowStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};

  @media (min-width: 720px) {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
`;

export const headerMainStyles = css`
  display: grid;
  gap: ${spacing.md};
  min-width: 0;
`;

export const controlsStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.md};
`;

export const titleStyles = css`
  margin: 0;
  font-size: clamp(1.02rem, 1.4vw, 1.2rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  letter-spacing: -0.02em;
`;

export const subtitleStyles = css`
  margin: ${spacing.xs} 0 0;
  max-width: 58ch;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const labelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const summarySelectStyles = css`
  ${selectStyles}
  min-width: 220px;
  min-height: 40px;
  text-align: left;
`;

export const summaryGenerateWrapStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.xs};
`;

export const summaryEstimateStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.gray};
  text-align: center;
`;

export const summaryEstimateWarningStyles = css`
  color: ${colors.danger};
`;

export const summaryEstimateBadgeStyles = css`
  color: ${colors.primaryLight};
  margin-left: ${spacing.xs};
`;

export const progressWrapperStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.md} ${spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const progressHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${colors.text};
  font-size: ${fontSize.sm};
`;

export const progressPercentStyles = css`
  font-variant-numeric: tabular-nums;
  color: ${colors.primaryLight};
`;

export const progressRightStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

export const cancelButtonStyles = css`
  width: 28px;
  height: 28px;
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  font-size: ${fontSize.md};
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) {
    background: rgba(255, 109, 114, 0.12);
    border-color: rgba(255, 109, 114, 0.26);
    color: ${colors.text};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

export const summaryHeaderStyles = css`
  display: flex;
  justify-content: flex-end;
`;

export const summaryBoxStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  min-height: 180px;
  max-height: 340px;
  overflow-y: auto;
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};

  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
  }
`;

export const errorWrapperStyles = css`
  display: flex;
  align-items: center;
`;

export const highlightsGridStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: ${spacing.md};
`;

export const noHighlightsStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const highlightCard = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.md};
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const highlightHeader = css`
  display: flex;
  justify-content: space-between;
  gap: ${spacing.sm};
  align-items: baseline;
`;

export const highlightTitle = css`
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
`;

export const highlightTime = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
`;

export const highlightVideo = css`
  width: 100%;
  border-radius: ${borderRadius.lg};
  background: #000;
`;

export const highlightPlaceholder = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  color: ${colors.text};
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed ${colors.border};
  border-radius: ${borderRadius.lg};
  padding: ${spacing.md};
`;

export const highlightPlaceholderText = css`
  margin: 0;
  color: ${colors.textDim};
`;

export const highlightCutProgressTrack = css`
  width: 100%;
  height: 4px;
  border-radius: ${borderRadius.full};
  background: ${colors.gray};
  opacity: 0.25;
  overflow: hidden;
`;

export const highlightCutProgressFill = css`
  height: 100%;
  background: ${colors.primary};
  transition: width 0.2s ease;
`;

export const highlightDesc = css`
  color: ${colors.text};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const highlightActions = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  align-items: center;
`;

export const highlightStatusSuccess = css`
  font-size: ${fontSize.xs};
  color: ${colors.success};
`;

export const highlightStatusError = css`
  font-size: ${fontSize.xs};
  color: ${colors.danger};
`;

export const sectionsListStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
`;

export const sectionCardStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const sectionHeaderStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};

  @media (min-width: 720px) {
    flex-direction: row;
    justify-content: space-between;
    align-items: baseline;
    gap: ${spacing.sm};
  }
`;

export const sectionIndexStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const sectionTitleStyles = css`
  color: ${colors.text};
  font-weight: ${fontWeight.semibold};
  font-size: ${fontSize.md};
`;

export const sectionContentStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const sectionParagraphStyles = css`
  margin: 0;
  color: ${colors.text};
  line-height: ${lineHeight.relaxed};
  white-space: pre-wrap;
`;

export const aspectModeRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const aspectModeLabelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const aspectModeToggleStyles = css`
  display: flex;
  gap: 0;
  border-radius: ${borderRadius.full};
  overflow: hidden;
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
`;

export const aspectModeButtonStyles = (active: boolean) => css`
  border: none;
  background: ${active ? 'rgba(125, 167, 255, 0.16)' : 'transparent'};
  color: ${active ? colors.text : colors.textDim};
  padding: ${spacing.sm} ${spacing.md};
  font-size: ${fontSize.xs};
  cursor: pointer;

  &:hover {
    background: ${active
      ? 'rgba(125, 167, 255, 0.18)'
      : 'rgba(255, 255, 255, 0.05)'};
  }

  &:first-of-type {
    border-right: 1px solid ${colors.border};
  }
`;

export const highlightCheckboxStyles = css`
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: ${colors.primary};
  flex-shrink: 0;
`;

export const combineControlsStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
`;

export const reorderListStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const reorderLabelStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const reorderContainerStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
`;

export const reorderItemStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.lg};
  cursor: grab;

  &:active {
    cursor: grabbing;
    opacity: 0.8;
  }
`;

export const reorderIndexStyles = css`
  font-weight: ${fontWeight.semibold};
  color: ${colors.primaryLight};
  min-width: 24px;
`;

export const reorderTitleStyles = css`
  flex: 1;
  color: ${colors.text};
  font-size: ${fontSize.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const reorderTimeStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  flex-shrink: 0;
`;

export const combineCutRowStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.md};
`;

export const combineCutProgressStyles = css`
  flex: 1;
  height: 6px;
  background: ${colors.gray};
  opacity: 0.25;
  border-radius: ${borderRadius.full};
  overflow: hidden;
`;

export const combineCutProgressFillStyles = css`
  height: 100%;
  background: ${colors.primary};
  transition: width 0.2s ease;
`;

export const combinedResultStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  max-width: 360px;

  h4 {
    margin: 0;
    color: ${colors.text};
    font-size: ${fontSize.md};
  }
`;
