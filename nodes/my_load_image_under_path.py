"""My Load Image Under Path: 任意目录选图, 行为对齐核心 LoadImage。

- 前端: 与 My Load Video Under Path 同款三段式选择器 + 列式浏览面板 + 内嵌预览
- 右键菜单: Open Image / Save Image(前端 getExtraMenuOptions 提供)
- 输出: file_path + image(IMAGE)
"""

import os

import folder_paths
import numpy as np
import torch
from PIL import Image, ImageOps

try:  # ComfyUI 内为包相对导入
    from .my_load_video_under_path import _clean_root
    from .my_media_browser import IMAGE_EXTS
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_load_video_under_path import _clean_root
    from my_media_browser import IMAGE_EXTS


class MyLoadImageUnderPath:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 与核心 LoadImage 同款声明: image_upload 标志让前端提供
                # 上传按钮与 Open in MaskEditor 菜单
                "image": ([""], {"image_upload": True}),
            },
            "optional": {
                "folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Root directory to browse, e.g. D:/pictures. Also accepts a full image file path.",
                }),
            },
        }

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        # "image" 是动态下拉: 选项由前端按目录注入, 跳过静态列表校验
        return True

    RETURN_TYPES = ("STRING", "IMAGE", "MASK")
    RETURN_NAMES = ("file_path", "image", "mask")
    OUTPUT_TOOLTIPS = (
        "Resolved image file path (bridged into ComfyUI input dir when picked from a custom folder)",
        "Decoded image tensor (1, H, W, 3) float 0-1, EXIF orientation applied",
        "Mask from image alpha (inverted, 1, H, W); zeros when the image has no alpha",
    )
    FUNCTION = "run"
    CATEGORY = "my"
    DESCRIPTION = "Browse a directory and load the selected image, LoadImage-style."

    def run(self, image, folder=""):
        file_path = (image or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            # 未选择文件时, 允许 folder 直填完整图片路径
            file_path = (folder or "").strip().strip('"').strip("'")
        if not file_path or file_path.startswith("("):
            raise ValueError("no image file selected - set folder and pick a file first")

        # 解析与核心 LoadImage 一致: 支持 "[input]/[temp]" 注解与相对 input 的文件名;
        # 绝对路径经 os.path.join 语义天然直读本机任意位置
        try:
            resolved = folder_paths.get_annotated_filepath(file_path)
        except Exception:
            resolved = file_path
        resolved = os.path.abspath(os.path.normpath(resolved))
        if os.path.splitext(resolved)[1].lower() not in IMAGE_EXTS:
            raise ValueError(f"not an image file: {resolved}")
        if not os.path.isfile(resolved):
            raise FileNotFoundError(f"image file not found: {resolved}")

        img = Image.open(resolved)
        img = ImageOps.exif_transpose(img)
        # mask = 1 - alpha(核心 LoadImage 同款); 无 alpha 时全零
        if "A" in img.getbands():
            alpha = np.array(img.getchannel("A")).astype(np.float32) / 255.0
            mask = 1.0 - torch.from_numpy(alpha)
        else:
            mask = torch.zeros((img.height, img.width), dtype=torch.float32)
        mask = mask[None,]  # (1, H, W)

        rgb = img.convert("RGB")
        arr = np.array(rgb).astype(np.float32) / 255.0
        return (resolved, torch.from_numpy(arr)[None,], mask)

