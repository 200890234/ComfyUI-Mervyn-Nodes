"""ComfyUI-Mervyn-Nodes 插件入口。

ComfyUI 启动时会加载 custom_nodes/ 下的本目录并执行此文件。
NODE_CLASS_MAPPINGS 中的 key 是节点内部名称（工作流 JSON 中使用），
NODE_DISPLAY_NAME_MAPPINGS 是画布上显示的名称。
"""

from .nodes.example import ExampleNode
from .nodes.my_load_video_under_path import MyLoadVideoUnderPath  # noqa: F401 (导入即注册 API 路由)
from .nodes.my_python_code import MyPythonCode
from .nodes.my_save_image import MySaveImage
from .nodes.my_move_file import MyMoveFile

# 节点统一使用 my 前缀, 便于搜索时过滤出自己的节点
NODE_CLASS_MAPPINGS = {
    "MyExampleNode": ExampleNode,
    "MyLoadVideoUnderPath": MyLoadVideoUnderPath,
    "MyPythonCode": MyPythonCode,
    "MySaveImage": MySaveImage,
    "MyMoveFile": MyMoveFile,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MyExampleNode": "My Example Node",
    "MyLoadVideoUnderPath": "My Load Video Under Path",
    "MyPythonCode": "My Python Code",
    "MySaveImage": "My Save Image",
    "MyMoveFile": "My Move File",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
