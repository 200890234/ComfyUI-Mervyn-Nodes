"""My Move File: 把传入的文件路径(单个或数组)移动到指定目录。

- 目标目录任意(自动创建)
- Overwrite=False 且目标重名时跳过该文件
- status / moved_path 通过 ui 回传前端, 节点上直接展示
"""

import os
import shutil


class MyMoveFile:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_paths": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "tooltip": "File path(s) to move: one per line, or a list from upstream.",
                }),
                "directory": ("STRING", {"default": ""}),
                "overwrite": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("status", "moved_path")
    OUTPUT_NODE = True
    FUNCTION = "move"
    CATEGORY = "my"
    DESCRIPTION = "Move one or more files to any directory with overwrite/conflict handling."

    def move(self, file_paths, directory, overwrite):
        if isinstance(file_paths, str):
            # 多行文本: 每行一个路径
            items = [line for line in file_paths.splitlines() if line.strip()]
        elif isinstance(file_paths, (list, tuple)):
            items = list(file_paths)
        else:
            items = [file_paths]

        directory = (directory or "").strip().strip('"').strip("'")
        if not directory:
            raise ValueError("directory is empty")
        directory = os.path.abspath(os.path.expanduser(directory))
        os.makedirs(directory, exist_ok=True)

        results, paths = [], []
        for raw in items:
            src = str(raw or "").strip().strip('"').strip("'")
            if not src:
                results.append("skipped (empty path)")
                continue
            src = os.path.abspath(os.path.normpath(src))
            if not os.path.isfile(src):
                results.append(f"error (not found): {src}")
                continue
            target = os.path.join(directory, os.path.basename(src))
            if os.path.exists(target) and not overwrite:
                results.append(f"skipped (already exists): {target}")
                continue
            shutil.move(src, target)
            results.append(f"moved: {target}")
            paths.append(target)

        status = " | ".join(results) if results else "no files to move"
        moved = "; ".join(paths)
        return {"ui": {"mervyn_move_file": [status, moved]},
                "result": (status, moved)}

