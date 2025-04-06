import React from 'react';
import Section from '../../components/Section.js';
import Button from '../../components/Button.js';
import ButtonGroup from '../../components/ButtonGroup.js';

// Define segment type (can be shared)
interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

interface GenerateControlsProps {
  videoFile: File | null;
  videoFilePath?: string | null;
  isGenerating: boolean;
  isProcessingUrl: boolean;
  handleGenerateSubtitles: () => void;
  subtitleSegments: SubtitleSegment[];
  handleSaveSubtitles: () => void;
}

const GenerateControls: React.FC<GenerateControlsProps> = ({
  videoFile,
  videoFilePath,
  isGenerating,
  isProcessingUrl,
  handleGenerateSubtitles,
  subtitleSegments,
  handleSaveSubtitles,
}) => {
  return (
    <Section title="3. Generate Subtitles" isSubSection>
      <ButtonGroup>
        {/* Main Generate Button is now outside conditional inputs */}
        <Button
          onClick={handleGenerateSubtitles}
          disabled={
            (!videoFile && !videoFilePath) || isGenerating || isProcessingUrl
          }
          size="md"
          variant="primary"
          isLoading={isGenerating}
        >
          {isGenerating ? 'Generating...' : 'Generate Subtitles Now'}
        </Button>

        {/* Save SRT button - condition unchanged */}
        {subtitleSegments && subtitleSegments.length > 0 && (
          <Button variant="secondary" onClick={handleSaveSubtitles} size="md">
            Save SRT
          </Button>
        )}
      </ButtonGroup>
    </Section>
  );
};

export default GenerateControls;
