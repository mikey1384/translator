# v1.13.7

## Title
catch-up release: stronger dubbing, smarter recommendations, clearer saves, and more reliable packaging

## Release Notes

- Rolled up the major improvements from the recent patch train into one release, including much stronger dubbing reliability and better recovery from transient relay failures.
- Fixed several local-video and transcription blockers, including cases where duration detection, ffprobe analysis, or subtitle workflow state could get stuck before work actually began.
- Upgraded AI video recommendation so it feels more like a persistent workspace: history and channels are easier to revisit, search state survives better, follow-up suggestions are smarter, and “search more” gives clearer live feedback.
- Improved download handling and yt-dlp recovery: metadata like titles, thumbnails, and channels is recorded more reliably, saved downloads are preserved better, and Windows packaging now refreshes dependencies cleanly before release builds.
- Made error reporting much more actionable with better app context, main-process log details, and clearer reporting for real setup/infrastructure failures.
- Cleaned up the editor and player workflow with better side-menu actions, more consistent progress behavior, clearer subtitle save actions, and a generally tighter recommendation/history UI.

## Annotated Tag Body

```text
v1.13.7: catch-up release: stronger dubbing, smarter recommendations, clearer saves, and more reliable packaging

- Rolled up the major improvements from the recent patch train into one release, including much stronger dubbing reliability and better recovery from transient relay failures.
- Fixed several local-video and transcription blockers, including cases where duration detection, ffprobe analysis, or subtitle workflow state could get stuck before work actually began.
- Upgraded AI video recommendation so it feels more like a persistent workspace: history and channels are easier to revisit, search state survives better, follow-up suggestions are smarter, and “search more” gives clearer live feedback.
- Improved download handling and yt-dlp recovery: metadata like titles, thumbnails, and channels is recorded more reliably, saved downloads are preserved better, and Windows packaging now refreshes dependencies cleanly before release builds.
- Made error reporting much more actionable with better app context, main-process log details, and clearer reporting for real setup/infrastructure failures.
- Cleaned up the editor and player workflow with better side-menu actions, more consistent progress behavior, clearer subtitle save actions, and a generally tighter recommendation/history UI.
```
