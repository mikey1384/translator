import { css } from '@emotion/css';
import {
  breakpoints,
  colors,
  gradients,
  inputStyles as sharedInputStyles,
  metaPillStyles,
  subtleSurfaceCardStyles,
  surfaceCardStyles,
} from '../../../../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../../../../components/design-system/tokens.js';

export const wrapperStyles = css`
  width: 100%;
  max-width: 100%;
  margin: 0;
`;

export const toggleButtonStyles = css`
  ${subtleSurfaceCardStyles}
  border-color: ${colors.borderStrong};
  color: ${colors.text};
  width: 100%;
  padding: ${spacing.xl};
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background-color 0.15s ease;

  &:hover:not(:disabled) {
    border-color: ${colors.primary};
    background: linear-gradient(
      180deg,
      rgba(125, 167, 255, 0.05),
      rgba(255, 255, 255, 0.01)
    );
    box-shadow:
      0 0 0 1px rgba(125, 167, 255, 0.16),
      0 4px 12px rgba(0, 0, 0, 0.1);
  }

  &[aria-expanded='true'] {
    border-color: ${colors.primary};
    background: linear-gradient(
      180deg,
      rgba(125, 167, 255, 0.04),
      rgba(255, 255, 255, 0.01)
    );
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

export const toggleButtonInnerStyles = css`
  display: grid;
  gap: ${spacing.md};
`;

export const toggleCopyStyles = css`
  display: grid;
  gap: ${spacing.xs};
  justify-items: start;
  text-align: left;
`;

export const toggleEyebrowRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.sm};
`;

export const toggleEyebrowStyles = css`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  border: 1px solid rgba(240, 180, 75, 0.24);
  background: rgba(240, 180, 75, 0.08);
  color: ${colors.warning};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const toggleTitleStyles = css`
  font-size: clamp(1.08rem, 1.5vw, 1.35rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  letter-spacing: -0.02em;
`;

export const toggleDescriptionStyles = css`
  margin: 0;
  max-width: 60ch;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const toggleMetaRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

export const toggleMetaPillStyles = css`
  ${metaPillStyles}
`;

export const toggleMetaPillAccentStyles = css`
  ${metaPillStyles}
  color: ${colors.primaryLight};
  border-color: rgba(125, 167, 255, 0.24);
  background: rgba(125, 167, 255, 0.08);
`;

export const panelStyles = css`
  ${surfaceCardStyles}
  margin-top: ${spacing.md};
  border-color: ${colors.borderStrong};
  overflow: hidden;
`;

export const panelStandaloneStyles = css`
  margin-top: 0;
`;

export const panelIntroStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${spacing.lg};
  padding: ${spacing.xl};
  border-bottom: 1px solid ${colors.border};
  background: linear-gradient(
    180deg,
    rgba(125, 167, 255, 0.08) 0%,
    rgba(255, 255, 255, 0.01) 100%
  );

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }
`;

export const panelIntroMainStyles = css`
  display: grid;
  gap: ${spacing.md};
`;

export const panelIntroTitleStyles = css`
  font-size: clamp(1.02rem, 1.35vw, 1.25rem);
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  letter-spacing: -0.02em;
`;

export const panelIntroCopyStyles = css`
  max-width: 72ch;
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  color: ${colors.textDim};
`;

export const panelIntroPillRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

export const panelIntroPillStyles = css`
  ${metaPillStyles}
`;

export const panelIntroPillAccentStyles = css`
  ${metaPillStyles}
  color: ${colors.primaryLight};
  border-color: rgba(125, 167, 255, 0.24);
  background: rgba(125, 167, 255, 0.08);
`;

export const technicalDetailsStyles = css`
  ${subtleSurfaceCardStyles}
  align-self: start;
  min-width: 240px;
  padding: ${spacing.md};
  background: ${gradients.surfaceRaised};
`;

export const technicalDetailsSummaryStyles = css`
  list-style: none;
  cursor: pointer;
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  color: ${colors.textDim};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  user-select: none;
  outline: none;
  padding: 2px 0;

  &::-webkit-details-marker {
    display: none;
  }

  &:hover {
    color: ${colors.text};
  }
`;

export const technicalDetailsBodyStyles = css`
  margin-top: ${spacing.sm};
  display: grid;
  gap: ${spacing.xs};
`;

export const technicalDetailsRowStyles = css`
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  color: ${colors.textDim};
`;

export const workspaceStyles = css`
  display: grid;
  grid-template-columns: minmax(340px, 0.92fr) minmax(0, 1.35fr);
  align-items: stretch;
  height: min(74vh, 860px);
  min-height: min(600px, 74vh);
  overflow: hidden;

  @media (max-width: 1040px) {
    grid-template-columns: 1fr;
    min-height: 0;
    max-height: none;
    overflow: visible;
  }
`;

export const workspaceCompactStyles = css`
  height: auto;
  min-height: 0;
  align-items: start;
  overflow: visible;
`;

export const chatColumnStyles = css`
  min-width: 0;
  min-height: 0;
  height: 100%;
  border-right: 1px solid ${colors.border};
  background: ${colors.surfaceSoft};
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;

  @media (max-width: 1040px) {
    border-right: none;
    border-bottom: 1px solid ${colors.border};
    height: auto;
    max-height: none;
    position: static;
  }
`;

export const chatColumnCompactStyles = css`
  height: auto;
  grid-template-rows: auto auto;
`;

export const resultsColumnStyles = css`
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: block;
  background: ${colors.surface};
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;

  @media (max-width: 1040px) {
    height: auto;
    min-height: 0;
    display: block;
    overflow: visible;
  }
`;

export const resultsColumnCompactStyles = css`
  height: auto;
  overflow: visible;
`;

export const messagesStyles = css`
  max-height: none;
  min-height: 0;
  overflow: auto;
  padding: ${spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
  background: transparent;
`;

export const messagesCompactStyles = css`
  overflow: visible;
  padding-bottom: ${spacing.md};
`;

export const chatEmptyStateStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  display: grid;
  gap: ${spacing.sm};
  align-self: stretch;
`;

export const chatEmptyEyebrowStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 28px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  border: 1px solid rgba(125, 167, 255, 0.22);
  background: rgba(125, 167, 255, 0.08);
  color: ${colors.primaryLight};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const chatEmptyTitleStyles = css`
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  letter-spacing: -0.02em;
`;

export const chatEmptyCopyStyles = css`
  max-width: 58ch;
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  color: ${colors.textDim};
`;

export const bubbleStyles = css`
  max-width: 85%;
  padding: ${spacing.md} ${spacing.lg};
  border-radius: ${borderRadius.xl};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  white-space: pre-wrap;
`;

export const assistantBubbleStyles = css`
  ${bubbleStyles};
  align-self: flex-start;
  background: ${gradients.surfaceRaised};
  color: ${colors.text};
  border: 1px solid ${colors.borderStrong};
`;

export const userBubbleStyles = css`
  ${bubbleStyles};
  align-self: flex-end;
  background: linear-gradient(
    135deg,
    rgba(125, 167, 255, 0.94),
    rgba(93, 131, 222, 0.92)
  );
  color: white;
  border: 1px solid rgba(171, 200, 255, 0.24);
`;

export const inputWrapStyles = css`
  display: grid;
  gap: ${spacing.md};
  padding: ${spacing.lg};
  border-top: 1px solid ${colors.border};
  background: linear-gradient(
    180deg,
    rgba(125, 167, 255, 0.04),
    rgba(255, 255, 255, 0.01)
  );
`;

export const composerHeaderStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.sm};
`;

export const composerTitleStyles = css`
  color: ${colors.text};
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.01em;
`;

export const composerHintPillStyles = css`
  ${metaPillStyles}
  color: ${colors.primaryLight};
  border-color: rgba(125, 167, 255, 0.24);
  background: rgba(125, 167, 255, 0.08);
`;

export const composerSurfaceStyles = css`
  display: grid;
  gap: ${spacing.md};
  padding: ${spacing.md};
  border: 1px solid ${colors.borderStrong};
  border-radius: ${borderRadius.xl};
  background: linear-gradient(
    180deg,
    rgba(20, 27, 38, 0.98),
    rgba(16, 23, 35, 0.98)
  );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  &:focus-within {
    border-color: ${colors.primary};
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 0 0 1px rgba(125, 167, 255, 0.14);
  }
`;

export const inputFieldStyles = css`
  width: 100%;
  min-height: 88px;
  resize: vertical;
  border: none;
  background: transparent;
  color: ${colors.text};
  font-size: ${fontSize.md};
  line-height: ${lineHeight.relaxed};
  padding: 0;
  box-sizing: border-box;

  &::placeholder {
    color: ${colors.gray};
  }

  &:focus {
    outline: none;
  }

  &:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
`;

export const inputFooterStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.sm};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    align-items: stretch;
  }
`;

export const inputActionsStyles = css`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${spacing.sm};
  flex-wrap: wrap;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    justify-content: stretch;
    width: 100%;
  }
`;

export const inputStyles = css`
  ${sharedInputStyles}
  max-width: 100%;
  width: 100%;
`;

export const composerMetaStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  line-height: ${lineHeight.normal};
`;

export const countryControlStyles = css`
  padding: ${spacing.lg};
  border-bottom: 1px solid ${colors.border};
  display: grid;
  gap: ${spacing.md};
  background: rgba(255, 255, 255, 0.01);
`;

export const preferencesGridStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${spacing.md};

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    grid-template-columns: 1fr;
  }
`;

export const preferenceFieldStyles = css`
  display: grid;
  gap: ${spacing.xs};
`;

export const countryLabelStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const countryHintStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.gray};
`;

export const workflowHintStyles = css`
  padding: 8px 12px;
  border-top: 1px solid ${colors.border};
  border-bottom: 1px solid ${colors.border};
  font-size: 0.76rem;
  color: ${colors.textDim};
  background: ${colors.surface};
`;

export const detailsBlockStyles = css`
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.xl};
  background: rgba(255, 255, 255, 0.02);
  padding: ${spacing.sm} ${spacing.md};
`;

export const detailsSummaryStyles = css`
  list-style: none;
  cursor: pointer;
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  user-select: none;
  outline: none;
  padding: 3px 0;

  &::-webkit-details-marker {
    display: none;
  }

  &:hover {
    color: ${colors.text};
  }
`;

export const detailsBodyStyles = css`
  margin-top: ${spacing.sm};
  display: grid;
  gap: ${spacing.md};
`;

export const preferenceLabelRowStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const preferenceRemoveButtonStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 999px;
  background: ${colors.bg};
  color: ${colors.textDim};
  font-size: 0.7rem;
  line-height: 1;
  padding: 4px 8px;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: ${colors.primary};
    color: ${colors.text};
  }

  &:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
`;

export const loadingMetaStyles = css`
  margin-top: ${spacing.xs};
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
`;

export const stageTimelineStyles = css`
  margin-top: 8px;
  display: grid;
  gap: 5px;
`;

export const stageRowStyles = css`
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.lg};
  padding: ${spacing.sm};
  display: grid;
  gap: ${spacing.xs};
  background: rgba(255, 255, 255, 0.02);
`;

export const stageRowPendingStyles = css`
  opacity: 0.72;
`;

export const stageRowRunningStyles = css`
  border-color: ${colors.primary}88;
`;

export const stageRowClearedStyles = css`
  border-color: #1f8f4d;
  background: rgba(31, 143, 77, 0.12);
`;

export const stageTitleStyles = css`
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  color: ${colors.textDim};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

export const stagePercentStyles = css`
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  color: ${colors.gray};
  font-variant-numeric: tabular-nums;
`;

export const stageProgressTrackStyles = css`
  height: 6px;
  border-radius: 999px;
  background: ${colors.border};
  overflow: hidden;
`;

export const stageProgressFillStyles = css`
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    ${colors.primary} 0%,
    ${colors.primaryDark} 100%
  );
  transition: width 0.45s ease;
`;

export const stageProgressFillClearedStyles = css`
  background: linear-gradient(90deg, #2bbf6a 0%, #1f8f4d 100%);
`;

export const stageOutcomeStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  white-space: pre-wrap;
`;

export const liveActivityPanelStyles = css`
  margin: ${spacing.lg} ${spacing.lg} ${spacing.xs};
  border: 1px solid rgba(125, 167, 255, 0.24);
  background: rgba(125, 167, 255, 0.06);
  border-radius: ${borderRadius.xl};
  padding: ${spacing.md} ${spacing.lg};
  display: grid;
  gap: ${spacing.sm};
  min-height: 0;
`;

export const liveActivityHeaderStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

export const liveActivityHeaderActionsStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const liveActivityTitleStyles = css`
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
`;

export const liveActivityMetaStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
`;

export const liveActivityToggleButtonStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 999px;
  background: ${colors.bg};
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  line-height: 1;
  padding: ${spacing.xs} ${spacing.sm};
  cursor: pointer;

  &:hover {
    border-color: ${colors.primary};
    color: ${colors.text};
  }
`;

export const liveActivityTraceStyles = css`
  display: grid;
  gap: 4px;
`;

export const liveActivityTraceLineStyles = css`
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.md};
  background: ${colors.bg};
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  white-space: pre-wrap;
  padding: ${spacing.xs} ${spacing.sm};
`;

export const liveActivityDetailsStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background: ${colors.surface};
  padding: 4px 6px;
  min-height: 0;
  display: grid;
`;

export const liveActivityDetailsBodyStyles = css`
  margin-top: 6px;
  display: grid;
  gap: 6px;
  max-height: min(320px, 38vh);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 2px;
`;

export const moreActionsStyles = css`
  padding: 0 ${spacing.lg} ${spacing.lg};
`;

export const rightTabsStyles = css`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  padding: ${spacing.lg};
  border-bottom: 1px solid ${colors.border};
  background: rgba(20, 27, 38, 0.98);
`;

export const rightTabButtonStyles = css`
  border: 1px solid ${colors.border};
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  padding: ${spacing.sm} ${spacing.md};
  cursor: pointer;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
`;

export const rightTabButtonActiveStyles = css`
  border-color: rgba(125, 167, 255, 0.24);
  color: ${colors.text};
  background: rgba(125, 167, 255, 0.12);
`;

export const rightTabBodyStyles = css`
  display: grid;
  gap: ${spacing.md};
  min-height: 0;
  overflow: visible;
  padding-bottom: ${spacing.lg};
`;

export const resultsHeaderStyles = css`
  padding: ${spacing.lg} ${spacing.lg} ${spacing.sm};
  font-size: ${fontSize.sm};
  color: ${colors.textDim};
`;

export const cardsStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${spacing.md};
  padding: 0 ${spacing.lg} ${spacing.lg};

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

export const cardStyles = css`
  ${subtleSurfaceCardStyles}
  overflow: hidden;
  display: grid;
  grid-template-rows: auto 1fr;
`;

export const cardBodyStyles = css`
  padding: ${spacing.lg};
  display: grid;
  gap: ${spacing.sm};
`;

export const thumbnailStyles = css`
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  background: ${colors.grayLight};
  display: block;
`;

export const titleStyles = css`
  font-size: ${fontSize.sm};
  font-weight: ${fontWeight.semibold};
  color: ${colors.text};
  line-height: ${lineHeight.relaxed};
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

export const metaStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
`;

export const cardMetaRowStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.xs};
  align-items: center;
`;

export const cardActionsStyles = css`
  display: grid;
  gap: ${spacing.sm};
`;

export const cardSecondaryActionsStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${spacing.sm};
`;

export const cardMoreActionsStyles = css`
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.lg};
  background: rgba(255, 255, 255, 0.02);
  padding: ${spacing.xs} ${spacing.sm};
`;

export const historySectionStyles = css`
  padding: ${spacing.lg};
  display: grid;
  gap: ${spacing.md};
`;

export const historyTitleStyles = css`
  font-size: ${fontSize.sm};
  color: ${colors.text};
  font-weight: ${fontWeight.semibold};
`;

export const historyCardsStyles = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${spacing.md};
`;

export const channelQuickActionsStyles = css`
  display: grid;
  gap: 8px;
`;

export const channelQuickActionRowStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
`;

export const emptyTabStateStyles = css`
  margin: 0 ${spacing.lg} ${spacing.lg};
  padding: ${spacing.xl};
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: ${borderRadius.xl};
  background: rgba(255, 255, 255, 0.02);
  font-size: ${fontSize.sm};
  color: ${colors.textDim};
`;

export const historyActionsStyles = css`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${spacing.sm};

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

export const modelHintStyles = css`
  padding: ${spacing.md} ${spacing.lg};
  font-size: ${fontSize.sm};
  color: ${colors.gray};
  border-bottom: 1px solid ${colors.border};
`;

export const panelErrorStyles = css`
  padding: 0 ${spacing.lg} ${spacing.lg};
`;
