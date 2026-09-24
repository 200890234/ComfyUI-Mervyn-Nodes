"""My Save Image: 保存 IMAGE 到任意目录(不限于 output), 支持重名跳过/覆盖。"""

import os

import numpy as np
import torch
from PIL import Image


class MySaveImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "directory": ("STRING", {"default": ""}),
                "filename_prefix": ("STRING", {"default": "MyImage"}),
                "overwrite": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("status", "moved_path")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "my"
    DESCRIPTION = "Save images to any directory with overwrite/conflict handling."

    def save(self, images, directory, filename_prefix, overwrite):
        directory = (directory or "").strip().strip('"').strip("'")
        if not directory:
            raise ValueError("directory is empty")
        directory = os.path.abspath(os.path.expanduser(directory))
        os.makedirs(directory, exist_ok=True)

        prefix = (filename_prefix or "").strip() or "MyImage"
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


