# v1.13.17

## Title
safer URL downloads, smarter highlight reframing, and clearer source-video recovery

## Release Notes

- Reworked URL download cancellation and result handoff so finished downloads are adopted more safely, cleanup is more reliable, and discard flows behave better across reloads and Windows file-lock delays.
- Hardened yt-dlp and JavaScript runtime setup so shared setup work joins and cancels more predictably instead of spawning redundant background probes during retries or reloads.
- Upgraded smart vertical reframing with adaptive sampling and exact shot-boundary timing correction, improving how highlight crops react to faster subject moves and multi-shot clips.
- Added clearer “source video unavailable” recovery across subtitle generation, retranscription, dubbing, highlight export, merged renders, and save flows, with localized messages instead of vague failures.
- Tightened renderer/main result handling for continue-transcribe and one-line retranscription, and expanded translator main test coverage around cancellation, cleanup, and shared job behavior.

## Annotated Tag Body

```text
v1.13.17: safer URL downloads, smarter highlight reframing, and clearer source-video recovery

- Reworked URL download cancellation and result handoff so finished downloads are adopted more safely, cleanup is more reliable, and discard flows behave better across reloads and Windows file-lock delays.
- Hardened yt-dlp and JavaScript runtime setup so shared setup work joins and cancels more predictably instead of spawning redundant background probes during retries or reloads.
- Upgraded smart vertical reframing with adaptive sampling and exact shot-boundary timing correction, improving how highlight crops react to faster subject moves and multi-shot clips.
- Added clearer “source video unavailable” recovery across subtitle generation, retranscription, dubbing, highlight export, merged renders, and save flows, with localized messages instead of vague failures.
- Tightened renderer/main result handling for continue-transcribe and one-line retranscription, and expanded translator main test coverage around cancellation, cleanup, and shared job behavior.
```
