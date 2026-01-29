# Visual regression harness (FX panels)

This folder contains the scripts used to generate pixel-perfect screenshots of each ReaImGui panel and compare them against golden baselines.

## Render (golden/current)

Run the `render_panels.lua` ReaScript **inside REAPER** with ReaImGui + js_ReaScriptAPI installed. The script will:

1. Open each FX panel in a deterministic size.
2. Capture a window screenshot using `JS_Window_ScreenShot`.
3. Save PNGs into `tests/visual/current/<panel>/<size>.png`.

```sh
reaper (run tests/visual/render_panels.lua as a ReaScript)
```

> NOTE: If `JS_Window_ScreenShot` is not available, install the js_ReaScriptAPI extension. The script will warn and skip captures.

## Compare

```sh
python3 tests/visual/compare_images.py --golden tests/visual/golden --current tests/visual/current
```

The comparison reports:
- max per-channel delta
- % of pixels that differ

## Updating golden baselines

When intentional UI changes are made, replace the golden images by copying `current` → `golden` and committing the new PNGs.
