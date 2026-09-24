"""My Python Code: 可编程代码节点。

输入端: string/int/float/boolean 各一个 + 两个任意类型(any)。
输出端: string/int/float/boolean/any 各一个。
用户代码通过变量名直接访问输入值; 每个输出端口对应一个结果变量,
未定义的结果变量输出 None(由前端按端口类型取默认值)。
"""

import ast
import textwrap

# 用户代码里可直接使用的名称白名单(不暴露任意内置与 import)
_SAFE_BUILTINS = {
    "abs": abs, "bool": bool, "dict": dict, "divmod": divmod,
    "enumerate": enumerate, "filter": filter, "float": float,
    "format": format, "frozenset": frozenset, "getattr": getattr,
    "hasattr": hasattr, "hash": hash, "int": int, "isinstance": isinstance,
    "len": len, "list": list, "map": map, "max": max, "min": min,
    "print": print, "range": range, "repr": repr, "reversed": reversed,
    "round": round, "set": set, "slice": slice, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple, "zip": zip,
    "True": True, "False": False, "None": None,
}

# 结果变量名, 顺序与输出端口一致
_RESULT_VARS = ("result_string", "result_int", "result_float",
                "result_boolean", "result_any")

# 静态禁止的顶层结构(运行时沙箱只防意外, 不防对抗)
_FORBIDDEN_NODES = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)


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
                    "tooltip": (
                        "Python code. Read inputs via string_value/int_value/"
                        "float_value/boolean_value/any1/any2. Write results to "
                        "result_string/result_int/result_float/result_boolean/result_any."
                    ),
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

    def run(self, python_code, string_value="", int_value=0, float_value=0.0,
            boolean_value=False, any1=None, any2=None):
        code = textwrap.dedent(python_code or "").strip()
        if not code:
            raise ValueError("python_code is empty")

        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            raise ValueError(f"python_code syntax error: {e}") from e
        for node in ast.walk(tree):
            if isinstance(node, _FORBIDDEN_NODES):
                raise ValueError(f"{type(node).__name__} is not allowed in python_code")

        env = dict(_SAFE_BUILTINS)
        # 关键: exec 会向 globals 注入完整 __builtins__(含 __import__),
        # 必须显式替换为白名单, 否则沙箱被完全绕过
        env["__builtins__"] = _SAFE_BUILTINS
        env.update({
            "string_value": string_value or "",
            "int_value": int(int_value or 0),
            "float_value": float(float_value or 0.0),
            "boolean_value": bool(boolean_value),
            "any1": any1,
            "any2": any2,
        })
        try:
            # 单命名空间执行: exec 的赋值落在 env 中, 作为结果变量被读取
            exec(compile(tree, "<python_code>", "exec"), env)  # noqa: S102
        except Exception as e:
            raise RuntimeError(f"python_code error: {e}") from e

        return tuple(env.get(name) for name in _RESULT_VARS)
