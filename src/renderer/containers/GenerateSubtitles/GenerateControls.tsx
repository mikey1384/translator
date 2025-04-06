import Section from '../../components/Section.js';
import Button from '../../components/Button.js';
import ButtonGroup from '../../components/ButtonGroup.js';
import { SrtSegment } from '../../../types/interface.js';

interface GenerateControlsProps {
  videoFile: File | null;
  videoFilePath?: string | null;
  isGenerating: boolean;
  isProcessingUrl: boolean;
  handleGenerateSubtitles: () => void;
  subtitleSegments: SrtSegment[];
  handleSaveSubtitles: () => void;
}

export default function GenerateControls({
  videoFile,
  videoFilePath,
  isGenerating,
  isProcessingUrl,
  handleGenerateSubtitles,
  subtitleSegments,
  handleSaveSubtitles,
}: GenerateControlsProps) {
  return (
    <Section title="3. Generate Subtitles" isSubSection>
      <ButtonGroup>
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

        {subtitleSegments && subtitleSegments.length > 0 && (
          <Button variant="secondary" onClick={handleSaveSubtitles} size="md">
            Save SRT
          </Button>
        )}
      </ButtonGroup>
    </Section>
  );
}
