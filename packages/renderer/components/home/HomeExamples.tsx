import { css } from '@emotion/css';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { colors } from '../../styles';
import { HOME_VIDEO_EXAMPLES, type HomeVideoExample } from './home-examples';

const examples = css`
  border-top: 1px solid ${colors.border};
  padding-top: 12px;
`;

const toggle = css`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: ${colors.textDim};
  font: inherit;
  font-size: 0.86rem;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 4px;
  }

  &[aria-expanded='true'] svg {
    transform: rotate(180deg);
  }
`;

const choices = css`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
`;

const choice = css`
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 12px 14px;
  border: 1px solid ${colors.borderStrong};
  border-radius: 12px;
  background: ${colors.surfaceRaised};
  color: ${colors.text};
  font: inherit;
  font-size: 0.9rem;
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;

  small {
    color: ${colors.textDim};
    font-size: 0.78rem;
  }

  &:hover:not(:disabled),
  &[aria-pressed='true'] {
    border-color: ${colors.primary};
  }

  &:focus-visible {
    outline: 2px solid ${colors.primary};
    outline-offset: 3px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const hint = css`
  margin: 10px 0 0;
  color: ${colors.textDim};
  font-size: 0.82rem;
  line-height: 1.5;
`;

const credit = css`
  margin: 4px 0 0;
  color: ${colors.textDim};
  font-size: 0.74rem;
  line-height: 1.5;
`;

export default function HomeExamples({
  hasRecentVideos,
  urlInput,
  disabled,
  onChoose,
}: {
  hasRecentVideos: boolean;
  urlInput: string;
  disabled: boolean;
  onChoose: (example: HomeVideoExample, pointerActivation: boolean) => void;
}) {
  const { t } = useTranslation();
  // A fresh install starts expanded. Returning users can still reveal the
  // examples; no first-run wizard or automatic network request is needed.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? !hasRecentVideos;
  const selected = HOME_VIDEO_EXAMPLES.some(
    example => example.url === urlInput.trim()
  );

  return (
    <div className={examples} data-home-examples>
      <button
        type="button"
        className={toggle}
        aria-expanded={open}
        aria-controls="home-examples"
        onClick={() => setExpanded(!open)}
      >
        {t('home.examples.title', 'Try an example')}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div id="home-examples">
          <div className={choices}>
            {HOME_VIDEO_EXAMPLES.map(example => (
              <button
                key={example.id}
                type="button"
                className={choice}
                data-home-example={example.id}
                aria-pressed={urlInput.trim() === example.url}
                disabled={disabled}
                onClick={event => onChoose(example, event.detail > 0)}
              >
                <span>
                  {example.id === 'youtube'
                    ? 'YouTube'
                    : t('home.examples.webpage', 'Video on a webpage')}
                </span>
                <small dir="ltr">{example.site}</small>
              </button>
            ))}
          </div>
          <p className={hint} role="status" aria-live="polite">
            {selected
              ? t(
                  'home.examples.ready',
                  'Link added above. Click {{download}} when you’re ready.',
                  { download: t('home.downloadOnly', 'Download only') }
                )
              : t(
                  'home.examples.hint',
                  'Choose an example to fill in the link, then click {{download}}.',
                  { download: t('home.downloadOnly', 'Download only') }
                )}
          </p>
          <p className={credit}>
            Tears of Steel · Blender Foundation · CC BY 3.0
          </p>
        </div>
      )}
    </div>
  );
}
