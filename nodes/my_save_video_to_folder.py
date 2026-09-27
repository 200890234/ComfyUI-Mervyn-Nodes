"""My Save Video to Folder: 把 VIDEO 保存到任意目录。

行为对齐 ComfyUI-Get-Random-File 的 "Save Video to Folder":
- 目标目录任意(绝对路径), 不存在自动创建
- 使用 ComfyUI 自带 writer(VideoInput.save_to): 流兼容时直接复制, 仅格式/编码器/crf
  需要时才重新编码
- 文件名 stock 风格: <prefix>_00001_.<ext>, 计数器递增, 永不覆盖
- prefix 支持 %width% %height% %year% 等变量
- 输出: video(原样透传) + saved_path(完整路径); 节点内展示保存结果
"""

import os
import time

_CONTAINER_EXTENSIONS = {"auto": "mp4", "mp4": "mp4"}


def _resolve_folder(path_str: str) -> str:
    """任意绝对目录, 不存在则创建; 去掉复制路径常见的首尾引号。"""
    raw = (path_str or "").strip().strip('"').strip("'")
    if not raw:
        raise ValueError(
            "no destination folder set - put any absolute path in 'folder_path' "
            "(e.g. D:/videos/out)"
        )
    folder = os.path.abspath(os.path.expanduser(raw))
    os.makedirs(folder, exist_ok=True)
    return folder


def _expand_vars(text: str, width: int = 0, height: int = 0) -> str:
    """stock get_save_image_path 支持的前缀变量。"""
    if "%" not in text:
        return text
    now = time.localtime()
    for var, val in (
        ("%width%", str(width)), ("%height%", str(height)),
        ("%year%", str(now.tm_year)), ("%month%", f"{now.tm_mon:02d}"),
        ("%day%", f"{now.tm_mday:02d}"), ("%hour%", f"{now.tm_hour:02d}"),
        ("%minute%", f"{now.tm_min:02d}"), ("%second%", f"{now.tm_sec:02d}"),
    ):
        text = text.replace(var, val)
    return text


def _next_counter(folder: str, filename: str) -> int:
    """stock 计数器: 已有 '<filename>_<数字>_' 的最大值 + 1。"""
    stem = filename + "_"
    best = 0
    try:
        entries = os.listdir(folder)
    except OSError:
        return 1
    for entry in entries:
        if os.path.normcase(entry[: len(stem)]) != os.path.normcase(stem):
            continue
        rest = entry[len(stem):]
        digits = rest.split("_", 1)[0]
        if digits.isdigit() and len(digits) == 5:
            best = max(best, int(digits))
    return best + 1


def _format_options() -> list:
    try:
        from comfy_api.latest import Types
        return Types.VideoContainer.as_input()
    except Exception:
        return ["auto", "mp4"]


def _codec_options() -> list:
    try:
        from comfy_api.latest import Types
        return Types.VideoCodec.as_input()
    except Exception:
        return ["auto", "h264"]


def _as_container(name: str):
    try:
        from comfy_api.latest import Types
        return Types.VideoContainer(name)
    except Exception:
        return name


def _as_codec(name: str):
    try:
        from comfy_api.latest import Types
        return Types.VideoCodec(name)
    except Exception:
        return name


class MySaveVideoToFolder:
    """把 VIDEO 保存到任意目录, 输出保存路径。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video": ("VIDEO", {
                    "tooltip": "The video to save (any LoadVideo-style VIDEO output).",
                }),
                "folder_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Absolute destination folder - ANY folder on this computer, created if missing.",
                }),
                "filename_prefix": ("STRING", {
                    "default": "MyVideo",
                    "tooltip": "File prefix. Supports %width% %height% %year% %month% %day% %hour% %minute% %second%. A _00001_ counter is appended, files are never overwritten.",
                }),
            },
            "optional": {
                "format": (_format_options(), {
                    "tooltip": "auto keeps the source container (saved as .mp4).",
                }),
                "codec": (_codec_options(), {
                    "tooltip": "auto copies the stream when compatible; h264 forces a re-encode.",
                }),
                "crf": ("INT", {
                    "default": -1,
                    "min": -1,
                    "max": 51,
                    "tooltip": "Quality for re-encoding (lower = better/bigger). -1 lets ComfyUI decide; setting it forces a re-encode.",
                }),
                "preview": ("BOOLEAN", {
                    "default": False,
                    "label_on": "on",
                    "label_off": "off",
                    "tooltip": "Show an inline video preview of the saved file on the node",
                }),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("VIDEO", "STRING")
    RETURN_NAMES = ("video", "saved_path")
    OUTPUT_TOOLTIPS = (
        "The input video, passed through unchanged",
        "Full path of the saved file",
    )
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "my"
    DESCRIPTION = (
        "Saves the input video to ANY folder on this computer using ComfyUI's own writer - "
        "streams are copied when compatible, re-encoded only when format/codec/crf require it. "
        "A stock-style counter keeps files from being overwritten."
    )

    @classmethod
    def VALIDATE_INPUTS(cls, folder_path):
        # 出队前校验: 目录为空立刻报错, 而不是等生成跑完才失败
        if not (folder_path or "").strip().strip('"').strip("'"):
            return "no destination folder set - fill in folder_path (e.g. D:/videos/out)"
        return True

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")  # 每次都执行(避免同参数被缓存跳过)

    def save(self, video, folder_path, filename_prefix, format="auto", codec="auto",
             crf=-1, preview=False, prompt=None, extra_pnginfo=None):
        folder = _resolve_folder(folder_path)
        try:
            width, height = video.get_dimensions()
        except Exception:
            width, height = 0, 0

        prefix = _expand_vars((filename_prefix or "").strip() or "MyVideo", width, height)
        for ch in '\\/:*?"<>|':
            prefix = prefix.replace(ch, "")
        prefix = prefix.strip() or "MyVideo"

        counter = _next_counter(folder, prefix)
        ext = _CONTAINER_EXTENSIONS.get(format, "mp4")
        target = os.path.join(folder, f"{prefix}_{counter:05}_.{ext}")

        video.save_to(
            target,
            format=_as_container(format),
            codec=_as_codec(codec),
            metadata=dict(extra_pnginfo) if extra_pnginfo else None,
            crf=None if crf is None or crf < 0 else crf,
        )

        try:
            size_mb = os.path.getsize(target) / 1024 / 1024
        except OSError:
            size_mb = 0.0
        info = f"saved: {target} ({width}x{height}, {size_mb:.1f} MB)"

        # ui 回传: 节点上直接展示保存结果
        return {"ui": {"mervyn_save_video": [target, info]},
                "result": (video, target)}

