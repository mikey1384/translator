# v1.13.9

## Title
leaner global video discovery, stricter target-country search, and tougher downloads

## Release Notes

- Rebuilt the AI video recommender into a leaner flow that is easier to reason about and produces better results: candidates are broader, seed planning is simpler, and follow-up searches preserve what is already on screen instead of fighting the current result set.
- Tightened target-country search so the recommender now carries explicit YouTube region and search-language metadata through planning, continuation, and direct search-more fallback. Explicit query overrides stay literal instead of being replanned by AI.
- Simplified the recommendation UI: `Target country` is back as the primary region control, `Preferred topic` is always surfaced when available, redundant preference panels are gone, assistant replies render formatted lists properly, and search progress behaves more honestly.
- Hardened yt-dlp downloads against transient DNS failures, with retry behavior for resolver errors and clearer network-facing error messages when retries are exhausted.

## Annotated Tag Body

```text
v1.13.9: leaner global video discovery, stricter target-country search, and tougher downloads

- Rebuilt the AI video recommender into a leaner flow that is easier to reason about and produces better results: candidates are broader, seed planning is simpler, and follow-up searches preserve what is already on screen instead of fighting the current result set.
- Tightened target-country search so the recommender now carries explicit YouTube region and search-language metadata through planning, continuation, and direct search-more fallback. Explicit query overrides stay literal instead of being replanned by AI.
- Simplified the recommendation UI: `Target country` is back as the primary region control, `Preferred topic` is always surfaced when available, redundant preference panels are gone, assistant replies render formatted lists properly, and search progress behaves more honestly.
- Hardened yt-dlp downloads against transient DNS failures, with retry behavior for resolver errors and clearer network-facing error messages when retries are exhausted.
```
