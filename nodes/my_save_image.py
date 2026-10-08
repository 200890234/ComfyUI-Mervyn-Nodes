"""My Save Image: 保存 IMAGE 到任意目录(不限于 output), 支持重名跳过/覆盖。"""

import os
import time

import numpy as np
import torch
from PIL import Image


def _expand_vars(text: str, width: int = 0, height: int = 0) -> str:
    """stock 风格的前缀变量(与 My Save Video to Folder 对齐)。

    支持 %width% %height% %year% %month% %day% %hour% %minute% %second%。
    """
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


class MySaveImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "directory": ("STRING", {"default": ""}),
                "filename_prefix": ("STRING", {
                    "default": "MyImage",
                    "tooltip": "File prefix. Supports %width% %height% %year% %month% %day% %hour% %minute% %second%.",
                }),
                "overwrite": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("status", "moved_path")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "my"
    DESCRIPTION = (
        "Save images to any directory with overwrite/conflict handling. "
        "filename_prefix supports %width% %height% %year% %month% %day% %hour% %minute% %second%."
    )

    def save(self, images, directory, filename_prefix, overwrite):
        directory = (directory or "").strip().strip('"').strip("'")
        if not directory:
            raise ValueError("directory is empty")
        directory = os.path.abspath(os.path.expanduser(directory))
        os.makedirs(directory, exist_ok=True)

        prefix = (filename_prefix or "").strip() or "MyImage"
        # %year% 等变量先展开(宽度/高度取自本批图像), 再清掉文件名非法字符
        prefix = _expand_vars(prefix, int(images.shape[2]), int(images.shape[1]))
        for ch in '\\/:*?"<>|':
            prefix = prefix.replace(ch, "")
        prefix = prefix.strip() or "MyImage"

        results, paths = [], []
        for i in range(int(images.shape[0])):
            arr = (images[i].clamp(0, 1).cpu().numpy() * 255).round().astype("uint8")
            name = f"{prefix}.png" if images.shape[0] == 1 else f"{prefix}_{i + 1:05}.png"
            target = os.path.join(directory, name)
            if os.path.exists(target) and not overwrite:
                results.append(f"skipped (already exists): {target}")
                continue
            Image.fromarray(arr, mode="RGB").save(target, format="PNG")
            results.append(f"saved: {target}")
            paths.append(target)

        status = " | ".join(results) if results else "no images to save"
        moved = "; ".join(paths)
        # ui 数据回传前端, 在节点上直接展示 status 与 moved path
        return {"ui": {"mervyn_save_image": [status, moved]},
                "result": (status, moved)}


