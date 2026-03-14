# v1.13.13

## Title
review routing cleanup, safer BYO video preferences, and more predictable suggestion behavior

## Release Notes

- Cleaned up high-end review routing so the selected Stage5 review provider stays aligned with the actual model, pricing, and progress shown in the app.
- Fully split Stage5-credit video recommendation quality from BYO video recommendation model selection, so the two paths no longer overwrite each other.
- Preserved legacy BYO video recommendation behavior for upgraded installs: older `default` and `quality` preferences now continue to follow draft/review routing until you explicitly choose a direct model.
- Fixed API-key-mode recovery so if the app has to fall back to Stage5 credits, video recommendation routing updates immediately instead of carrying a stale BYO-derived model.
- Refined related settings copy and localized strings so provider/model choices are clearer across the app.

## Annotated Tag Body

```text
v1.13.13: review routing cleanup, safer BYO video preferences, and more predictable suggestion behavior

- Cleaned up high-end review routing so the selected Stage5 review provider stays aligned with the actual model, pricing, and progress shown in the app.
- Fully split Stage5-credit video recommendation quality from BYO video recommendation model selection, so the two paths no longer overwrite each other.
- Preserved legacy BYO video recommendation behavior for upgraded installs: older `default` and `quality` preferences now continue to follow draft/review routing until you explicitly choose a direct model.
- Fixed API-key-mode recovery so if the app has to fall back to Stage5 credits, video recommendation routing updates immediately instead of carrying a stale BYO-derived model.
- Refined related settings copy and localized strings so provider/model choices are clearer across the app.
```
