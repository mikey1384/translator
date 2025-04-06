import { ChangeEvent } from 'react';
import { css } from '@emotion/css';
import { colors, selectStyles } from '../../styles.js';
import Button from '../../components/Button.js';
import { VideoQuality } from '../../../services/url-processor.js';

interface UrlInputSectionProps {
  urlInput: string;
  setUrlInput: (value: string) => void;
  onSetVideoFile: (file: null) => void;
  setError: (error: string) => void;
  isGenerating: boolean;
  isProcessingUrl: boolean;
  downloadQuality: VideoQuality;
  setDownloadQuality: (quality: VideoQuality) => void;
  handleProcessUrl: () => void;
}

const urlInputStyles = css`
  margin-right: 8px;
  flex-grow: 1;
  min-width: 200px;
  padding: 8px 12px;
  border: 1px solid ${colors.border};
  border-radius: 4px;
  font-size: 0.95rem;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  transition: border-color 0.2s ease;

  &:focus {
    outline: none;
    border-color: ${colors.primary};
  }

  &::placeholder {
    color: ${colors.gray};
  }
`;

function UrlInputSection({
  urlInput,
  setUrlInput,
  onSetVideoFile,
  setError,
  isGenerating,
  isProcessingUrl,
  downloadQuality,
  setDownloadQuality,
  handleProcessUrl,
}: UrlInputSectionProps) {
  return (
    <div
      className={css`
        display: flex;
        align-items: center;
        justify-content: center;
        height: 35px;
        gap: 8px;
      `}
    >
      <label
        style={{
          marginRight: '12px',
          lineHeight: '32px', // Match input height
          display: 'inline-block',
          minWidth: '100px',
        }}
      >
        1. Download Video:
      </label>
      <input
        type="url"
        className={urlInputStyles}
        placeholder="Enter video URL"
        value={urlInput}
        onChange={e => {
          setUrlInput(e.target.value);
          if (e.target.value) {
            // If user starts typing URL, clear any selected file
            onSetVideoFile(null);
            setError('');
          }
        }}
        disabled={isGenerating || isProcessingUrl}
      />
      <div
        className={css`
          position: relative;
          min-width: 120px;
        `}
      >
        <label
          htmlFor="quality-select"
          className={css`
            /* Add screen-reader only styles if needed */
            position: absolute;
            width: 1px;
            height: 1px;
            margin: -1px;
            padding: 0;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            border: 0;
          `}
        >
          Quality
        </label>
        <select
          id="quality-select"
          value={downloadQuality}
          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
            setDownloadQuality(e.target.value as VideoQuality)
          }
          disabled={isProcessingUrl || isGenerating}
          className={selectStyles} // Apply existing select styles
          style={{ minWidth: '120px' }}
        >
          <option value="high">High</option>
          <option value="mid">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <Button
        onClick={handleProcessUrl}
        disabled={!urlInput || isProcessingUrl || isGenerating}
        isLoading={isProcessingUrl}
        size="md"
        variant="secondary"
      >
        {isProcessingUrl ? 'Downloading...' : 'Download'}
      </Button>
    </div>
  );
}

export default UrlInputSection;
