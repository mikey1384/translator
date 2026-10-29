// Public, freely licensed Blender film examples. These are page URLs, not
// pre-resolved media: selecting one only fills the normal input. The user's
// subsequent Download/Translate action follows the same path as a pasted URL.
export const HOME_VIDEO_EXAMPLES = [
  {
    id: 'webpage',
    url: 'https://mango.blender.org/production/tears-of-steel-teaser/',
    site: 'mango.blender.org',
  },
  {
    id: 'youtube',
    url: 'https://www.youtube.com/watch?v=WwHux5QZfC8',
    site: 'youtube.com',
  },
] as const;

export type HomeVideoExample = (typeof HOME_VIDEO_EXAMPLES)[number];
