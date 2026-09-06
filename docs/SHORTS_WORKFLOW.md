# Shorts from saved videos

Open a video from Downloads to reuse its stored original and translated subtitles. Choose the subtitle display mode, style, and font size in the editor, then open Highlights. Generated candidates are ranked and overlapping weaker candidates are removed. No confident candidates is a valid outcome; the app no longer invents fallback moments.

Cut this highlight renders the selected interval with the current subtitles. Combine renders selected intervals in playback order. Shorts Fit preserves the whole demonstration; Shorts Reframe follows the detected subject; Original preserves the source aspect ratio. Finished previews and their original/translated subtitle documents are kept in the app library. Downloading a preview also links the saved copy to that subtitle document, so opening it again restores the timed captions.

## Agent workflow (no additional inference)

1. `app_downloads_list` and `app_downloads_open` restore a saved source and its subtitle document. A source with no saved transcript must first be transcribed using the separately authorized transcription workflow.
2. `app_highlights_get` returns the current snapshot ID and saved selection. Read `app_subtitles_get` pages, including surrounding context, before choosing an idea. Favor a clear opening, one coherent promise, and a completed final thought. Do not fill a quota, fabricate quotations, or remove context that changes meaning.
3. `app_highlights_set` receives that `snapshot_id` and a list of `id`, `title`, `start_cue_id`, `end_cue_id`, optional `description` and `reason`. It replaces the selection, preserves existing summary/notes, and saves it for the visible UI and future sessions. Each interval is 2–180 seconds. Empty selections are valid. Source or transcript edits invalidate the snapshot.
4. For plain clips, set the visual treatment through `app_set_subtitle_display` with `mode: "translation"` and `app_set_subtitle_style` with `style: "LineBox", base_font_size_px: 35`. `app_start_highlight_render` receives the same snapshot and `highlight_ids` in playback order. One ID renders one clip; several IDs concatenate clips. Choose `vertical_fit`, `vertical_reframe`, or `original`. Subtitle display, style, and font size match the editor. Translated mode rejects missing translations rather than silently substituting source text.
5. Supply a stable `operation_id`, then poll `app_processing_status` with it. Use `app_processing_cancel` to cancel. Replaying the same accepted operation in the current app session returns its existing status/result; reusing its ID with changed inputs is rejected. This low-level operation registry does not survive an app restart. Inspect the output before restarting an interrupted run.
6. Omit `output_path` for an app-library preview, or supply a new absolute `.mp4` path in the agent allowed directories. Existing files are refused. The final result includes the video, stored SRT, source intervals, geometry, subtitle render specification, and zero Stage5 inference credits consumed. Finished agent renders appear in the Highlights preview/download UI.

These selection and rendering tools do not invoke a model, upload, or publish. `app_start_summary` remains a separate model-powered operation and may consume credits. Review the actual rendered clip before any upload or publication.

For Korean Shorts, LineBox uses bold Korean typography, compact tracking, rounded dark line backgrounds, balanced wrapping, and a stable position above the bottom app controls. Start around base size 35 for a 1080×1920 clip and inspect the longest caption at phone size. Check faces, demonstrations, and right-side controls before publishing; source framing and caption length can still require a different selection or font size.


## Edited portrait Shorts

A good Short needs an editorial choice, speaker-aware composition, and caption rhythm. Static landscape video on a tall canvas is often a poor fit for interviews. Inspect the source shots before selecting a crop; a reaction cut can change which speaker is on screen for less than a second.

Use **Style this Short / Edit framing & captions** on a highlight card. The editor shows a portrait preview of the actual source, a clip-relative playhead, horizontal/vertical focus and zoom, shot splitting/joining, a speaker/topic label, and timed caption phrases with an emphasized word or phrase. Save the edit, then render in Shorts Reframe. The preview and export share the typography: large bold Korean-capable text, lime emphasis, dark outline/shadow, a safe bottom/right inset, and a short restrained entrance. The regular subtitle style/size controls apply to plain clips; this editorial treatment has its own fixed responsive typography.

MCP exposes the same saved edit through the optional `editorial` field of `app_highlights_set`:

```json
{
  "label": "폴 그레이엄 인터뷰",
  "shots": [{ "start": 0, "end": 4, "centerX": 0.64, "centerY": 0.48, "zoom": 1.1 }],
  "captions": [{ "start": 0, "end": 4, "text": "먼저 아이디어를\n떠올려야 하잖아요", "emphasis": "아이디어" }]
}
```

All edit times are relative to the selected highlight. Shots must cover its complete duration, in order, without gaps or overlaps. Centers are normalized to the original source; zoom is 1–2.5. Captions cannot overlap, have at most two short lines, and emphasis must occur literally in the caption. Preserve the speaker's meaning and qualifications. Phrase timing is authored from the speech/saved word timings; it is not automatically generated Korean word alignment.

Editorial Shorts currently render one saved highlight at a time with `vertical_reframe`. Original and translated source cues are retained in the subtitle library; the separate edit remains in saved transcript analysis and is included in the render result. Source-caption edits invalidate the saved edit until it is reviewed and saved again. Framing/caption edits invalidate cached previews. Ordinary multi-highlight montages remain available without an editorial plan.

Review the exported video at phone size and at each camera cut. Check face/headroom, caption clipping, emphasis timing, the first audible word, the final complete thought, and source/translation attribution. A successful encode alone is not a quality check.
