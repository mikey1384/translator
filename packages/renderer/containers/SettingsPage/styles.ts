import { css } from '@emotion/css';
import {
  breakpoints,
  colors,
  gradients,
  shadows,
} from '../../styles';
import {
  borderRadius,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
} from '../../components/design-system/tokens.js';

export const settingsPageLayoutStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing['4xl']};
  padding: ${spacing.md} 0 ${spacing['4xl']};
`;

export const settingsCenterColumnStyles = css`
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
`;

export const byoCardStyles = css`
  box-sizing: border-box;
  background: ${gradients.surface};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius['2xl']};
  padding: ${spacing['2xl']};
  width: min(920px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${spacing.xl};
  box-shadow: ${shadows.section};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.xl};
  }
`;

export const settingsCardTitleStyles = css`
  margin: 0;
  font-size: clamp(1.05rem, 1.5vw, 1.2rem);
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
  color: ${colors.text};
`;

export const settingsBodyTextStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.md};
  line-height: ${lineHeight.relaxed};
`;

export const settingsMetaTextStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.normal};
`;

export const settingsInlineLinkButtonStyles = css`
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: ${colors.primaryLight};
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 0.16em;

  &:hover {
    color: ${colors.text};
  }

  &:focus-visible {
    outline: 2px solid rgba(125, 167, 255, 0.28);
    outline-offset: 2px;
    border-radius: ${borderRadius.sm};
  }
`;

export const settingsCalloutStyles = css`
  display: grid;
  gap: ${spacing.xs};
  padding: ${spacing.lg};
  border-radius: ${borderRadius.xl};
  border: 1px solid ${colors.border};
  background: rgba(125, 167, 255, 0.06);
`;

export const settingsCalloutTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
`;

export const settingsCalloutBodyStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const settingsDangerCalloutStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
  padding: ${spacing.lg};
  border-radius: ${borderRadius.lg};
  border: 1px solid rgba(255, 109, 114, 0.34);
  background: rgba(255, 109, 114, 0.1);
  color: ${colors.danger};
`;

export const settingsDangerTextStyles = css`
  margin: 0;
  color: ${colors.danger};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const settingsStatusMessageStyles = css`
  margin: 0;
  color: ${colors.primaryLight};
  font-size: ${fontSize.sm};
`;

export const settingsStatusErrorStyles = css`
  margin: 0;
  color: ${colors.danger};
  font-size: ${fontSize.sm};
`;

export const byoLayoutStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 300px);
  gap: ${spacing.xl};
  align-items: start;

  @media (max-width: ${breakpoints.laptopMaxWidth}) {
    grid-template-columns: 1fr;
  }
`;

export const byoPrimaryColumnStyles = css`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
`;

export const byoSidebarCardStyles = css`
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
  padding: ${spacing.lg};
  border-radius: ${borderRadius.xl};
  border: 1px solid ${colors.border};
  background: rgba(125, 167, 255, 0.05);
  overflow: hidden;

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    width: 100%;
  }
`;

export const byoVoiceSectionStyles = css`
  margin-top: ${spacing.sm};
`;

export const apiKeyModeToggleCardStyles = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.md};
  padding: ${spacing.lg};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.xl};
  background: rgba(255, 255, 255, 0.015);

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    flex-direction: column;
    align-items: stretch;
  }
`;

export const apiKeyModeToggleCardActiveStyles = css`
  background: rgba(125, 167, 255, 0.08);
  border-color: ${colors.borderStrong};
`;

export const apiKeyModeToggleDetailsStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xs};
  min-width: 0;
`;

export const apiKeyModeToggleLabelStyles = css`
  color: ${colors.text};
  font-size: ${fontSize.md};
  font-weight: ${fontWeight.semibold};
`;

export const modalGuideContentStyles = css`
  width: min(640px, 92vw);
  max-height: 85vh;
`;

export const modalGuideBodyStyles = css`
  overflow-y: auto;
`;

export const modalGuideStackStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.xl};
`;

export const modalGuideSectionStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.md};
`;

export const modalGuideSectionDividedStyles = css`
  border-top: 1px solid ${colors.border};
  padding-top: ${spacing.xl};
`;

export const modalGuideTitleRowStyles = css`
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
  flex-wrap: wrap;
`;

export const modalGuideTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: ${fontSize.lg};
  font-weight: ${fontWeight.semibold};
`;

export const modalGuideTagStyles = css`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const modalGuideTagRequiredStyles = css`
  background: rgba(125, 167, 255, 0.16);
  color: ${colors.primaryLight};
  border: 1px solid rgba(125, 167, 255, 0.24);
`;

export const modalGuideTagOptionalStyles = css`
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  border: 1px solid ${colors.border};
`;

export const modalGuideCopyStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.md};
  line-height: ${lineHeight.relaxed};
`;

export const modalGuideListStyles = css`
  margin: 0;
  padding-left: 20px;
  color: ${colors.text};
  font-size: ${fontSize.md};
  line-height: 1.8;
`;

export const modalGuideLinkStyles = css`
  color: ${colors.primaryLight};
  text-decoration: underline;
  text-underline-offset: 0.16em;

  &:hover {
    color: ${colors.text};
  }
`;

export const modalGuideNoteStyles = css`
  margin: 0;
  padding: ${spacing.md} ${spacing.lg};
  border-radius: ${borderRadius.lg};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;
