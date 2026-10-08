"""My Python Code V2: V3 API(io.ComfyNode) + Autogrow 的可编程代码节点。

与 V1(MyPythonCode)的差别只在"输入槽":
- 4 个具名输入(string_value/int_value/float_value/boolean_value)保持不变;
- V1 的 any1/any2 换成 Autogrow 槽位: 连一个就自动长出下一个(上限 MAX_VAR_SLOTS),
  代码里按槽位顺序用 var_0 / var_1 / ... 读取, 类型不限(AnyType, 可接 IMAGE/LATENT 等);
- 输出仍是固定 5 个(string/int/float/boolean/any), 由 result_* 变量赋值 ——
  核心 V3 API 目前只有 Autogrow 输入, 没有动态输出机制(Autogrow 无 Output,
  DynamicOutput 也没有实现类), 所以输出侧无法做成可增长。

沙箱与执行语义与 V1 完全共用(my_python_code_core), 因此两版行为一致:
静态拒绝 import/global/nonlocal、内置白名单、常用标准库预绑定、受控 __import__、
未赋值结果按端口类型给零值、非确定性入口强制重算。
"""

from comfy_api.latest import io

try:  # ComfyUI 内为包相对导入
    from .my_python_code_core import forces_recompute, run_user_code
except ImportError:  # 独立加载(冒烟测试)时回退为同目录导入
    from my_python_code_core import forces_recompute, run_user_code

# Autogrow 槽位上限(核心上限是 100, 这里取一个够用又不至于刷屏的值)
MAX_VAR_SLOTS = 20

_DEFAULT_CODE = (
    "# variables: string_value, int_value, float_value, boolean_value, "
    "var_0, var_1, ...\n"
    "# var_* come from the auto-growing slots (any type); connect one to see the next.\n"
    'result_string = f"text={string_value}, n={int_value}"\n'
    "result_int = int_value + 1"
)

_TOOLTIP = (
    "Python code. Read inputs via string_value/int_value/float_value/boolean_value "
    "and var_0, var_1, ... (from the auto-growing slots, any type). Write results to "
    "result_string/result_int/result_float/result_boolean/result_any. "
    "Unassigned results fall back to empty string / 0 / 0.0 / False (any stays None). "
    "import is disabled, but these stdlib modules are pre-bound for direct use: "
    "math, random, json, re, datetime, itertools, functools, string. "
    "now() returns the current local time as a string "
    "(default %Y%m%d_%H%M%S, e.g. 20261007_233437)."
)


def _flatten_autogrow(node):
    """按槽位顺序摊平 Autogrow 传进来的值(容忍扁平/嵌套 dict 与 None)。

    ComfyUI 是按槽位名的顺序组装这个 dict 的, 且只传"真正连了线"的槽位,
    自动增长的槽位不会出现空洞, 所以第 i 个值就是 var_i。
    """
    if node is None:
        return []
    if isinstance(node, dict):
        values = []
        for value in node.values():
            values.extend(_flatten_autogrow(value))
        return values
    return [node]


class MyPythonCodeV2(io.ComfyNode):
    """用一段 Python 代码变换输入; 输入槽位自动增长。"""

    @classmethod
    def define_schema(cls):
        var_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input("var", optional=True),
            prefix="var_",
            min=0,
            max=MAX_VAR_SLOTS,
        )
        return io.Schema(
            node_id="MyPythonCodeV2",
            display_name="My Python Code V2",
            category="my",
            description=(
                "Run custom Python code. Inputs are pre-bound as string_value/int_value/"
                "float_value/boolean_value plus var_0, var_1, ... from the auto-growing "
                "slots. Write results to result_string/result_int/result_float/"
                "result_boolean/result_any."
            ),
            inputs=[
                io.String.Input(
                    "python_code",
                    multiline=True,
                    default=_DEFAULT_CODE,
                    tooltip=_TOOLTIP,
                ),
                io.String.Input("string_value", optional=True, force_input=True),
                io.Int.Input("int_value", default=0, optional=True, force_input=True),
                io.Float.Input("float_value", default=0.0, optional=True, force_input=True),
                io.Boolean.Input("boolean_value", default=False, optional=True,
                                 force_input=True),
                io.Autogrow.Input(
                    "vars",
                    template=var_template,
                    optional=True,
                    tooltip=(
                        "Auto-growing inputs of any type. They appear in the code as "
                        "var_0, var_1, ... in slot order."
                    ),
                ),
            ],
            outputs=[
                io.String.Output(display_name="string"),
                io.Int.Output(display_name="int"),
                io.Float.Output(display_name="float"),
                io.Boolean.Output(display_name="boolean"),
                io.AnyType.Output(display_name="any"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, python_code="", **kwargs):
        """V3 版的 IS_CHANGED: 命中非确定性入口时返回 NaN 强制每次重算。"""
        return float("nan") if forces_recompute(python_code) else python_code

    @classmethod
    def execute(cls, python_code, vars=None, string_value="", int_value=0,
                float_value=0.0, boolean_value=False, **kwargs):
        variables = {
            "string_value": string_value or "",
            "int_value": int(int_value or 0),
            "float_value": float(float_value or 0.0),
            "boolean_value": bool(boolean_value),
        }
        # Autogrow 槽位按连接顺序摊平成 var_0/var_1/...
        for index, value in enumerate(_flatten_autogrow(vars)):
            variables[f"var_{index}"] = value
        return io.NodeOutput(*run_user_code(python_code, variables))
