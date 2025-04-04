# Translator App UI/UX TODO

## UI Alignment Issues

- [ ] Fix vertical alignment of "Save" and "Save as text" buttons with their icons (should be centered)
- [ ] Rename "Merge Subtitles to Video" button to just "Merge Subtitles" and add an icon

## Missing Features

- [ ] Restore the "Go to current" button (scrolls to the subtitle segment corresponding to the current video timestamp)

## User Experience Improvements

- [ ] Add confirmation popups when canceling subtitle translation or merge processes
- [ ] Check if the review process is working correctly (doesn't seem to improve translations much)
- [ ] Provide more context to the LLM during the review phase compared to translation phase
- [ ] Restore the functionality that briefly highlights reviewed parts when they arrive from the server

## Progress Indicators

- [x] Improve audio extraction progress reporting
- [x] Fix confusing transcription stage messaging
- [x] Add time estimates to long-running processes
