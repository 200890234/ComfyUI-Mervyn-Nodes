# ComfyUI-Mervyn-Nodes

**English** | [中文](README.zh-CN.md)

Mervyn's collection of ComfyUI custom nodes.

## Installation

Clone it into ComfyUI's custom nodes directory:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/200890234/ComfyUI-Mervyn-Nodes.git
```

Once it is published to the Comfy Registry you can also install it by searching for `ComfyUI-Mervyn-Nodes` in ComfyUI Manager.

## Node list

| Node | Description |
|------|-------------|
| `My Load Video Under Path` | Browse any directory (navigating into subfolders) and load the selected video, with an in-node preview |
| `My Load Image Under Path` | Pick an image from any directory (three-part selector + column browse panel + inline preview + size readout). Outputs IMAGE + file_path; right-click Open/Save Image |
| `My Mask Editor` | Paint a mask on an image in any directory (paint/erase/size/softness/undo/Fill/Invert/Clear). The mask is saved next to the image as `<name>_mask.png`. Outputs MASK |
| `My Media Browser` | In-node grid browser for images/videos/subfolders in any directory (autoplaying video tiles + breadcrumbs + paging + favourite folders). Selecting outputs IMAGE/VIDEO |
| `My Save Image` | Save an IMAGE to any directory, skipping or overwriting on name clashes. The result is shown on the node |
| `My Save Video to Folder` | Save a VIDEO to any directory (ComfyUI's own writer, stream-copies when compatible). The filename counter never overwrites |
| `My Move File` | Move one or more files to any directory, skipping or overwriting on name clashes. The result is shown on the node. Also accepts VHS "Video Combine" Filenames output directly |
| `My Python Code` | Run a custom Python snippet (V1: fixed input slots) that transforms numeric/string inputs and returns results |
| `My Python Code V2` | Same sandbox and outputs, but built on the V3 API with auto-growing input slots (`var_0`, `var_1`, ...) |
| `My Example Node` | Example node (placeholder, safe to delete) |

## My Media Browser

- `folder`: any root directory. Once filled in, the grid expands inside the node (no popup needed)
- Grid: image thumbnails + autoplaying muted looping video tiles (the comfyui-browser experience). Breadcrumbs (`›` separated) step into subfolders level by level (only the current level is listed; entering updates `folder`). Cursor paging (20 items initially + Load more)
- Favourites: add a folder to favourites from the favourites bar (stored globally in localStorage, shared across workflows); click a favourite to switch instantly, ✕ to remove
- Click an image/video → selected (tile highlighted) + lightbox preview (videos have a seek bar, streamed via Range; close with ✕ / click outside / Esc)
- Outputs: `selected_file` (full path) + `image` (IMAGE when an image is selected, otherwise None) + `video` (VIDEO when a video is selected, otherwise None)
- The `selected_file` input can be connected; `folder` also accepts a full media path to skip browsing and load directly

## My Load Image Under Path

- `folder`: any image directory; three-part selector (◀ filename ▶) — the arrows cycle within the same directory, clicking the middle opens the column browse panel (entering a subfolder updates `folder`)
- Selecting previews the image inline (height follows the image aspect ratio; the read-only `size` field shows the original width/height) — visible without running the workflow
- Outputs: `image` (1,H,W,3, EXIF orientation applied) + `file_path` (absolute path of the selected file; feed it into `My Mask Editor`)
- Design note: selection uses an absolute path and does no input-directory bridging upload (the any-directory premise). **This node does not output MASK** — the single source of truth for masks is `My Mask Editor` (connect this node's `file_path`, paint, and take its `mask` output), which avoids the same `<name>_mask.png` being exposed by two outputs
- Because it uses absolute paths, this node does **not** offer the core `Open in Mask Editor` menu item (that feature depends on the input directory — see the limitation note in the `My Mask Editor` section below)

## My Mask Editor

- `file_path`: the image to paint on (connect `My Load Image Under Path`'s `file_path` output, or type an absolute path)
- In-node canvas: brush/eraser, size, opacity, softness, Undo/Redo, Fill, Invert, Clear
- Saving: auto-saved after each stroke (800 ms debounce) to `<name>_mask.png` next to the image (white = selected, black = excluded)
- Outputs: `mask` (1,H,W, 1 = selected area; all zeros when nothing has been painted) + `mask_path` (the mask file actually in use; empty when none exists)
- Used with `My Load Image Under Path`: Load Image supplies `file_path` → paint here → take the `mask` output (loading is loading, masking is masking)
- **Design note (limitation)**: the core MaskEditor popup (right-click `Open in Mask Editor`) **cannot work with arbitrary directories** — loading goes through `/view` (rejects absolute paths and subfolders outside `input`) and saving goes through `/upload/mask` (forced back into `input/clipspace/`). Mask editing in this pack therefore **has to be a standalone node**: it cannot be embedded into `My Load Image Under Path`, and it cannot reuse the core popup the way Pixaroma does (that approach requires the image to live inside ComfyUI's input directory)

## My Save Video to Folder

Behaviour matches similar community nodes (the Save Video to Folder in ChrisColeTech/ComfyUI-Get-Random-File):

- `video`: accepts a VIDEO (e.g. the output of `My Load Video Under Path`)
- `folder_path`: any absolute directory, created if missing (surrounding quotes stripped, `~` supported)
- `filename_prefix`: supports `%width% %height% %year% %month% %day% %hour% %minute% %second%`; a stock-style counter `_00001_` is appended and existing files are **never overwritten**
- `format` / `codec` / `crf` (optional): uses ComfyUI's own writer — **stream-copied when the format is compatible** (fast and lossless), re-encoded only when the format/codec/crf requires it; `crf = -1` lets ComfyUI decide, 0-51 forces a re-encode
- Outputs: `video` (passed through unchanged, handy for chaining) + `saved_path` (full path of the saved file)
- The saved path and a summary (resolution / size) are shown on the node right after execution

## My Save Image / My Move File

Shared behaviour:

- `directory`: any absolute path (not limited to `output`); created if missing
- `overwrite`: defaults to False; when False, a name clash skips that file (nothing is written/moved); True overwrites
- `status` / `moved_path` outputs: per-file `saved/moved: <path>` or `skipped (already exists): <path>`; `moved_path` holds the full paths actually written (skipped files are not included)
- Both values are rendered on the node (updated right after execution, saved with the workflow), so no preview node is needed

`My Save Image`: takes an IMAGE; a single image is saved as `prefix.png`, batches increment from `prefix_00001.png`. `filename_prefix` also supports `%width% %height% %year% %month% %day% %hour% %minute% %second%` (aligned with `My Save Video to Folder`).

`My Move File`: takes file paths — `file_paths` accepts multi-line text (one path per line) or a list of paths from upstream; missing/empty paths are marked `error` in `status` and skipped without aborting the batch.

Optional `filenames` input (type `VHS_FILENAMES`): connect VHS "Video Combine"'s Filenames output and its rendered files are moved together with `file_paths` (duplicate paths are de-duplicated). This replaces `JDCN_VHSFileMover` — you can find it by searching "move file" instead of remembering that name. When VHS is not installed the socket simply stays empty and the other inputs are unaffected.

## My Python Code / My Python Code V2

Both nodes share the exact same sandbox and execution semantics (`nodes/my_python_code_core.py`), so a snippet behaves identically in either one. They differ only in the input slots:

| | My Python Code (V1) | My Python Code V2 |
|---|---|---|
| Input slots | fixed: `string_value` / `int_value` / `float_value` / `boolean_value` / `any1` / `any2` | the same four named ones, plus **auto-growing** slots (up to 20) |
| Slot variable names | `any1` / `any2` | `var_0`, `var_1`, ... in slot order (any type, so IMAGE/LATENT can be connected) |
| API | classic | V3 (`io.ComfyNode` + `io.Autogrow`) |
| Outputs | `string` / `int` / `float` / `boolean` / `any` | identical |

They coexist: deleting either one does not affect the other (the shared code lives in its own module).

- Inside `python_code` read the inputs by name; assign to `result_string` / `result_int` / `result_float` / `result_boolean` / `result_any` to fill the matching output. **Unassigned results fall back to a per-port zero value**: `""` / `0` / `0.0` / `False` (`any` stays `None`). Explicitly assigned values pass through untouched.
- Built-ins are whitelisted (types, `len`/`sum`/`sorted`/`min`/`max`/`all`/`any`/`zip`/`enumerate`/`chr`/`ord`/`pow`/`hex`/`bin`/..., `getattr`/`isinstance`/`type`, ...). `import` / `global` / `nonlocal` are rejected.
- These standard-library modules are **pre-bound** — use them directly, no import needed: `math`, `random`, `json`, `re`, `datetime`, `itertools`, `functools`, `string`. Example: `result_string = json.dumps({"n": math.floor(float_value)})`
- `import` statements stay blocked. The only `__import__` present is a guarded one whose sole purpose is to let the standard library perform its internal lazy imports (`datetime.strftime` / `date.today` need `time`, `strptime` needs `_strptime`); `os` / `sys` / `subprocess` and friends are still refused.
- `now()` is a convenience time source: `now()` returns the current local time as `%Y%m%d_%H%M%S` (e.g. `20261007_233437`) and `now("%Y")` accepts any `strftime` format. `datetime.datetime.now().strftime(...)` works as well.
- Caching: when a snippet uses a non-deterministic entry point (`now()`, `random.*`, `datetime.now()`, ...) the node forces a re-run every time. Otherwise ComfyUI would cache the first value and every batch run would produce the same timestamp/random number. Snippets without those entry points stay cacheable.
- Scope note: the sandbox guards against accidents, not adversarial code.
- V2 output note: the core V3 API only offers Autogrow for **inputs** (there is no `Autogrow.Output`, and no `DynamicOutput` implementation), so V2 keeps the same five fixed outputs. Dynamic output slots would need a custom front-end widget — out of scope for now.

## My Load Video Under Path

- `path`: root directory path (e.g. `D:/videos`); refreshes automatically once entered. A full video file path is also accepted (skips browsing and loads directly)
- `Browse`: column browse panel where subfolders expand to the right level by level (Finder style); each level lists its subfolders and videos, and clicking a video selects it; `..` goes up one level, clicking outside or pressing Esc closes the panel
- `video_file`: the selected video file (full path); every input (path / video_file / preview / start_time / duration) can be converted into an input port driven by upstream nodes
- `start_time` / `duration`: trim range in seconds; 0 means from the start / until the end
- `skip_first_frames` / `frame_load_cap`: skip the first N frames / load at most N frames (0 = no limit)
- `select_every_nth`: keep 1 frame out of every N (0 = keep all); the effective frame rate becomes force_rate/N and the output duration is unchanged
- `force_rate`: resample to the given frame rate (duplicating/dropping frames as needed), 0 = native
- `custom_width` / `custom_height`: resize on load; setting only one side keeps the aspect ratio
- When every frame-control parameter is at its default the node stays lazy (no decoding); enabling any of them narrows the window and decodes within a bound, and the output VIDEO reflects the resampled/resized result
- `preview`: toggle; when on, the node plays inline **only the segment the run actually consumes**
  - The window is `start_time` / `duration` first, then narrowed by `skip_first_frames` / `frame_load_cap` / `select_every_nth` / `force_rate` (identical formula to execution); the preview plays exactly that range, looping
  - Editing any of those parameters recomputes the range and replays from its start (250 ms debounce)
  - A badge in the bottom-left corner shows the active range plus the resulting frame count / frame rate, so you can confirm the parameters took effect
  - Implementation: `src` carries a media fragment `#t=start,end` so the engine bounds playback, with a frame-level watchdog as a fallback; changing only `#t=` on the same file does not re-download it
  - `custom_width` / `custom_height` scaling and `select_every_nth` judder are not visible in the picture (the preview plays at source frame rate); if the fps probe fails it degrades to a plain time range

**Outputs**

| Port | Type | Description |
|------|------|-------------|
| `video` | VIDEO | Video object (with audio track); use the core `GetVideoComponents` node when you need separate frames/audio |
| `file_path` | STRING | Full path of the selected video |
| `audio` | AUDIO | Audio track (float waveform, passable between audio nodes); empty when the file has no audio |
| `video_frames` | IMAGE | Decoded frame batch (N,H,W,3), connectable to image nodes; matches the VIDEO output when frame-control parameters are used |
| `frame_count` | INT | Total frame count |
| `fps` | FLOAT | Frame rate |
| `width` | INT | Width in pixels |
| `height` | INT | Height in pixels |
| `duration` | FLOAT | Duration in seconds (adjusted for the trim range) |

> Note: the directory-browsing and video-preview APIs read arbitrary paths on this machine. They are intended for local ComfyUI use only — do not enable them on an instance exposed to the public internet.

**Backend routes used by the frontend**

| Route | Description |
|-------|-------------|
| `GET /mervyn/listdir?root=&rel=` | Lists the subfolders and video files of one directory level |
| `GET /mervyn/video?path=` | Streams the video (Range supported; the frontend `#t=` fragment playback relies on it) |
| `GET /mervyn/videoinfo?path=` | Header-only probe returning `fps` / `duration` / `width` / `height` / `frame_count_est` (milliseconds, cached by mtime+size for the most recent file); the frontend uses it to derive the exact trim window |

## Development

- `__init__.py` — plugin entry point, maintains `NODE_CLASS_MAPPINGS` and `WEB_DIRECTORY`
- `nodes/` — node implementations, split into modules by feature
- `nodes/example.py` — example node, modify or delete it freely
- `web/js/` — frontend extensions (dynamic dropdowns, in-node previews and other UI logic)
- `tests/smoke_test.py` — smoke test that needs no running server: `conda run -n ComfyuiP python tests/smoke_test.py`
- `pyproject.toml` — Comfy Registry publishing metadata

Node development docs: https://docs.comfy.org/essentials/custom-node-basics
