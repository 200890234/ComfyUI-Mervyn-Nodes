"""My Python Code 的共享内核: 沙箱、白名单、执行与缓存判定。

被两个节点共用:
- my_python_code.py    -> MyPythonCode   (V1: 固定 6 个输入槽)
- my_python_code_v2.py -> MyPythonCodeV2 (V3 API + Autogrow: 槽位自动增长)

拆成独立模块, 是为了让这两个节点各自能被单独删除而不牵连对方。

沙箱设计(只防意外, 不防对抗):
- 静态拒绝 import / global / nonlocal;
- 内置只给白名单(见 _SAFE_BUILTINS), 不暴露真正的 __builtins__;
- 常用标准库由节点预绑定(见 _PREBOUND_MODULES), 用模块名直接调用即可, 无需 import;
- __builtins__ 里的 __import__ 换为受控版本(见 _guarded_import), 只为放行标准库内部
  的延迟导入(datetime.strftime/date.today 要 import time, strptime 要 import
  _strptime), 不放行 os/sys/subprocess 等。
"""

import ast
import builtins
import datetime as _datetime
import functools
import itertools
import json
import math
import random
import re
import string
import textwrap


def _now(fmt: str = "%Y%m%d_%H%M%S") -> str:
    """当前本地时间的格式化字符串(默认 年月日_时分秒, 如 20261007_233437)。

    便捷函数: 等价于 datetime.datetime.now().strftime(...), 但不必写模块前缀。
    用了它(或 datetime.now())的代码会被判定为每次重算。
    """
    try:
        return _datetime.datetime.now().strftime(str(fmt))
    except Exception:
        return _datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


# 用户代码里可直接使用的名称白名单(不暴露任意内置与 import)
_SAFE_BUILTINS = {
    # 类型与转换
    "bool": bool, "bytes": bytes, "complex": complex, "dict": dict,
    "float": float, "frozenset": frozenset, "int": int, "list": list,
    "set": set, "str": str, "tuple": tuple,
    # 数值与运算
    "abs": abs, "divmod": divmod, "max": max, "min": min, "pow": pow,
    "round": round, "sum": sum,
    # 序列与迭代
    "all": all, "any": any, "enumerate": enumerate, "filter": filter,
    "iter": iter, "len": len, "map": map, "next": next, "range": range,
    "reversed": reversed, "slice": slice, "sorted": sorted, "zip": zip,
    # 字符串与进制
    "ascii": ascii, "bin": bin, "chr": chr, "format": format, "hex": hex,
    "oct": oct, "ord": ord, "repr": repr,
    # 自省(与已有的 getattr 一致; 本沙箱只防意外, 不防对抗)
    "callable": callable, "getattr": getattr, "hasattr": hasattr,
    "isinstance": isinstance, "type": type,
    # 其它
    "hash": hash, "print": print,
    # 节点自带: 沙箱禁用了 import, 时间由节点提供
    "now": _now,
    "True": True, "False": False, "None": None,
}

# 预绑定的标准库模块: 沙箱禁用了 import, 常用模块由节点直接注入,
# 用户代码里可直接写 math.floor(...)/json.dumps(...), 不需要(也不能)自己 import。
# 全部来自 Python 标准库 —— 节点因此不引入任何第三方依赖。
_PREBOUND_MODULES = {
    "math": math,
    "random": random,
    "json": json,
    "re": re,
    "datetime": _datetime,
    "itertools": itertools,
    "functools": functools,
    "string": string,
}

# 真实 __import__ 的备份(受控 __import__ 放行时转发给它)
_real_import = builtins.__import__

# 受控 __import__ 的模块白名单。
# 为什么必须有: CPython 部分标准库函数内部会做"延迟 import" —— 实测
# datetime.strftime()/date.today() 要 import time, datetime.strptime() 要 import
# _strptime。而沙箱把 __builtins__ 换成了没有 __import__ 的白名单, 这些延迟导入
# 会直接抛 KeyError: '__import__'(极难排查)。这里给出只在白名单内生效的 __import__,
# 顶层 import 语句仍被 _FORBIDDEN_NODES 静态拒绝, os/sys/subprocess 等一律挡住。
_IMPORTABLE_MODULES = frozenset({
    # 面向用户的预绑定模块(同时放行其子模块)
    "math", "random", "json", "re", "datetime", "itertools", "functools", "string",
    # 标准库内部机制会延迟导入的模块(实测 time/_strptime; 另附几个无害的时间相关)
    "time", "_strptime", "locale", "_locale", "calendar",
})


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    """受控 __import__: 只放行标准库内部的延迟导入, 挡住危险模块。"""
    root = (name or "").split(".")[0]
    if root not in _IMPORTABLE_MODULES:
        raise ImportError(
            f"import {root!r} is not allowed in python_code; "
            f"allowed: {', '.join(sorted(_IMPORTABLE_MODULES))}"
        )
    return _real_import(name, globals, locals, fromlist, level)


# exec 时真正使用的 __builtins__: 名称白名单 + 受控 __import__
_EXEC_BUILTINS = dict(_SAFE_BUILTINS)
_EXEC_BUILTINS["__import__"] = _guarded_import

# 结果变量名, 顺序与输出端口一致
RESULT_VARS = ("result_string", "result_int", "result_float",
               "result_boolean", "result_any")

# 未赋值的结果变量按端口类型给的兜底值: 直接输出 None 会原样传到下游并可能报错;
# any 端口保持 None(与未接线的 optional 输入语义一致)
RESULT_DEFAULTS = {
    "result_string": "",
    "result_int": 0,
    "result_float": 0.0,
    "result_boolean": False,
    "result_any": None,
}

# 静态禁止的顶层结构(运行时沙箱只防意外, 不防对抗)
_FORBIDDEN_NODES = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)

# 非确定性入口: 命中即强制每次重算(宁可多算, 不可算错)。
# 属性名匹配 <任意对象>.<名字>(), 覆盖 datetime.datetime.now()/random.shuffle() 等;
# random.seed(...) 之后理论上可缓存, 但这里不做这种推导, 一律重算以保证正确性。
_NONDETERMINISTIC_ATTRS = frozenset({
    # 时间
    "now", "today", "utcnow", "time", "monotonic", "perf_counter",
    # 随机
    "random", "randint", "randrange", "choice", "choices", "shuffle",
    "uniform", "sample", "gauss", "normalvariate", "getrandbits",
})


def forces_recompute(python_code: str) -> bool:
    """代码是否引用了非确定性入口(now()/random.*/时间类属性调用)。

    命中时调用方应让缓存失效(每次重算), 否则 now()/随机数会被 ComfyUI 的输入哈希
    缓存成固定值(批量出图拿到重名文件、随机数不动)。
    """
    try:
        tree = ast.parse(textwrap.dedent(python_code or ""))
    except SyntaxError:
        return False  # 语法错交给执行阶段报出
    for node in ast.walk(tree):
        # ① 模块级使用: 例如 random.seed(1) 之后再取值
        if (isinstance(node, ast.Name) and node.id == "random"
                and isinstance(node.ctx, ast.Load)):
            return True
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        # ② 裸函数调用 now(); 只看"调用", 用户自己 def now()/赋值 now 不算
        if isinstance(func, ast.Name) and func.id == "now":
            return True
        # ③ 属性调用: datetime.datetime.now() / random.randint() / time.time()
        if isinstance(func, ast.Attribute) and func.attr in _NONDETERMINISTIC_ATTRS:
            return True
    return False


def run_user_code(python_code: str, variables: dict) -> tuple:
    """在沙箱里执行用户代码, 返回与输出端口顺序一致的 5 个结果值。

    variables: 注入用户命名空间的变量(name -> value), 由各节点自行组装。
    """
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
    # 预绑定标准库模块(只作为可直接引用的名字, 不放进入 __builtins__)
    env.update(_PREBOUND_MODULES)
    # 关键: exec 会向 globals 注入完整 __builtins__(含 __import__), 必须显式替换为
    # 白名单, 否则沙箱被完全绕过。用 _EXEC_BUILTINS(白名单 + 受控 __import__)。
    env["__builtins__"] = _EXEC_BUILTINS
    env.update(variables)

    try:
        # 单命名空间执行: exec 的赋值落在 env 中, 作为结果变量被读取
        exec(compile(tree, "<python_code>", "exec"), env)  # noqa: S102
    except Exception as e:
        raise RuntimeError(f"python_code error: {e}") from e

    # 未赋值的结果变量按端口类型给零值; 显式赋值(含赋成 None)则原样保留
    return tuple(
        env[name] if name in env else RESULT_DEFAULTS[name]
        for name in RESULT_VARS
    )
