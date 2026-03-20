# v1.13.16

## Title
steadier subtitle editor visibility, safer transcript replacement, and more reliable subtitle ownership

## Release Notes

- Made the subtitle editor surface more consistently when subtitles are mounted, while keeping highlight-owned subtitle work read-only instead of hiding the editor outright.
- Tightened editor locking so highlight workflows block subtitle mutations without unnecessarily blocking stable transcript export once transcription is finished.
- Reworked subtitle history ownership for local videos so fresh transcriptions replace stale subtitle attachments more predictably, even across app reloads and replaced files.
- Fixed a class of wrong-subtitle remount bugs by matching stored subtitles with stronger local file identity checks instead of trusting reused paths alone.
- Hardened subtitle-history detach and restore behavior for mixed-case local paths and case-sensitive filesystems, reducing bad remounts after retranscribing or swapping local files.

## Annotated Tag Body

```text
v1.13.16: steadier subtitle editor visibility, safer transcript replacement, and more reliable subtitle ownership

- Made the subtitle editor surface more consistently when subtitles are mounted, while keeping highlight-owned subtitle work read-only instead of hiding the editor outright.
- Tightened editor locking so highlight workflows block subtitle mutations without unnecessarily blocking stable transcript export once transcription is finished.
- Reworked subtitle history ownership for local videos so fresh transcriptions replace stale subtitle attachments more predictably, even across app reloads and replaced files.
- Fixed a class of wrong-subtitle remount bugs by matching stored subtitles with stronger local file identity checks instead of trusting reused paths alone.
- Hardened subtitle-history detach and restore behavior for mixed-case local paths and case-sensitive filesystems, reducing bad remounts after retranscribing or swapping local files.
```
