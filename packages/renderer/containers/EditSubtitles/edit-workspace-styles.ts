import { css } from '@emotion/css';
import {
  breakpoints,
  colors,
  inputStyles,
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
} from '../../components/design-system/tokens.js';

export const editorWorkspaceStackStyles = css`
  display: grid;
  gap: ${spacing.xl};
`;

export const editorStatusShellStyles = css`
  ${surfaceCardStyles}
  padding: ${spacing.lg};
  display: grid;
  gap: ${spacing.md};
`;

export const editorStatusPillRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

export const editorStatusPillStyles = css`
  ${metaPillStyles}
`;

export const editorStatusActionRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.md};
`;

export const editorStatusSourceListStyles = css`
  display: grid;
  gap: ${spacing.xs};
`;

export const editorStatusSourceItemStyles = css`
  min-width: 0;
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.normal};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const editorEmptyStateStyles = css`
  ${subtleSurfaceCardStyles}
  min-height: 180px;
  padding: ${spacing.lg};
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const editorEmptyActionsStyles = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
`;

export const editorEmptyPrimaryButtonStyles = css`
  min-width: 280px;
  min-height: 56px;
  padding-left: ${spacing['2xl']};
  padding-right: ${spacing['2xl']};
  font-size: ${fontSize.lg};

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    min-width: 100%;
  }
`;

export const editorListShellStyles = css`
  display: grid;
  gap: ${spacing.lg};
`;

export const editorListHeaderStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${spacing.md};
`;

export const editorListHeaderMainStyles = css`
  display: grid;
  gap: 4px;
`;

export const editorListTitleStyles = css`
  margin: 0;
  color: ${colors.text};
  font-size: ${fontSize.lg};
  font-weight: ${fontWeight.semibold};
  letter-spacing: -0.02em;
`;

export const editorListMetaStyles = css`
  margin: 0;
  color: ${colors.textDim};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
`;

export const editorListActionRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

export const editorListStackStyles = css`
  display: flex;
  flex-direction: column;
  gap: ${spacing.lg};
  padding-bottom: 78px;
`;

export const editorFooterDockStyles = css`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  padding: ${spacing.sm} ${spacing.lg} ${spacing.lg};
  pointer-events: none;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.xs} ${spacing.sm} ${spacing.sm};
  }
`;

export const editorFooterInnerStyles = css`
  ${surfaceCardStyles}
  width: min(1240px, 100%);
  margin: 0 auto;
  padding: ${spacing.sm} ${spacing.md};
  pointer-events: auto;
  overflow-x: auto;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    padding: ${spacing.sm};
  }
`;

export const editorToolbarGridStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.md};

  @media (max-width: 1040px) {
    align-items: stretch;
  }
`;

export const editorToolbarSectionStyles = css`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: ${spacing.sm};
`;

export const editorToolbarPrimarySectionStyles = css`
  flex: 0 1 auto;
`;

export const editorToolbarSectionTitleStyles = css`
  display: none;
`;

export const editorToolbarSectionMetaStyles = css`
  display: none;
`;

export const editorToolbarActionRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const editorToolbarFieldGridStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: ${spacing.md};
`;

export const editorToolbarFieldStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
  min-width: 0;
`;

export const editorToolbarLabelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
`;

export const editorToolbarHintStyles = css`
  color: ${colors.gray};
  font-size: ${fontSize.xs};
  line-height: ${lineHeight.normal};
`;

export const editorToolbarInputStyles = css`
  ${inputStyles}
  max-width: none;
  min-height: 40px;
`;

export const editorToolbarCompactInputStyles = css`
  ${inputStyles}
  max-width: none;
  min-height: 36px;
  height: 36px;
  width: 76px;
  text-align: center;
  padding: 0 ${spacing.sm};
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
`;

export const editorToolbarSelectStyles = css`
  ${selectStyles}
  max-width: none;
  width: 152px;
  min-height: 44px;
  height: 44px;
  padding: 0 2.25rem 0 ${spacing.md};
  line-height: 1.2;
  background-position: right ${spacing.sm} center;
  text-align: left;
`;

export const editorToolbarCheckboxLabelStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
  color: ${colors.text};
  font-size: ${fontSize.sm};
  cursor: pointer;
  min-height: 36px;
  white-space: nowrap;
`;

export const editorToolbarCheckboxInputStyles = css`
  accent-color: ${colors.primary};
`;

export const editorButtonContentStyles = css`
  display: inline-flex;
  align-items: center;
  gap: ${spacing.sm};
`;

export const editorSaveButtonStyles = css`
  min-width: 156px;
`;

export const editorMergeButtonStyles = css`
  color: #ffffff !important;
  background: linear-gradient(135deg, #ff8bc0, ${colors.progressMerge});
  border-color: rgba(247, 85, 154, 0.28);
  box-shadow: 0 10px 22px rgba(247, 85, 154, 0.2);

  &:hover:not(:disabled) {
    background: linear-gradient(135deg, #ff9ccc, #e0488a);
    border-color: rgba(247, 85, 154, 0.42);
  }

  &:active:not(:disabled) {
    background: linear-gradient(135deg, #f86aaa, #c7407b);
    border-color: rgba(247, 85, 154, 0.5);
  }
`;

export const editorTranslateBarStyles = css`
  ${subtleSurfaceCardStyles}
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.md};
  padding: ${spacing.md} ${spacing.lg};
  border-color: rgba(87, 182, 218, 0.24);
  background: rgba(87, 182, 218, 0.08);
`;

export const editorTranslateLabelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const editorTranslateSelectStyles = css`
  ${selectStyles}
  width: auto;
  min-width: 200px;
  min-height: 44px;
  height: 44px;
  text-align: left;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

export const subtitleRowCardStyles = css`
  ${subtleSurfaceCardStyles}
  padding: ${spacing.lg};
  display: grid;
  gap: ${spacing.md};
`;

export const subtitleRowHeaderStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${spacing.md};
`;

export const subtitleRowIndexStyles = css`
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 ${spacing.sm};
  border-radius: ${borderRadius.full};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

export const subtitleRowHeaderActionsStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
  align-items: center;
`;

export const subtitleRowContentStyles = css`
  display: grid;
  gap: ${spacing.md};
`;

export const subtitleRowFieldShellStyles = css`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: ${spacing.md};
  align-items: start;

  @media (max-width: 960px) {
    grid-template-columns: 1fr;
  }
`;

export const subtitleRowFieldStackStyles = css`
  display: grid;
  gap: ${spacing.xs};
  min-width: 0;
`;

export const subtitleRowFieldLabelStyles = css`
  color: ${colors.textDim};
  font-size: ${fontSize.xs};
  font-weight: ${fontWeight.semibold};
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export const subtitleRowSideActionStyles = css`
  display: grid;
  gap: ${spacing.sm};
  align-content: start;

  @media (max-width: 960px) {
    justify-items: start;
  }
`;

export const subtitleRowOldTextStyles = css`
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  color: ${colors.textDim};
  white-space: pre-wrap;
`;

export const subtitleRowFooterStyles = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: ${spacing.md};

  @media (max-width: 960px) {
    align-items: stretch;
  }
`;

export const subtitleRowTimeGroupStyles = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};
`;

export const subtitleRowTimeInputStyles = css`
  ${inputStyles}
  min-height: 38px;
  max-width: none;
  width: 144px;
  padding: ${spacing.sm} ${spacing.md};
  font-family: monospace;

  @media (max-width: ${breakpoints.mobileMaxWidth}) {
    width: 100%;
  }
`;

export const subtitleRowDividerStyles = css`
  color: ${colors.gray};
  font-size: ${fontSize.sm};
`;

export const subtitleRowPlaceholderStyles = css`
  height: 164px;
`;

const editorTextareaBaseStyles = css`
  padding: ${spacing.md};
  font-size: ${fontSize.sm};
  line-height: ${lineHeight.relaxed};
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
    'Courier New', monospace;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow: auto;
  width: 100%;
`;

export const editorTextareaShellStyles = (
  rows: number,
  readOnly: boolean
) => css`
  position: relative;
  width: 100%;
  min-height: calc(${rows} * 1.75em + (${spacing.md} * 2));
  border-radius: ${borderRadius.xl};
  border: 1px solid ${readOnly ? colors.border : colors.borderStrong};
  background: ${readOnly ? 'rgba(255, 255, 255, 0.02)' : colors.surface};
`;

export const editorTextareaHighlightStyles = (rows: number) => css`
  ${editorTextareaBaseStyles}
  position: absolute;
  inset: 0;
  min-height: calc(${rows} * 1.75em + (${spacing.md} * 2));
  pointer-events: none;
  color: ${colors.text};
  border: 1px solid transparent;
  z-index: 1;
`;

export const editorTextareaInputStyles = (
  rows: number,
  readOnly: boolean
) => css`
  ${editorTextareaBaseStyles}
  position: relative;
  min-height: calc(${rows} * 1.75em + (${spacing.md} * 2));
  background: transparent;
  resize: none;
  border: 1px solid transparent;
  color: transparent;
  caret-color: ${readOnly ? 'transparent' : colors.text};
  z-index: 2;
  cursor: ${readOnly ? 'not-allowed' : 'text'};

  &:focus {
    outline: none;
    border-color: ${readOnly ? 'transparent' : colors.primary};
    box-shadow: ${readOnly ? 'none' : `0 0 0 3px rgba(125, 167, 255, 0.12)`};
  }
`;

export const editorTextareaLockedBadgeStyles = css`
  position: absolute;
  top: ${spacing.sm};
  right: ${spacing.sm};
  z-index: 3;
  background: rgba(9, 13, 20, 0.88);
  color: ${colors.textDim};
  border: 1px solid ${colors.border};
  border-radius: ${borderRadius.full};
  padding: 2px ${spacing.sm};
  font-size: ${fontSize.xs};
  display: inline-flex;
  gap: ${spacing.xs};
  align-items: center;
  pointer-events: none;
`;

export const editorTextareaLockIconStyles = css`
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
`;

export const editorTextareaPlaceholderStyles = css`
  color: ${colors.gray};
`;

export const editorTextareaHighlightMatchStyles = css`
  background: rgba(240, 180, 75, 0.9);
  color: #141b26;
  border-radius: ${borderRadius.sm};
  padding: 0 1px;
`;

export const editorFindBarStyles = css`
  ${surfaceCardStyles}
  position: fixed;
  top: ${spacing.md};
  right: ${spacing.md};
  z-index: 1200;
  padding: ${spacing.sm};
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${spacing.sm};

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    left: ${spacing.md};
    right: ${spacing.md};
  }
`;

export const editorFindInputStyles = css`
  ${inputStyles}
  min-height: 36px;
  height: 36px;
  max-width: none;
  min-width: 180px;
  padding: 0 ${spacing.md};

  @media (max-width: ${breakpoints.tabletMaxWidth}) {
    min-width: 0;
    flex: 1 1 220px;
  }

  &::-webkit-search-decoration,
  &::-webkit-search-cancel-button,
  &::-webkit-search-results-button,
  &::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }
`;

export const editorFindReplaceInputStyles = css`
  ${editorFindInputStyles}
  min-width: 148px;
`;

export const editorFindMatchCountStyles = css`
  ${metaPillStyles}
  min-width: 78px;
  justify-content: center;
  text-align: center;
`;

export const editorFindMatchCountErrorStyles = css`
  color: ${colors.danger};
  border-color: rgba(255, 109, 114, 0.26);
  background: rgba(255, 109, 114, 0.08);
`;

export const editorFindIconButtonStyles = css`
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: ${borderRadius.lg};
  border: 1px solid ${colors.border};
  background: rgba(255, 255, 255, 0.03);
  color: ${colors.text};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &:hover:not(:disabled) {
    border-color: ${colors.borderStrong};
    background: rgba(255, 255, 255, 0.07);
  }

  &:disabled {
    color: ${colors.gray};
    cursor: not-allowed;
    opacity: 0.6;
  }
`;
