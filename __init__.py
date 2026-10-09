"""ComfyUI-Mervyn-Nodes 插件入口。

ComfyUI 启动时会加载 custom_nodes/ 下的本目录并执行此文件。
NODE_CLASS_MAPPINGS 中的 key 是节点内部名称（工作流 JSON 中使用），
NODE_DISPLAY_NAME_MAPPINGS 是画布上显示的名称。
"""

from .nodes.my_load_video_under_path import MyLoadVideoUnderPath  # noqa: F401 (导入即注册 API 路由)
from .nodes.my_python_code import MyPythonCode
from .nodes.my_python_code_v2 import MyPythonCodeV2
from .nodes.my_save_image import MySaveImage
from .nodes.my_move_file import MyMoveFile
from .nodes.my_media_browser import MyMediaBrowser
from .nodes.my_load_image_under_path import MyLoadImageUnderPath
from .nodes.my_save_video_to_folder import MySaveVideoToFolder
from .nodes.my_mask_editor import MyMaskEditor
from .nodes.my_ollama_vision import MyOllamaVision

# 节点统一使用 my 前缀, 便于搜索时过滤出自己的节点
NODE_CLASS_MAPPINGS = {
    "MyLoadVideoUnderPath": MyLoadVideoUnderPath,
    "MyPythonCode": MyPythonCode,
    "MyPythonCodeV2": MyPythonCodeV2,
    "MySaveImage": MySaveImage,
    "MyMoveFile": MyMoveFile,
    "MyMediaBrowser": MyMediaBrowser,
    "MyLoadImageUnderPath": MyLoadImageUnderPath,
    "MySaveVideoToFolder": MySaveVideoToFolder,
    "MyMaskEditor": MyMaskEditor,
    "MyOllamaVision": MyOllamaVision,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MyLoadVideoUnderPath": "My Load Video Under Path",
    "MyPythonCode": "My Python Code",
    "MyPythonCodeV2": "My Python Code V2",
    "MySaveImage": "My Save Image",
    "MyMoveFile": "My Move File",
    "MyMediaBrowser": "My Media Browser",
    "MyLoadImageUnderPath": "My Load Image Under Path",
    "MySaveVideoToFolder": "My Save Video to Folder",
    "MyMaskEditor": "My Mask Editor",
    "MyOllamaVision": "My Ollama Vision",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
