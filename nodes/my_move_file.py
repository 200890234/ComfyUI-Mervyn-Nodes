"""My Move File: 把传入的文件路径(单个或数组)移动到指定目录。

- 目标目录任意(自动创建)
- Overwrite=False 且目标重名时跳过该文件
- status / moved_path 通过 ui 回传前端, 节点上直接展示
- 可选输入 filenames(VHS_FILENAMES): 直接接 VHS Video Combine 的 Filenames 输出,
  其产物与 file_paths 一起移动(等价于 JDCN_VHSFileMover, 但按 "move file" 即可搜到)
"""

import os
import shutil


def _iter_vhs_paths(value):
    """从 VHS_FILENAMES payload 中稳健地取出所有文件路径。

    VHS Video Combine 的规范形态是 (save_output: bool, [paths...]);
    多次/批量组合时可能嵌套成多层, 故递归展开。
    布尔开关、None 等非路径标量会被忽略。
    """
    if value is None:
        return
    if isinstance(value, bool):
        return  # save_output 开关, 不是路径
    if isinstance(value, str):
        if value.strip():
            yield value.strip()
        return
    if isinstance(value, dict):
        for v in value.values():
            yield from _iter_vhs_paths(v)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _iter_vhs_paths(item)


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
            "optional": {
                # 可选依赖 VHS: 未安装时该类型无任何输出端, 插槽空置, 不影响其他输入
                "filenames": ("VHS_FILENAMES", {
                    "tooltip": "Optional: VHS 'Video Combine' Filenames output. Its files are moved along with file_paths.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("status", "moved_path")
    OUTPUT_NODE = True
    FUNCTION = "move"
    CATEGORY = "my"
    DESCRIPTION = (
        "Move one or more files to any directory with overwrite/conflict handling. "
        "Also accepts VHS Filenames (Video Combine / Save Video output) directly."
    )

    def move(self, file_paths, directory, overwrite, filenames=None):
        if isinstance(file_paths, str):
            # 多行文本: 每行一个路径
            items = [line for line in file_paths.splitlines() if line.strip()]
        elif isinstance(file_paths, (list, tuple)):
            items = list(file_paths)
        else:
            items = [file_paths]

        # VHS_FILENAMES: VHS Video Combine 产出的文件一并移动
        if filenames is not None:
            items.extend(_iter_vhs_paths(filenames))

        # 同一路径可能同时来自 file_paths 与 filenames -> 去重并保持顺序
        seen, unique = set(), []
        for it in items:
            key = str(it)
            if key in seen:
                continue
            seen.add(key)
            unique.append(it)
        items = unique

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

