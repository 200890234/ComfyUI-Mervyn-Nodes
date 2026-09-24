"""My Load Video Under Path: 浏览任意目录并加载选中的视频文件。

后端职责:
- 注册两个 API 路由供前端扩展调用:
    GET /mervyn/listdir  列出某层目录的子目录与视频文件
    GET /mervyn/video    流式返回视频文件(支持 Range, 供节点内预览播放)
- 节点执行: 校验选中的视频路径, 返回 VIDEO 对象与完整路径字符串。

目录导航在前端扩展 web/js/my_load_video_under_path.js 中实现为
列式浏览面板(子目录逐级向右展开), 当前相对路径存于节点属性
mervyn_rel, 随工作流一起保存/恢复。
"""

import mimetypes
import os

import numpy as np
import torch

# ComfyUI 官方环境自带 comfy_api/av(核心 LoadVideo 同款), 不进 requirements.txt
from comfy_api.latest import InputImpl
from comfy_api.latest._input_impl.video_types import AudioInput

VIDEO_EXTS = {
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".wmv",
    ".mpg", ".mpeg", ".flv", ".ts", ".3gp", ".gif",
}

# 单次请求最多返回的字节数, 避免浏览器一次大 Range 把文件整个读进内存
_MAX_CHUNK = 8 * 1024 * 1024


def _clean_root(root: str) -> str:
    root = (root or "").strip().strip('"').strip("'")
    if not root:
        raise ValueError("path is empty")
    root = os.path.abspath(os.path.normpath(root))
    if not os.path.isdir(root):
        raise NotADirectoryError(f"not a directory: {root}")
    return root


def _clean_rel(root: str, rel: str) -> str:
    """规范化相对子路径, 并防止越出根目录。"""
    rel = (rel or "").replace("\\", "/").strip("/")
    if rel in (".", ".."):
        rel = ""
    if rel:
        current = os.path.normpath(os.path.join(root, rel))
        try:
            inside = os.path.commonpath(
                [os.path.normcase(root), os.path.normcase(current)]
            ) == os.path.normcase(root)
        except ValueError:  # 不同盘符等情况
            inside = False
        if not inside:
            raise ValueError("subdirectory escapes the root path")
    return rel


def _scan(root: str, rel: str) -> dict:
    """列出 root/rel 下一层的子目录与视频文件(不含更深层级)。"""
    current = os.path.join(root, rel) if rel else root
    subdirs: list[str] = []
    videos: list[str] = []
    try:
        with os.scandir(current) as it:
            entries = sorted(it, key=lambda e: e.name.lower())
    except (PermissionError, FileNotFoundError):
        entries = []
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            subdirs.append(entry.name)
        elif entry.is_file() and os.path.splitext(entry.name)[1].lower() in VIDEO_EXTS:
            videos.append(entry.name)
    return {"subdirs": subdirs, "videos": videos}


def _extract_audio(path: str, start_time: float, duration: float):
    """用 PyAV 只解码音频轨(不解画面), 按 trim 窗口切片。

    无音频轨或解码失败时返回 None(下游按"无音频"处理, 不阻塞执行)。
    """
    try:
        import av
    except ImportError:  # 理论不可达: ComfyUI 官方依赖里有 av
        return None

    audio = None
    try:
        with av.open(path) as container:
            streams = [s for s in container.streams if s.type == "audio"]
            if not streams:
                return None
            stream = streams[0]
            stream.thread_type = "AUTO"
            rate = stream.sample_rate or 48000
            chunks: list[np.ndarray] = []
            trim_end = (start_time + duration) if duration > 0 else None
            decode_start = max(0.0, start_time)
            for frame in container.decode(stream):
                frame_ts = float(frame.pts * stream.time_base) if frame.pts is not None else 0.0
                frame_end = frame_ts + float(frame.samples) / rate
                if frame_end <= start_time:
                    continue
                if trim_end is not None and frame_ts >= trim_end:
                    break
                arr = frame.to_ndarray()  # (channels, samples), fltp 下为 float32
                if arr.dtype != np.float32:
                    arr = arr.astype(np.float32) / 32768.0 if arr.dtype.kind == "i" else arr.astype(np.float32)
                if frame_ts < decode_start:
                    offset = int(round((decode_start - frame_ts) * rate))
                    arr = arr[:, offset:]
                if trim_end is not None and frame_end > trim_end:
                    keep = int(round((trim_end - frame_ts) * rate))
                    arr = arr[:, :keep]
                if arr.shape[1] > 0:
                    chunks.append(arr)
            if not chunks:
                return None
            # 声道数可能中途变化, 统一为最大声道数
            max_ch = max(c.shape[0] for c in chunks)
            chunks = [
                np.repeat(c, max_ch // c.shape[0], axis=0)
                if c.shape[0] < max_ch and max_ch % c.shape[0] == 0
                else c
                for c in chunks
            ]
            if any(c.shape[0] != max_ch for c in chunks):
                return None
            waveform = np.concatenate(chunks, axis=1)  # (channels, samples)
            if waveform.shape[0] == 1:
                waveform = np.repeat(waveform, 2, axis=0)  # 单声道转双声道, ComfyUI 惯例
            tensor = torch.from_numpy(waveform).unsqueeze(0)  # (1, channels, samples)
            audio = AudioInput({"waveform": tensor, "sample_rate": rate})
    except Exception:
        return None
    return audio


def _register_routes() -> None:
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:  # 非 ComfyUI 环境(如单测)下不注册
        return
    # 服务器未实例化时没有 instance 属性, 用 getattr 防御
    if getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes

    @routes.get("/mervyn/listdir")
    async def listdir(request):
        try:
            root = _clean_root(request.query.get("root", ""))
            rel = _clean_rel(root, request.query.get("rel", ""))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)
        data = _scan(root, rel)
        data["root"] = root
        data["rel"] = rel
        return web.json_response(data)

    @routes.get("/mervyn/video")
    async def video(request):
        raw = (request.query.get("path") or "").strip().strip('"').strip("'")
        path = os.path.abspath(os.path.normpath(raw)) if raw else ""
        if (
            not path
            or os.path.splitext(path)[1].lower() not in VIDEO_EXTS
            or not os.path.isfile(path)
        ):
            return web.json_response({"error": f"invalid video file: {raw}"}, status=400)

        size = os.path.getsize(path)
        if size == 0:
            return web.json_response({"error": "empty file"}, status=404)

        start, end, status = 0, size - 1, 200
        range_header = request.headers.get("Range", "")
        if range_header.startswith("bytes="):
            spec = range_header.split("=", 1)[1].split(",", 1)[0]
            a, _, b = spec.partition("-")
            try:
                if a:
                    start = int(a)
                    if b:
                        end = min(int(b), size - 1)
                elif b:  # 后缀形式: bytes=-N
                    start = max(0, size - int(b))
                status = 206
            except ValueError:
                start, end, status = 0, size - 1, 200

        start = min(start, size - 1)
        end = min(end, start + _MAX_CHUNK - 1, size - 1)
        length = end - start + 1

        headers = {
            "Content-Type": mimetypes.guess_type(path)[0] or "application/octet-stream",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Cache-Control": "no-store",
        }
        if status == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"

        with open(path, "rb") as f:
            f.seek(start)
            body = f.read(length)
        return web.Response(status=status, body=body, headers=headers)


_register_routes()


class MyLoadVideoUnderPath:
    """浏览目录并加载选中的视频文件, 输出完整元数据。"""

    OUTPUT_TOOLTIPS = (
        "Video object (contains picture and audio track)",
        "Full path of the selected video file",
        "Audio track (None if the file has no audio)",
        "Total frame count",
        "Frame rate in fps",
        "Video width in pixels",
        "Video height in pixels",
        "Duration in seconds",
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Root directory to browse, e.g. D:/videos. Also accepted as a direct video file path.",
                }),
                "video_file": ([""], {
                    "tooltip": "Video file picked via the Browse panel (full path). Connectable to override.",
                }),
                "preview": ("BOOLEAN", {
                    "default": False,
                    "label_on": "on",
                    "label_off": "off",
                    "tooltip": "Show an inline video preview on the node",
                }),
                "start_time": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "step": 0.01,
                    "tooltip": "Trim start in seconds; 0 = from the beginning",
                }),
                "duration": ("FLOAT", {
                    "default": 0.0,
                    "min": 0.0,
                    "step": 0.01,
                    "tooltip": "Trim length in seconds; 0 = until the end",
                }),
            },
        }

    RETURN_TYPES = ("VIDEO", "STRING", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT")
    RETURN_NAMES = ("video", "file_path", "audio", "frame_count", "fps", "width", "height", "duration")
    FUNCTION = "load_video"
    CATEGORY = "my"
    DESCRIPTION = (
        "Browse a directory (subdirectories included) and load the selected video. "
        "Outputs the VIDEO object (with audio) plus audio/ frame_count/fps/width/height/duration."
    )

    def load_video(self, path="", video_file="", preview=False, start_time=0.0, duration=0.0):
        file_path = (video_file or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            # 未选择文件时, 允许直接把完整视频路径填在 path 里
            file_path = (path or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            raise ValueError("no video file selected - set path and pick a file first")
        file_path = os.path.abspath(os.path.normpath(file_path))
        if os.path.splitext(file_path)[1].lower() not in VIDEO_EXTS:
            raise ValueError(f"not a video file: {file_path}")
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"video file not found: {file_path}")

        start = max(0.0, float(start_time or 0.0))
        length_in = float(duration) if duration and duration > 0 else 0
        video = InputImpl.VideoFromFile(file_path, start_time=start, duration=length_in)
        audio = _extract_audio(file_path, start, length_in)
        frame_rate = video.get_frame_rate()
        fps = float(frame_rate)
        width, height = video.get_dimensions()
        frame_count = video.get_frame_count()
        length = video.get_duration()
        return (video, file_path, audio, frame_count, fps, width, height, length)
