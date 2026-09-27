"""My Load Image Under Path: 核心 LoadImage 行为 + 任意目录支持。

与核心 LoadImage 的差异:
- VALIDATE_INPUTS 豁免静态列表校验 -> image 值可以是任意绝对路径
- 额外 folder 参数供前端列式浏览面板使用
- 只输出 IMAGE + file_path, 不产出 MASK: 蒙版的唯一事实源是 My Mask Editor,
  避免同一份 <同名>_mask.png 出现两个输出端造成歧义
其余(解码/EXIF/动画 webp 回退)与核心 LoadImage 对齐,
因此 Open Image / Save Image / Open in MaskEditor 等核心菜单天然可用。
"""

import os

import folder_paths
import node_helpers
import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

from comfy_api.latest import InputImpl

try:  # ComfyUI 内为包相对导入
    from .my_media_browser import IMAGE_EXTS
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_media_browser import IMAGE_EXTS


class MyLoadImageUnderPath:
    @classmethod
    def INPUT_TYPES(cls):
        # 与核心 LoadImage 相同的输入目录文件列表(image_upload 提供上传按钮)
        input_dir = folder_paths.get_input_directory()
        try:
            files = [
                f for f in os.listdir(input_dir)
                if os.path.isfile(os.path.join(input_dir, f))
            ]
            files = folder_paths.filter_files_content_types(files, ["image"])
        except OSError:
            files = []
        return {
            "required": {
                # 无 image_upload: 上传按钮只会上传到 input 目录(任意目录场景不需要),
                # 蒙版编辑由右键 Open in Mask Editor 命令 / My Mask Editor 节点承担
                "image": (sorted(files), {}),
            },
            "optional": {
                "folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Any folder to browse with the inline picker; the picked absolute path is written into 'image'. Leave empty to pick from ComfyUI's input dir.",
                }),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        # image 是动态值: 输入目录文件名 或 任意绝对路径, 均放行
        return True

    RETURN_TYPES = ("IMAGE", "STRING")
    RETURN_NAMES = ("IMAGE", "file_path")
    OUTPUT_TOOLTIPS = (
        "Decoded image tensor (1, H, W, 3) float 0-1, EXIF orientation applied",
        "Absolute path of the loaded file (feed it into My Mask Editor)",
    )
    FUNCTION = "load_image"
    CATEGORY = "my"
    DESCRIPTION = (
        "Core LoadImage behavior + any-folder support: pick from the input dir or "
        "browse ANY folder (absolute paths). Open in MaskEditor works like the stock node."
    )

    def load_image(self, image, folder=""):
        # get_annotated_filepath 解析 "[type] name" 注解与 input 相对名;
        # 任意绝对路径会被其校验拒绝 -> 回退为原始路径(本节点的核心扩展点)
        try:
            image_path = folder_paths.get_annotated_filepath(image)
        except Exception:
            image_path = image
        image_path = os.path.abspath(os.path.normpath(image_path)) \
            if (":" in image_path or image_path.startswith("\\\\")) else image_path

        # 单帧/多帧统一走 pyav(核心 LoadImage 0.34 同款); 失败回退 PIL 逐帧
        try:
            components = InputImpl.VideoFromFile(image_path).get_components()
            if components.images.shape[0] > 0:
                return (components.images, image_path)
        except Exception:
            pass

        # 动画 webp 回退(pyav 不支持逐帧读取, 核心 LoadImage 同款)
        img = node_helpers.pillow(Image.open, image_path)
        output_images = []
        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)
            rgb = i.convert("RGB")
            output_images.append(np.array(rgb).astype(np.float32) / 255.0)
        if not output_images:
            raise ValueError(f"no frames in image: {image_path}")
        return (torch.from_numpy(np.stack(output_images)), image_path)
