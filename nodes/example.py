"""示例节点：演示最基本的输入/输出结构，可直接修改或删除。"""


class ExampleNode:
    """把输入字符串加上前缀后原样返回。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"default": "", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "Mervyn"

    def run(self, text: str):
        return (f"[Mervyn] {text}",)
