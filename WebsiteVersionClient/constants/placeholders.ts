import localize from './localize';

const enterCommentLabel = localize('enterComment');
const enterDescriptionLabel = localize('enterDescription');
const optionalLabel = localize('optional');
const enterHeadingLabel = localize('enterHeading');
const enterTitleLabel = localize('enterTitle');
const enterUrlLabel = localize('enterUrl');
const enterSecretMessageLabel = localize('enterSecretMessage');
const enterSubjectLabel = localize('enterSubject');
const enterYoutubeUrlLabel = localize('enterYoutubeUrl');

export const edit = {
  comment: `${enterCommentLabel}...`,
  description: `${enterDescriptionLabel}... ${optionalLabel}`,
  heading: `${enterHeadingLabel}... ${optionalLabel}`,
  title: `${enterTitleLabel}...`,
  url: `${enterUrlLabel}...`,
  secretAnswer: `${enterSecretMessageLabel}...`,
  subject: `${enterSubjectLabel}...`,
  video: `${enterYoutubeUrlLabel}...`
};
