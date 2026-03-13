# v1.13.10

## Title
safer long transcriptions, clearer BYO AI controls, and smarter portrait clips

## Release Notes

- Improved long-transcription reliability for large Stage5 jobs: durable uploads reconnect more cleanly, retries are less likely to restart the wrong work, and transient outages are less likely to kick a running job down to a second fallback path.
- Reworked the BYO AI settings into clearer direct choices. Transcription, dubbing, review pass, and summary now surface provider/model picks more honestly, and unavailable providers stay visible as disabled options instead of disappearing.
- Upgraded portrait highlight exports with smarter subject-aware reframing when the local model is available, while keeping a clean padded portrait fallback when that model cannot initialize or run.
- Tightened workflow and error handling around long-running tasks so expected key, credit, and network states are presented more clearly and less disruptively.
- Updated ElevenLabs-related pricing and estimate displays to match the current v3 dubbing model and the newer provider routing behavior.

## Annotated Tag Body

```text
v1.13.10: safer long transcriptions, clearer BYO AI controls, and smarter portrait clips

- Improved long-transcription reliability for large Stage5 jobs: durable uploads reconnect more cleanly, retries are less likely to restart the wrong work, and transient outages are less likely to kick a running job down to a second fallback path.
- Reworked the BYO AI settings into clearer direct choices. Transcription, dubbing, review pass, and summary now surface provider/model picks more honestly, and unavailable providers stay visible as disabled options instead of disappearing.
- Upgraded portrait highlight exports with smarter subject-aware reframing when the local model is available, while keeping a clean padded portrait fallback when that model cannot initialize or run.
- Tightened workflow and error handling around long-running tasks so expected key, credit, and network states are presented more clearly and less disruptively.
- Updated ElevenLabs-related pricing and estimate displays to match the current v3 dubbing model and the newer provider routing behavior.
```
