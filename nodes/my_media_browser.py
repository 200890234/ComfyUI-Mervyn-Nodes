"""My Media Browser: 网格浏览任意目录(图片/视频/子目录), 点选加载。

- 前端面板: 缩略图网格(视频自动静音循环播放) + 面包屑导航 + 游标分页
- 后端: /mervyn/listmedia 列目录(当前层), /mervyn/media 提供图片文件
- 输出: file_path + IMAGE(图片文件) / VIDEO(视频文件), 按类型二选一
"""

import os

import numpy as np
import torch
from PIL import Image, ImageOps

from comfy_api.latest import InputImpl

try:  # ComfyUI 内为包相对导入
    from .my_load_video_under_path import (
        VIDEO_EXTS,
        _clean_rel,
        _clean_root,
    )
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_load_video_under_path import (
        VIDEO_EXTS,
        _clean_rel,
        _clean_root,
    )

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def scan_media(root: str, rel: str) -> dict:
    """列出 root/rel 下一层的子目录/图片/视频(均不含更深层级)。"""
    current = os.path.join(root, rel) if rel else root
    subdirs, images, videos = [], [], []
    try:
        with os.scandir(current) as it:
            entries = sorted(it, key=lambda e: (not e.is_dir(), e.name.lower()))
    except (PermissionError, FileNotFoundError):
        entries = []
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            subdirs.append(entry.name)
            continue
        ext = os.path.splitext(entry.name)[1].lower()
        if ext in IMAGE_EXTS:
            images.append(entry.name)
        elif ext in VIDEO_EXTS:
            videos.append(entry.name)
    return {"subdirs": subdirs, "images": images, "videos": videos,
            "root": root, "rel": rel}


def _register_routes() -> None:
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:  # 非 ComfyUI 环境(如单测)下不注册
        return
    if getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes

    @routes.get("/mervyn/listmedia")
    async def listmedia(request):
        try:
            root = _clean_root(request.query.get("root", ""))
            rel = _clean_rel(root, request.query.get("rel", ""))
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)
        return web.json_response(scan_media(root, rel))

    @routes.get("/mervyn/media")
    async def media(request):
        import mimetypes
        raw = (request.query.get("path") or "").strip().strip('"').strip("'")
        path = os.path.abspath(os.path.normpath(raw)) if raw else ""
        if (
            not path
            or os.path.splitext(path)[1].lower() not in IMAGE_EXTS
            or not os.path.isfile(path)
        ):
            return web.json_response({"error": f"invalid image file: {raw}"}, status=400)
        ctype = mimetypes.guess_type(path)[0] or "image/png"
        with open(path, "rb") as f:
            body = f.read()
        return web.Response(body=body, content_type=ctype,
                            headers={"Cache-Control": "no-store"})


_register_routes()


class MyMediaBrowser:
    """浏览目录并加载选中的图片/视频文件。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Root directory to browse, e.g. D:/media. Also accepts a full media file path.",
                }),
                "selected_file": ("STRING", {
                    "default": "",
                    "tooltip": "Selected media file (written by the inline grid; connectable to override)",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "IMAGE", "VIDEO")
    RETURN_NAMES = ("file_path", "image", "video")
    OUTPUT_TOOLTIPS = (
        "Full path of the selected file",
        "Decoded image when an image file is selected, otherwise None",
        "Video object when a video file is selected, otherwise None",
    )
    FUNCTION = "run"
    CATEGORY = "my"
    DESCRIPTION = "Browse a directory grid and load the selected image/video."

    def run(self, folder="", selected_file=""):
        file_path = (selected_file or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            # 未选择文件时, 允许 folder 直填完整媒体路径
            file_path = (folder or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            raise ValueError("no media file selected - set path and pick a file first")
        file_path = os.path.abspath(os.path.normpath(file_path))
        ext = os.path.splitext(file_path)[1].lower()
        if not os.path.isfile(file_path):
            raise FileNotFoundError(f"file not found: {file_path}")

        if ext in IMAGE_EXTS:
            img = Image.open(file_path)
            img = ImageOps.exif_transpose(img).convert("RGB")
            arr = np.array(img).astype(np.float32) / 255.0
            return (file_path, torch.from_numpy(arr)[None,], None)
        if ext in VIDEO_EXTS:
            video = InputImpl.VideoFromFile(file_path)
            return (file_path, None, video)
        raise ValueError(f"unsupported media type: {file_path}")

