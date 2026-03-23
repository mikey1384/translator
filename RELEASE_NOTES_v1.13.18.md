# v1.13.18

## Title
sharper short-form subtitles, cleaner retranscription ownership, and smoother video processing

## Release Notes

- Reworked the first-step video flow so you can transcribe, translate, or generate highlights more directly, with cleaner processing controls and target-language defaults that stay aligned with the app language and saved preferences.
- Fixed short-form original subtitle timing so one-word portrait/Shorts renders preserve the real transcript timing path, adjacent words no longer blink off between tiny gaps, and smaller short-form subtitle sizes are allowed when needed.
- Smoothed smart vertical reframing so small head movements cause fewer distracting crop nudges during highlight exports.
- Fresh retranscription now clears old source-linked subtitle ownership for that video before saving the new transcript, preventing stale cached subtitles from reattaching later.
- Normal SRT saves now keep Stage5 metadata internal instead of exporting adjacent `.stage5.json` files, while older Stage5 sidecars can still be reopened.

## Annotated Tag Body

```text
v1.13.18: sharper short-form subtitles, cleaner retranscription ownership, and smoother video processing

- Reworked the first-step video flow so you can transcribe, translate, or generate highlights more directly, with cleaner processing controls and target-language defaults that stay aligned with the app language and saved preferences.
- Fixed short-form original subtitle timing so one-word portrait/Shorts renders preserve the real transcript timing path, adjacent words no longer blink off between tiny gaps, and smaller short-form subtitle sizes are allowed when needed.
- Smoothed smart vertical reframing so small head movements cause fewer distracting crop nudges during highlight exports.
- Fresh retranscription now clears old source-linked subtitle ownership for that video before saving the new transcript, preventing stale cached subtitles from reattaching later.
- Normal SRT saves now keep Stage5 metadata internal instead of exporting adjacent `.stage5.json` files, while older Stage5 sidecars can still be reopened.
```
