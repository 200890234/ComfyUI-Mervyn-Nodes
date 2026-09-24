"""ComfyUI-Mervyn-Nodes 插件入口。

ComfyUI 启动时会加载 custom_nodes/ 下的本目录并执行此文件。
NODE_CLASS_MAPPINGS 中的 key 是节点内部名称（工作流 JSON 中使用），
NODE_DISPLAY_NAME_MAPPINGS 是画布上显示的名称。
"""

from .nodes.example import ExampleNode

NODE_CLASS_MAPPINGS = {
    "MervynExampleNode": ExampleNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MervynExampleNode": "Mervyn: Example Node",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
