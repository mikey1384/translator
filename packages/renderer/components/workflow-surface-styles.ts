import { css } from '@emotion/css';
import {
  breakpoints,
  colors,
  shadows,
} from '../styles.js';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
  transitions,
} from './design-system/tokens.js';

export const workflowStatusOverlayStyles = css`
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 1100;
  padding: ${spacing.lg} ${spacing.xl} 0;
  pointer-events: none;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.md} ${spacing.md} 0;
  }
`;

export const workflowStatusStackStyles = css`
  width: min(940px, 100%);
  margin: 0 auto;
  display: grid;
  gap: ${spacing.sm};
  pointer-events: auto;
`;

export const workflowStatusCardStyles = css`
  display: grid;
  gap: ${spacing.lg};
  padding: ${spacing.lg} ${spacing.xl};
  border-radius: ${borderRadius['2xl']};
  border: 1px solid ${colors.borderStrong};
  background: rgba(12, 17, 27, 0.96);
  box-shadow: ${shadows.lg};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.md} ${spacing.lg};
  }
`;

export const workflowStatusHeaderStyles = css`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${spacing.md};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
  }
`;

export const workflowStatusHeadingStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.sm};
  min-width: 0;
`;

export const workflowStatusTitleRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const workflowStatusTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: clamp(1rem, 1.2vw, 1.2rem);
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
`;

export const workflowStatusUtilityRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const workflowStatusIconButtonStyles = css`
  width: 38px;
  height: 38px;
  padding: 0;
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    border-color ${transitions.fast},
    background-color ${transitions.fast},
    color ${transitions.fast};

  &:hover:not(:disabled) {
    color: ${colors.text};
    border-color: ${colors.borderStrong};
    background: rgba(255, 255, 255, 0.07);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export const workflowStatusBodyStyles = css`
  display: grid;
  gap: ${spacing.sm};
`;

export const workflowStatusNoticeShellStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.sm};
  padding: ${spacing.md} ${spacing.lg};
  border-radius: ${borderRadius.xl};
  border: 1px solid rgba(240, 180, 75, 0.28);
  background: rgba(240, 180, 75, 0.08);
`;

export const workflowStatusNoticeIconStyles = css`
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: ${borderRadius.full};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.warning};
  background: rgba(240, 180, 75, 0.16);
`;

export const workflowStatusNoticeContentStyles = css`
  min-width: 0;
  display: grid;
  gap: 2px;
  color: ${colors.text};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const workflowStatusNoticeTitleStyles = css`
  font-weight: ${fontWeight.semibold};
  color: ${colors.warning};
`;

export const workflowStatusNoticeLinkStyles = css`
  color: ${colors.primaryLight};
  text-decoration: underline;
  text-underline-offset: 0.16em;

  &:hover {
    color: ${colors.text};
  }
`;

export const workflowStatusStageRowStyles = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: ${spacing.md};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: flex-start;
    gap: ${spacing.xs};
  }
`;

export const workflowStatusStageTextStyles = css`
  color: ${colors.text};
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.medium};
  line-height: ${lineHeight.relaxed};
`;

export const workflowStatusPercentStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

export const workflowStatusSubLabelStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const workflowStatusProgressTrackStyles = css`
  height: 12px;
  overflow: hidden;
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.06);
`;

export const workflowStatusProgressFillStyles = (
  progressBarColor: string,
  progress: number
) => css`
  height: 100%;
  width: ${Math.min(progress, 100)}%;
  border-radius: ${borderRadius.full};
  background: linear-gradient(90deg, ${progressBarColor}, ${progressBarColor});
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  transition: width 0.3s ease;
`;

export const workflowStageStackStyles = css`
  display: grid;
  gap: ${spacing.xl};
`;

export const workflowStageShellStyles = css`
  display: grid;
  gap: ${spacing.lg};
  padding: ${spacing.xl};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius['2xl']};
  background: ${colors.surfaceRaised};
  box-shadow: ${shadows.sm};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.lg};
  }
`;

export const workflowStageShellSecondaryStyles = css`
  background: rgba(18, 24, 35, 0.9);
  border-color: rgba(255, 255, 255, 0.08);
`;

export const workflowStageHeaderStyles = css`
  display: grid;
  gap: ${spacing.xs};
`;

export const workflowStageHeaderRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const workflowStageEyebrowStyles = css`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  border: 1px solid rgba(125, 167, 255, 0.24);
  background: rgba(125, 167, 255, 0.08);
  color: ${colors.primaryLight};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const workflowStageEyebrowSecondaryStyles = css`
  border-color: rgba(240, 180, 75, 0.24);
  background: rgba(240, 180, 75, 0.08);
  color: ${colors.warning};
`;

export const workflowStageTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: clamp(1.1rem, 1.7vw, 1.45rem);
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
`;

export const workflowStageDescriptionStyles = css`
  margin: 0;
  max-width: 72ch;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const workflowStageBodyStyles = css`
  display: grid;
  gap: ${spacing.md};
`;

export const workflowStageMetaStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const workflowStagePillStyles = css`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.medium};
`;

export const workflowPanelStyles = css`
  margin-top: ${spacing.md};
  padding: ${spacing.xl};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius['2xl']};
  background: ${colors.surfaceRaised};
  box-shadow: ${shadows.sm};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.xl};

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    flex-direction: column;
    align-items: stretch;
  }
`;

export const workflowPanelFlushStyles = css`
  margin-top: 0;
`;

export const workflowPanelSuccessStyles = css`
  border-color: rgba(57, 200, 135, 0.34);
  background: rgba(25, 34, 49, 0.98);
`;

export const workflowPanelMutedStyles = css`
  background: ${colors.surface};
`;

export const workflowPanelLeadStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.md};
  min-width: 0;
`;

export const workflowPanelLeadIconStyles = css`
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: ${borderRadius.full};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  color: ${colors.textDim};
`;

export const workflowPanelLeadIconSuccessStyles = css`
  background: rgba(57, 200, 135, 0.14);
  color: ${colors.success};
`;

export const workflowPanelTextBlockStyles = css`
  min-width: 0;
  display: grid;
  gap: 4px;
`;

export const workflowPanelTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
`;

export const workflowPanelMetaStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const workflowPanelHintStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  text-align: left;
`;

export const workflowPanelWarningBoxStyles = css`
  display: flex;
  align-items: flex-start;
  gap: ${spacing.sm};
  padding: ${spacing.sm} ${spacing.md};
  border-radius: ${borderRadius.xl};
  border: 1px solid rgba(240, 180, 75, 0.3);
  background: rgba(240, 180, 75, 0.1);
  color: ${colors.text};
`;

export const workflowPanelWarningIconStyles = css`
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  margin-top: 1px;
  border-radius: ${borderRadius.full};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${colors.warning};
  background: rgba(240, 180, 75, 0.16);
`;

export const workflowPanelWarningContentStyles = css`
  min-width: 0;
  color: ${colors.text};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  text-align: left;
`;

export const workflowPanelControlsStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: ${spacing.md};

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    justify-content: flex-start;
  }
`;

export const workflowPanelInlineFieldStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
`;

export const workflowPanelCheckboxLabelStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.xs};
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  cursor: pointer;
`;

export const workflowPanelCheckboxInputStyles = css`
  accent-color: ${colors.primary};
`;

export const workflowPanelActionGroupStyles = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${spacing.xs};
`;

export const workflowPanelCostStyles = css`
  font-size: ${fontSize.xs};
  color: ${colors.textDim};
  text-align: center;
`;

export const workflowPanelCostWarningStyles = css`
  color: ${colors.danger};
`;

export const workflowPanelBadgeStyles = css`
  color: ${colors.primaryLight};
  margin-left: 2px;
`;
