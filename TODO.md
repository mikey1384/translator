# Translator App UI/UX TODO

## User Experience Improvements

- [x] Provide more context to the LLM during the review phase compared to translation phase
- [x] Restore the functionality that briefly highlights reviewed parts when they arrive from the server
- [x] Fix the review process by properly handling segment context to prevent repeating the same lines
- [x] Fix video preview position to display below the progress bar during translation/merging operations
- [x] Fix missing download popup after video merging with subtitles completes
- [x] Prevent video player expand/shrink when using the "Scroll to current" button
- [x] Fix shrink-then-expand behavior when scrolling up after using "Scroll to current"
- [x] Clear video player sizing cooldowns when user scrolls counter to the last size change
- [x] Fix video player size changing during automatic scrolling from the "Scroll to Current" button
- [x] Prevent video player from scrolling off screen when pressing Enter in subtitle textareas
- [ ] Fix sticky video player incorrectly expanding/shrinking when progress bar changes during merging/translating

## Progress Indicators

- [x] Improve audio extraction progress reporting
- [x] Fix confusing transcription stage messaging
- [x] Add time estimates to long-running processes
