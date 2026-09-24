"""免启动冒烟测试: 直接验证节点模块的纯逻辑部分(不启动 ComfyUI 服务)。

用法: conda run -n ComfyuiP python tests/smoke_test.py
"""

import faulthandler
import importlib.util
import os
import subprocess
import sys
import tempfile

faulthandler.enable()

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFYUI_ROOT = r"D:\ComfyuiP"

sys.path.insert(0, COMFYUI_ROOT)

spec = importlib.util.spec_from_file_location(
    "my_load_video_under_path",
    os.path.join(REPO, "nodes", "my_load_video_under_path.py"),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

spec_code = importlib.util.spec_from_file_location(
    "my_python_code",
    os.path.join(REPO, "nodes", "my_python_code.py"),
)
mod_code = importlib.util.module_from_spec(spec_code)
spec_code.loader.exec_module(mod_code)

spec_save = importlib.util.spec_from_file_location(
    "my_save_image",
    os.path.join(REPO, "nodes", "my_save_image.py"),
)
mod_save = importlib.util.module_from_spec(spec_save)
spec_save.loader.exec_module(mod_save)

spec_move = importlib.util.spec_from_file_location(
    "my_move_file",
    os.path.join(REPO, "nodes", "my_move_file.py"),
)
mod_move = importlib.util.module_from_spec(spec_move)
spec_move.loader.exec_module(mod_move)

# 1. INPUT_TYPES 结构: 所有输入均为 optional(可连接), required 为空
types = mod.MyLoadVideoUnderPath.INPUT_TYPES()
# 1.5 输出端口结构: 含 AUDIO
rt = mod.MyLoadVideoUnderPath.RETURN_TYPES
assert rt == ("VIDEO", "STRING", "AUDIO", "INT", "FLOAT", "INT", "INT", "FLOAT"), rt
assert types["required"] == {}, types["required"]
optional = types["optional"]
assert set(optional) == {"path", "video_file", "preview", "start_time", "duration"}, optional
assert optional["video_file"][0] == [""]
assert optional["preview"][1]["default"] is False

# 2. 目录扫描: 根目录 / 子目录 / 更深一层
with tempfile.TemporaryDirectory() as root:
    os.makedirs(os.path.join(root, "season1", "sub"))
    for name in ("a.mp4", "b.mkv", "c.txt"):
        open(os.path.join(root, name), "w").close()
    open(os.path.join(root, "season1", "s01e01.webm"), "w").close()

    data = mod._scan(root, "")
    assert data["subdirs"] == ["season1"], data
    assert data["videos"] == ["a.mp4", "b.mkv"], data  # 不含子目录内容

    data = mod._scan(root, "season1")
    assert data["videos"] == ["s01e01.webm"], data
    assert data["subdirs"] == ["sub"], data  # 仍可继续进入下一层

    data = mod._scan(root, "season1/sub")
    assert data["videos"] == [] and data["subdirs"] == [], data

    # 3. rel 越界防护: "../outside" 抛错; ".."/"." 归一化为根目录
    for bad in ("../outside", "season1/../.."):
        try:
            mod._clean_rel(root, bad)
            raise AssertionError(f"should have raised for {bad!r}")
        except ValueError:
            pass
    assert mod._clean_rel(root, "..") == ""
    assert mod._clean_rel(root, ".") == ""

# 4. load_video: 非法选择应报错
node = mod.MyLoadVideoUnderPath()
for bad_file in ("", "(no video files)"):
    try:
        node.load_video("", bad_file, False, 0.0, 0.0)
        raise AssertionError(f"should have raised for {bad_file!r}")
    except ValueError:
        pass

# 5. 端到端: 用环境自带 imageio-ffmpeg 生成真实视频(含/不含音轨), 验证全部输出
def _make_test_videos(root):
    try:
        import imageio_ffmpeg
    except ImportError:
        return None, None
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    common = ["-y", "-loglevel", "error"]
    sample = os.path.join(root, "sample.mp4")
    subprocess.run(
        [ffmpeg, *common,
         "-f", "lavfi", "-i", "testsrc=duration=0.5:size=64x48:rate=8",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-shortest", sample],
        check=True,
    )
    silent = os.path.join(root, "silent.mp4")
    subprocess.run(
        [ffmpeg, *common,
         "-f", "lavfi", "-i", "testsrc=duration=0.5:size=64x48:rate=8",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", silent],
        check=True,
    )
    return sample, silent


with tempfile.TemporaryDirectory() as root2:
    video_path, silent_path = _make_test_videos(root2)
    if video_path is None:
        print("smoke test OK (imageio-ffmpeg unavailable, skipped e2e part)")
        sys.exit(0)

    w, h, fps_num = 64, 48, 8

    video, path_out, audio, fc, fps, width, height, dur = node.load_video(
        root2, video_path, False, 0.0, 0.0
    )
    assert os.path.normcase(path_out) == os.path.normcase(os.path.normpath(video_path)), path_out
    assert width == w and height == h, (width, height)
    assert abs(fps - fps_num) < 0.01, fps
    assert 3 <= fc <= 5, fc  # 容器元数据/估算的回退差异容忍 ±1
    assert 0.4 <= dur <= 0.7, dur  # 4 帧 @8fps ≈ 0.5s

    # 6.8 音频输出: 波形与采样率
    assert audio is not None, "expected audio track in sample.mp4"
    wf = audio["waveform"]
    assert wf.ndim == 3 and wf.shape[0] == 1 and wf.shape[1] == 2, tuple(wf.shape)
    assert wf.shape[2] > 0, tuple(wf.shape)
    assert audio["sample_rate"] > 0, audio["sample_rate"]

    # 6. 无音轨视频: audio 输出应为 None
    _, _, audio_silent, *_ = node.load_video("", silent_path, False, 0.0, 0.0)
    assert audio_silent is None, audio_silent

    # 6.5 截取: start_time=0.25 后时长应减半
    _, _, _, fc2, _, _, _, dur2 = node.load_video("", video_path, False, 0.25, 0.0)
    assert 0.1 <= dur2 <= 0.4, dur2
    assert 1 <= fc2 <= 3, fc2

    # 7. path 直接给完整视频路径(不经 Browse 选择)也能加载
    _, path3, *_ = node.load_video(video_path, "", False, 0.0, 0.0)
    assert os.path.normcase(path3) == os.path.normcase(os.path.normpath(video_path)), path3

# 8. MyPythonCode: 结构与执行
pc = mod_code.MyPythonCode
ptypes = pc.INPUT_TYPES()
assert set(ptypes["optional"]) == {
    "string_value", "int_value", "float_value", "boolean_value", "any1", "any2",
}, ptypes["optional"]
assert pc.RETURN_NAMES == ("string", "int", "float", "boolean", "any")

node_pc = pc()
out = node_pc.run(
    "result_string = string_value.upper()\n"
    "result_int = int_value * 2\n"
    "result_float = float_value / 2\n"
    "result_boolean = boolean_value and int_value > 0\n"
    "result_any = any1\n",
    "abc", 3, 4.0, True, [1, 2], None,
)
assert out[0] == "ABC" and out[1] == 6 and abs(out[2] - 2.0) < 1e-9, out
assert out[3] is True and out[4] == [1, 2], out

# 8.1 未赋值的结果变量输出 None
out2 = node_pc.run("result_int = 7", "x", 1, 1.0, False, None, None)
assert out2 == (None, 7, None, None, None), out2

# 8.2 import 被拒绝
for bad in ("import os", "from os import path", "global x"):
    try:
        node_pc.run(bad, "", 0, 0.0, False, None, None)
        raise AssertionError(f"should have rejected: {bad!r}")
    except ValueError:
        pass

# 8.3 语法错误 -> ValueError; 运行时错误 -> RuntimeError
try:
    node_pc.run("result_int = (", "", 0, 0.0, False, None, None)
    raise AssertionError("should have raised SyntaxError")
except ValueError:
    pass
try:
    node_pc.run("result_int = 1 / 0", "", 0, 0.0, False, None, None)
    raise AssertionError("should have raised RuntimeError")
except RuntimeError:
    pass

# 8.4 内置白名单可用、未知名称不可用
out3 = node_pc.run("result_any = str(sorted([3, 1, 2]))", "", 0, 0.0, False, None, None)
assert out3[4] == "[1, 2, 3]", out3
try:
    node_pc.run("result_any = __import__", "", 0, 0.0, False, None, None)
    raise AssertionError("__import__ should not be available")
except RuntimeError:
    pass

# 9. MySaveImage: 保存/重名跳过/覆盖
try:
    import torch as th
except ImportError:
    print("smoke test OK (torch unavailable, skipped save-image part)")
    sys.exit(0)

node_save = mod_save.MySaveImage()
img = th.rand(2, 16, 16, 3)  # 批量两张 16x16
with tempfile.TemporaryDirectory() as sdir:
    prefix = os.path.join(sdir, "shot")
    r = node_save.save(img, sdir, "shot", False)
    assert "saved:" in r["result"][0] and "skipped" not in r["result"][0], r
    assert os.path.isfile(prefix + "_00001.png") and os.path.isfile(prefix + "_00002.png")
    moved_paths = r["result"][1].split("; ")
    assert len(moved_paths) == 2 and os.path.isfile(moved_paths[0]), moved_paths
    assert r["ui"]["mervyn_save_image"] == [r["result"][0], r["result"][1]]

    # 重名 + overwrite=False: 全部跳过, moved_path 为空
    r2 = node_save.save(img, sdir, "shot", False)
    assert "skipped" in r2["result"][0] and r2["result"][1] == "", r2
    assert r2["result"][0].count("skipped") == 2

    # 重名 + overwrite=True: 覆盖成功
    r3 = node_save.save(img, sdir, "shot", True)
    assert "saved:" in r3["result"][0] and "skipped" not in r3["result"][0], r3
    assert len(r3["result"][1].split("; ")) == 2

    # 子目录自动创建
    sub = os.path.join(sdir, "a", "b")
    r4 = node_save.save(img[:1], sub, "deep", False)
    assert os.path.isfile(os.path.join(sub, "deep.png")), r4

# 10. MyMoveFile: 单个/批量移动、重名跳过、覆盖
node_move = mod_move.MyMoveFile()
with tempfile.TemporaryDirectory() as mdir_src, tempfile.TemporaryDirectory() as mdir_dst:
    def _mk(name, content="x"):
        p = os.path.join(mdir_src, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
        return p

    a, b = _mk("a.txt"), _mk("b.txt")

    # 多行字符串批量移动
    r = node_move.move(f"{a}\n{b}", mdir_dst, False)
    assert r["result"][0].count("moved:") == 2, r
    assert os.path.isfile(os.path.join(mdir_dst, "a.txt"))
    assert not os.path.exists(a) and not os.path.exists(b)
    assert r["ui"]["mervyn_move_file"] == [r["result"][0], r["result"][1]]

    # 列表输入 + 重名跳过
    a2, b2 = _mk("a.txt"), _mk("b.txt")
    r2 = node_move.move([a2, b2], mdir_dst, False)
    assert r2["result"][0].count("skipped") == 2, r2
    assert r2["result"][1] == "" and os.path.isfile(a2) and os.path.isfile(b2)

    # 覆盖模式
    r3 = node_move.move([a2], mdir_dst, True)
    assert r3["result"][0].count("moved:") == 1 and not os.path.exists(a2), r3

    # 不存在的文件: error 不中断
    r4 = node_move.move([os.path.join(mdir_src, "ghost.txt")], mdir_dst, True)
    assert "error (not found)" in r4["result"][0], r4

    # 空目录参数报错
    try:
        node_move.move([a], "  ", False)
        raise AssertionError("empty directory should raise")
    except ValueError:
        pass

print("smoke test OK")
