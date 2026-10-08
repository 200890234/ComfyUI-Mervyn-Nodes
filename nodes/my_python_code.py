"""My Python Code (V1): 固定 6 个输入槽的可编程代码节点。

输入端: string/int/float/boolean 各一个 + 两个任意类型(any)。
输出端: string/int/float/boolean/any 各一个。
用户代码通过变量名直接访问输入值; 每个输出端口对应一个结果变量,
未定义的结果变量按端口类型输出零值(见 core.RESULT_DEFAULTS), 避免 None 传到下游报错。

沙箱与执行语义全部在 my_python_code_core 中实现, 与 V2 共用(行为一致):
- 静态拒绝 import/global/nonlocal; 内置只给白名单;
- 常用标准库(math/random/json/re/datetime/itertools/functools/string)预绑定, 无需 import;
- 代码里调用 now()/random.*/datetime.now() 等非确定性入口时, IS_CHANGED 返回 NaN
  强制每次重算(否则会被 ComfyUI 的输入哈希缓存住不重跑)。

与 V2 的分工:
- 本节点(V1)保留固定槽位, 接口与历史工作流完全兼容;
- MyPythonCodeV2 用 V3 API + Autogrow 让输入槽自动增长。
两者可并行存在, 删掉任一个都不影响另一个(共享代码在 core 模块里)。
"""

try:  # ComfyUI 内为包相对导入
    from .my_python_code_core import forces_recompute, run_user_code
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_python_code_core import forces_recompute, run_user_code

# 沙箱说明(两版节点共用同一段文案, 避免两边描述漂移)
_CODE_TOOLTIP = (
    "Python code. Read inputs via string_value/int_value/float_value/"
    "boolean_value/any1/any2. Write results to "
    "result_string/result_int/result_float/result_boolean/result_any. "
    "Unassigned results fall back to empty string / 0 / 0.0 / False "
    "(any stays None). "
    "import is disabled, but these stdlib modules are pre-bound for "
    "direct use: math, random, json, re, datetime, itertools, functools, "
    "string. "
    "now() returns the current local time as a string "
    "(default %Y%m%d_%H%M%S, e.g. 20261007_233437)."
)


class MyPythonCode:
    """用一段 Python 代码变换输入的数字和字符串。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "python_code": ("STRING", {
                    "default": (
                        "# variables: string_value, int_value, float_value, "
                        "boolean_value, any1, any2\n"
                        'result_string = f"text={string_value}, n={int_value}"\n'
                        "result_int = int_value + 1"
                    ),
                    "multiline": True,
                    "tooltip": _CODE_TOOLTIP,
                }),
            },
            "optional": {
                "string_value": ("STRING", {"forceInput": True}),
                "int_value": ("INT", {"default": 0, "forceInput": True}),
                "float_value": ("FLOAT", {"default": 0.0, "forceInput": True}),
                "boolean_value": ("BOOLEAN", {"default": False, "forceInput": True}),
                "any1": ("*", {"forceInput": True}),
                "any2": ("*", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "FLOAT", "BOOLEAN", "*")
    RETURN_NAMES = ("string", "int", "float", "boolean", "any")
    FUNCTION = "run"
    CATEGORY = "my"
    DESCRIPTION = "Run custom Python code to transform numeric and string inputs."

    @classmethod
    def IS_CHANGED(cls, python_code="", **kwargs):
        """代码里用了非确定性入口时必须每次重算, 否则会被 ComfyUI 的输入哈希缓存住。

        ComfyUI 按输入值判断能否复用上次结果: python_code 不变就不会重跑, 于是
        now()/random.*/datetime.now() 会永远返回第一次执行的值(批量出图拿到重名
        文件被覆盖、随机数固定不动)。命中非确定性入口时返回 NaN 强制失效, 其余
        情况返回代码本身作为缓存键, 保持可缓存。
        """
        return float("nan") if forces_recompute(python_code) else python_code

    def run(self, python_code, string_value="", int_value=0, float_value=0.0,
            boolean_value=False, any1=None, any2=None):
        return run_user_code(python_code, {
            "string_value": string_value or "",
            "int_value": int(int_value or 0),
            "float_value": float(float_value or 0.0),
            "boolean_value": bool(boolean_value),
            "any1": any1,
            "any2": any2,
        })
