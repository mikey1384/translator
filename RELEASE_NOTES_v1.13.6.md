# v1.13.6

## Title
fix Windows packaging for the new icon library

## Release Notes

- Fixed a packaging issue where `lucide-react` could fail to resolve in stricter workspace builds, which mainly affected Windows release packaging.
- Moved the icon library dependency to the renderer workspace where it is actually used, so app bundles resolve it consistently across platforms.

## Annotated Tag Body

```text
v1.13.6: fix Windows packaging for the new icon library

- Fixed a packaging issue where `lucide-react` could fail to resolve in stricter workspace builds, which mainly affected Windows release packaging.
- Moved the icon library dependency to the renderer workspace where it is actually used, so app bundles resolve it consistently across platforms.
```
