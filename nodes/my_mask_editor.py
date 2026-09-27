"""My Mask Editor: 在图片上涂蒙版, 保存为伴生文件 <同名>_mask.png。

- 彻底脱离 ComfyUI input 目录: 蒙版与图片同目录, 约定白=选中/黑=排除
- 前端在图片上叠加画笔层(画/擦/粗细/清空), 保存走本模块的 /mervyn/save_mask 路由
- 执行时 mask 输出 = 读取伴生蒙版文件; 没画过则输出全零(主流默认)
"""

import base64
import os

import numpy as np
import torch
from PIL import Image, ImageOps

try:  # ComfyUI 内为包相对导入
    from .my_load_image_under_path import IMAGE_EXTS
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_load_image_under_path import IMAGE_EXTS

MASK_SUFFIX = "_mask"


def mask_path_for(image_path: str) -> str:
    """图片路径 -> 伴生蒙版路径(同目录, 同主名, 固定 .png)。"""
    stem = os.path.splitext(image_path)[0]
    return stem + MASK_SUFFIX + ".png"


def _resolve_image(image_path: str) -> str:
    raw = (image_path or "").strip().strip('"').strip("'")
    if not raw or raw.startswith("("):
        raise ValueError("no image selected - connect a file_path first")
    resolved = os.path.abspath(os.path.normpath(raw))
    if os.path.splitext(resolved)[1].lower() not in IMAGE_EXTS:
        raise ValueError(f"not an image file: {resolved}")
    if not os.path.isfile(resolved):
        raise FileNotFoundError(f"image file not found: {resolved}")
    return resolved


def load_mask(image_path: str):
    """读取伴生蒙版, 返回 (mask tensor (1,H,W) 或 None, mask_path)。

    无蒙版文件时 mask 为 None(调用方按图片尺寸输出全零)。
    蒙版尺寸与图片不一致时按最近邻缩放对齐。
    """
    resolved = _resolve_image(image_path)
    mask_file = mask_path_for(resolved)
    if not os.path.isfile(mask_file):
        return None, ""
    img = Image.open(resolved)
    img = ImageOps.exif_transpose(img)
    w, h = img.size
    m = Image.open(mask_file)
    # 合成到黑底再转灰度: 消除浏览器导出 PNG 的 alpha 编码差异,
    # 保证"涂白=1, 未涂=0"与画布所见一致
    if m.mode != "L":
        bg = Image.new("L", m.size, 0)
        if "A" in m.getbands():
            bg.paste(m.convert("RGB"), mask=m.getchannel("A"))
        else:
            bg.paste(m.convert("RGB"))
        m = bg
    if m.size != (w, h):
        m = m.resize((w, h), Image.NEAREST)
    arr = np.array(m, dtype=np.float32) / 255.0
    return torch.from_numpy(arr)[None,], mask_file


def save_mask_file(image_path: str, data_url: str) -> str:
    """把前端画布导出的 dataURL(PNG) 解码后写到伴生蒙版路径。"""
    resolved = _resolve_image(image_path)
    if not data_url or "base64," not in data_url:
        raise ValueError("invalid mask data")
    b64 = data_url.split("base64,", 1)[1]
    raw = base64.b64decode(b64)
    # 校验是合法 PNG 再落盘
    Image.open(__import__("io").BytesIO(raw)).verify()
    target = mask_path_for(resolved)
    with open(target, "wb") as f:
        f.write(raw)
    return target


def _register_routes() -> None:
    try:
        from server import PromptServer
        from aiohttp import web
    except Exception:  # 非 ComfyUI 环境(如单测)下不注册
        return
    if getattr(PromptServer, "instance", None) is None:
        return
    routes = PromptServer.instance.routes

    @routes.post("/mervyn/save_mask")
    async def save_mask(request):
        try:
            data = await request.json()
            saved = save_mask_file(data.get("path", ""), data.get("dataUrl", ""))
            return web.json_response({"saved": saved})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=400)


_register_routes()


class MyMaskEditor:
    """在图片上涂蒙版(画布), 保存为伴生文件并输出 MASK。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "file_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "tooltip": "Image to mask (connect My Load Image Under Path's file_path, or type an absolute path)",
                }),
            },
        }

    RETURN_TYPES = ("MASK", "STRING")
    RETURN_NAMES = ("mask", "mask_path")
    OUTPUT_TOOLTIPS = (
        "Painted mask (1 = selected area); all zeros when no mask has been painted yet",
        "Path of the mask file in use; empty when none exists",
    )
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = "my"
    DESCRIPTION = "Paint a mask on an image (saved as <name>_mask.png next to it). Fully independent of the input directory."

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("NaN")  # 蒙版文件可能被外部修改, 每次都执行

    def run(self, file_path=""):
        resolved = _resolve_image(file_path)
        mask, mask_file = load_mask(resolved)
        if mask is None:
            img = Image.open(resolved)
            img = ImageOps.exif_transpose(img)
            mask = torch.zeros((img.height, img.width), dtype=torch.float32)[None,]
            mask_file = ""
        info = mask_file if mask_file else "(no mask painted yet)"
        return {"ui": {"mervyn_mask_editor": [info]},
                "result": (mask, mask_file)}

