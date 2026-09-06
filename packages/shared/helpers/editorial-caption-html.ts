import type { SubtitleRenderState } from '@shared-types/app';

const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Shared by the editable Shorts preview and the exported transparent overlay. */
export function editorialCaptionHtml(
  state: Extract<SubtitleRenderState, { mode: 'editorial' }>,
  width: number
): string {
  const unit = width / 1080;
  const fontSize = 88 * unit;
  let text = escape(state.text);
  if (state.emphasis && state.text.includes(state.emphasis)) {
    text = text.replace(
      escape(state.emphasis),
      `<span style="color:#d9ff66">${escape(state.emphasis)}</span>`
    );
  }
  const font =
    "'Pretendard','SUIT','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
  return `<div style="position:absolute;inset:0;pointer-events:none;font-family:${font};color:white;">
    ${state.label ? `<div style="position:absolute;top:5.5%;left:7%;font-size:${33 * unit}px;font-weight:750;letter-spacing:${0.3 * unit}px;text-shadow:0 ${2 * unit}px ${8 * unit}px #000"><span style="display:inline-block;width:${6 * unit}px;height:${27 * unit}px;background:#d9ff66;margin-right:${16 * unit}px;vertical-align:middle"></span>${escape(state.label)}</div>` : ''}
    ${state.text ? `<div style="position:absolute;left:6%;right:12%;top:64%;text-align:center;transform:scale(${Math.max(0.9, Math.min(1.1, state.scale ?? 1))});transform-origin:center;white-space:pre-wrap;font-size:${fontSize}px;line-height:1.22;font-weight:900;letter-spacing:${-2.8 * unit}px;word-break:keep-all;overflow-wrap:break-word;paint-order:stroke fill;-webkit-text-stroke:${6 * unit}px #151715;text-shadow:0 ${6 * unit}px ${4 * unit}px #151715,0 ${10 * unit}px ${24 * unit}px #0009;">${text}</div>` : ''}
  </div>`;
}
