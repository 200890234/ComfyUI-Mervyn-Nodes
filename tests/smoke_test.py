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
sys.path.insert(0, os.path.join(REPO, "nodes"))  # 供 my_media_browser 回退导入兄弟模块

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

spec_mb = importlib.util.spec_from_file_location(
    "my_media_browser",
    os.path.join(REPO, "nodes", "my_media_browser.py"),
)
mod_mb = importlib.util.module_from_spec(spec_mb)
spec_mb.loader.exec_module(mod_mb)

spec_li = importlib.util.spec_from_file_location(
    "my_load_image_under_path",
    os.path.join(REPO, "nodes", "my_load_image_under_path.py"),
)
mod_li = importlib.util.module_from_spec(spec_li)
spec_li.loader.exec_module(mod_li)

spec_sv = importlib.util.spec_from_file_location(
    "my_save_video_to_folder",
    os.path.join(REPO, "nodes", "my_save_video_to_folder.py"),
)
mod_sv = importlib.util.module_from_spec(spec_sv)
spec_sv.loader.exec_module(mod_sv)

spec_me = importlib.util.spec_from_file_location(
    "my_mask_editor",
    os.path.join(REPO, "nodes", "my_mask_editor.py"),
)
mod_me = importlib.util.module_from_spec(spec_me)
spec_me.loader.exec_module(mod_me)

# 1. INPUT_TYPES 结构: 所有输入均为 optional(可连接), required 为空
types = mod.MyLoadVideoUnderPath.INPUT_TYPES()
# 1.5 输出端口结构: 含 AUDIO 与 IMAGE 帧输出
rt = mod.MyLoadVideoUnderPath.RETURN_TYPES
assert rt == ("VIDEO", "STRING", "AUDIO", "IMAGE", "INT", "FLOAT", "INT", "INT", "FLOAT"), rt
assert types["required"] == {}, types["required"]
optional = types["optional"]
assert set(optional) == {
    "path", "video_file", "preview", "start_time", "duration",
    "skip_first_frames", "frame_load_cap", "select_every_nth", "force_rate",
    "custom_width", "custom_height",
}, optional
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
         "-f", "lavfi", "-i", "testsrc=duration=2:size=64x48:rate=8",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
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

    import torch as th
    w, h, fps_num = 64, 48, 8

    video, path_out, audio, frames, fc, fps, width, height, dur = node.load_video(
        root2, video_path, False, 0.0, 0.0
    )
    assert os.path.normcase(path_out) == os.path.normcase(os.path.normpath(video_path)), path_out
    assert width == w and height == h, (width, height)
    assert abs(fps - fps_num) < 0.01, fps
    assert 14 <= fc <= 18, fc  # 容器元数据/估算的回退差异容忍 ±1
    assert 1.6 <= dur <= 2.4, dur  # 2s 视频
    # video_frames: 惰性路径下也解码, 形状 (N, H, W, 3) 且帧数与 frame_count 一致
    assert frames.ndim == 4 and frames.shape[3] == 3, tuple(frames.shape)
    assert frames.shape[0] == fc and frames.shape[1] == h and frames.shape[2] == w, tuple(frames.shape)

    # 6.8 音频输出: 波形与采样率
    assert audio is not None, "expected audio track in sample.mp4"
    wf = audio["waveform"]
    assert wf.ndim == 3 and wf.shape[0] == 1 and wf.shape[1] == 2, tuple(wf.shape)
    assert wf.shape[2] > 0, tuple(wf.shape)
    assert audio["sample_rate"] > 0, audio["sample_rate"]

    # 6. 无音轨视频: audio 输出应为 None
    _, _, audio_silent, *_ = node.load_video("", silent_path, False, 0.0, 0.0)
    assert audio_silent is None, audio_silent

    # 6.5 截取: start_time=0.25 后时长应减去 0.25s
    _, _, _, _, fc2, _, _, _, dur2 = node.load_video("", video_path, False, 0.25, 0.0)
    assert 1.2 <= dur2 <= 2.0, dur2
    assert 12 <= fc2 <= 16, fc2

    # 7. path 直接给完整视频路径(不经 Browse 选择)也能加载
    _, path3, *_ = node.load_video(video_path, "", False, 0.0, 0.0)
    assert os.path.normcase(path3) == os.path.normcase(os.path.normpath(video_path)), path3

    # 8. 帧控制参数(视频为 16 帧 @8fps, 64x48)
    # cap: 有界截取, video_frames 输出与帧数一致
    v_cap, _, a_cap, fr_cap, fc_cap, fps_cap, wd, ht, du_cap = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 4, 0, 0, 0, 0)
    assert fc_cap == 4 and abs(du_cap - 0.5) < 0.05, (fc_cap, du_cap)
    assert a_cap is not None  # 窗口内音频仍在
    assert fr_cap.shape[0] == 4, tuple(fr_cap.shape)

    # 完整加载(cap 大值触发 eager), 作为对照
    v_full, _, _, fr_full, fc_full, *_ = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 100, 0, 0, 0, 0)
    assert fc_full == 16, fc_full
    assert fr_full.shape[0] == 16, tuple(fr_full.shape)

    # skip: 跳过前 2 帧后取 4 帧, 内容应等于全量的第 2..5 帧
    v_skip, _, _, fr_skip, fc_skip, *_ = node.load_video(
        "", video_path, False, 0.0, 0.0, 2, 4, 0, 0, 0, 0)
    assert fc_skip == 4, fc_skip
    full_imgs = v_full.get_components().images
    assert th.allclose(full_imgs[2:6], fr_skip, atol=1e-4), "skip window mismatch"

    # force_rate: 8fps -> 16fps, 帧数约翻倍, 输出 fps=16
    v_rate, _, _, fr_rate, fc_rate, fps_rate, *_ = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 0, 0, 16, 0, 0)
    assert 30 <= fc_rate <= 34 and abs(fps_rate - 16.0) < 1e-6, (fc_rate, fps_rate)
    assert fr_rate.shape[0] == fc_rate, tuple(fr_rate.shape)

    # custom_size: 只给宽, 高按比例保持
    v_sz, _, _, fr_sz, _, _, wd_sz, ht_sz, _ = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 0, 0, 0, 32, 0)
    assert wd_sz == 32 and ht_sz == 48, (wd_sz, ht_sz)
    assert fr_sz.shape[2] == 32 and fr_sz.shape[1] == 48, tuple(fr_sz.shape)

    # select_every_nth: 每 2 帧取 1 帧 -> 8 帧, 有效帧率 4fps, 时长仍 2s
    v_nth, _, _, fr_nth, fc_nth, fps_nth, *_ , du_nth = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 0, 2, 0, 0, 0)
    assert fc_nth == 8 and abs(fps_nth - 4.0) < 1e-6 and abs(du_nth - 2.0) < 0.1, (fc_nth, fps_nth, du_nth)
    # 内容抽稀: nth=2 的第 k 帧应等于全量的第 2k 帧
    assert th.allclose(fr_nth[0], fr_full[0], atol=1e-4) and th.allclose(fr_nth[1], fr_full[2], atol=1e-4)

    # nth 与 cap 叠加: cap=4 -> 最终 4 帧
    _, _, _, fr_nc, fc_nc, *_ = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 4, 2, 0, 0, 0)
    assert fc_nc == 4 and fr_nc.shape[0] == 4, (fc_nc, tuple(fr_nc.shape))

    # 默认参数: 惰性路径(输出 VIDEO 可取帧率/尺寸)
    v_lazy, _, _, fr_lz, fc_lz, fps_lz, wd_lz, ht_lz, du_lz = node.load_video(
        "", video_path, False, 0.0, 0.0, 0, 0, 0, 0, 0)
    assert fc_lz == 16 and abs(fps_lz - 8.0) < 0.01 and abs(du_lz - 2.0) < 0.2, (fc_lz, fps_lz, du_lz)
    assert wd_lz == 64 and ht_lz == 48, (wd_lz, ht_lz)
    assert fr_lz.shape[0] == fc_lz, tuple(fr_lz.shape)

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

# 10. MyMoveFile: 单个/批量移动、重名跳过、覆盖 + VHS Filenames 输入
node_move = mod_move.MyMoveFile()
_move_types = node_move.INPUT_TYPES()
assert set(_move_types["required"]) == {"file_paths", "directory", "overwrite"}, _move_types
assert set(_move_types["optional"]) == {"filenames"}, _move_types
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

    # VHS_FILENAMES 规范形态 (save_output, [paths])
    c, d = _mk("c.txt"), _mk("d.txt")
    r5 = node_move.move("", mdir_dst, False, filenames=(True, [c, d]))
    assert r5["result"][0].count("moved:") == 2, r5
    assert os.path.isfile(os.path.join(mdir_dst, "c.txt"))

    # 批量嵌套形态 + 与 file_paths 去重(同一路径只移动一次)
    e = _mk("e.txt")
    r6 = node_move.move(e, mdir_dst, False, filenames=[(False, [e]), (True, [e])])
    assert r6["result"][0].count("moved:") == 1, r6
    assert "error" not in r6["result"][0], r6

    # 非路径标量(bool/空列表)被忽略, 不产生假路径
    r7 = node_move.move("", mdir_dst, False, filenames=(False, []))
    assert "no files to move" in r7["result"][0], r7

    # 空目录参数报错
    try:
        node_move.move([a], "  ", False)
        raise AssertionError("empty directory should raise")
    except ValueError:
        pass

# 11. MyMediaBrowser: 扫描结构 + 图片/视频加载
from PIL import Image

mb = mod_mb.MyMediaBrowser()
mb_types = mb.INPUT_TYPES()
assert set(mb_types["optional"]) == {"folder", "selected_file"}, mb_types["optional"]
assert mod_mb.IMAGE_EXTS and ".png" in mod_mb.IMAGE_EXTS
with tempfile.TemporaryDirectory() as broot:
    os.makedirs(os.path.join(broot, "pics"))
    png = os.path.join(broot, "p1.png")
    Image.new("RGB", (8, 6), (255, 0, 0)).save(png)
    vid = os.path.join(broot, "v1.mp4")
    # 生成一个极小 mp4: 用 ffmpeg 若可用, 否则跳过视频分支
    has_vid = False
    try:
        import imageio_ffmpeg
        subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=0.25:size=16x16:rate=8",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", vid],
            check=True,
        )
        has_vid = True
    except Exception:
        pass
    open(os.path.join(broot, "ignore.xyz"), "w").close()

    data = mod_mb.scan_media(broot, "")
    assert data["subdirs"] == ["pics"], data
    assert data["images"] == ["p1.png"], data
    assert "v1.mp4" in data["videos"] if has_vid else data["videos"] == [], data

    r = mb.run("", png)
    assert r[0] == os.path.normcase(os.path.normpath(png)) or r[0] == os.path.normpath(png), r[0]
    assert r[1].shape == (1, 6, 8, 3), tuple(r[1].shape)  # (1,H,W,3) float
    assert r[2] is None

    if has_vid:
        r2 = mb.run("", vid)
        assert r2[1] is None and r2[2] is not None, "video branch"
        r3 = mb.run(vid, "")  # path 直填完整路径
        assert r3[2] is not None, "path-as-file branch"

    # 目录与不支持类型
    try:
        mb.run("", os.path.join(broot, "ignore.xyz"))
        raise AssertionError("unsupported ext should raise")
    except ValueError:
        pass

# 12. MyLoadImageUnderPath: 核心 LoadImage 机制 + 任意路径(只输出 IMAGE + file_path)
li = mod_li.MyLoadImageUnderPath()
li_types = li.INPUT_TYPES()
assert "image" in li_types["required"]
assert set(li_types["optional"]) == {"folder"}
assert li.RETURN_TYPES == ("IMAGE", "STRING"), li.RETURN_TYPES
assert li.RETURN_NAMES == ("IMAGE", "file_path"), li.RETURN_NAMES
with tempfile.TemporaryDirectory() as iroot:
    p1 = os.path.join(iroot, "a.png")
    Image.new("RGB", (10, 4), (0, 255, 0)).save(p1)  # 无 alpha -> 不再有 MASK 输出
    p2 = os.path.join(iroot, "b_rgba.png")
    Image.new("RGBA", (8, 8), (0, 0, 255, 128)).save(p2)
    open(os.path.join(iroot, "b.txt"), "w").close()

    img, fpath = li.load_image(p1)  # 绝对路径
    assert img.shape == (1, 4, 10, 3), tuple(img.shape)
    assert abs(float(img[0, 0, 0, 1]) - 1.0) < 1e-6
    assert os.path.normcase(fpath) == os.path.normcase(os.path.normpath(p1)), fpath

    # 不产出 MASK: 即使存在同名伴生蒙版, 返回值个数也不变(蒙版唯一来源是 My Mask Editor)
    Image.new("L", (10, 4), 255).save(os.path.join(iroot, "a_mask.png"))
    out = li.load_image(p1)
    assert len(out) == 2, len(out)
    assert out[0].shape == (1, 4, 10, 3), tuple(out[0].shape)
    os.remove(os.path.join(iroot, "a_mask.png"))

    img2, fpath2 = li.load_image(p2)
    assert img2.shape == (1, 8, 8, 3), tuple(img2.shape)
    assert os.path.normcase(fpath2) == os.path.normcase(os.path.normpath(p2)), fpath2

    # 非图片扩展名 -> 报错
    try:
        li.load_image(os.path.join(iroot, "b.txt"))
        raise AssertionError("txt should raise")
    except Exception:
        pass

# 12.5 MyMaskEditor: 伴生蒙版文件约定(白=选中)
me = mod_me.MyMaskEditor()
me_types = me.INPUT_TYPES()
assert set(me_types["required"]) == {"file_path"}, me_types["required"]
assert me.RETURN_TYPES == ("MASK", "STRING"), me.RETURN_TYPES
with tempfile.TemporaryDirectory() as mroot:
    p1 = os.path.join(mroot, "a.png")
    Image.new("RGB", (10, 4), (0, 255, 0)).save(p1)
    import base64 as b64mod
    from io import BytesIO

    # 无蒙版文件: mask 全零, mask_path 空串
    out = me.run(p1)  # OUTPUT_NODE: 返回 {"ui":…, "result":…}
    mask, mpath = out["result"]
    assert mask.shape == (1, 4, 10), tuple(mask.shape)
    assert float(mask.max()) == 0.0 and mpath == "", (mpath, mask.max())

    # 保存蒙版(dataURL) -> 伴生文件生成 -> mask 输出为涂的内容
    mimg = Image.new("L", (10, 4), 255)  # 全白 = 全选
    buf = BytesIO()
    mimg.save(buf, format="PNG")
    data_url = "data:image/png;base64," + b64mod.b64encode(buf.getvalue()).decode()
    saved = mod_me.save_mask_file(p1, data_url)
    assert saved == mod_me.mask_path_for(p1) and os.path.isfile(saved), saved

    mask2, mpath2 = me.run(p1)["result"]
    assert mpath2 == saved, mpath2
    assert abs(float(mask2[0, 2, 5]) - 1.0) < 1e-6, float(mask2[0, 2, 5])  # 白=1

    # 蒙版尺寸与图片不一致: 最近邻对齐到图片尺寸
    m2 = Image.new("L", (5, 2), 200)
    buf2 = BytesIO()
    m2.save(buf2, format="PNG")
    mod_me.save_mask_file(p1, "data:image/png;base64," + b64mod.b64encode(buf2.getvalue()).decode())
    mask3, _ = me.run(p1)["result"]
    assert mask3.shape == (1, 4, 10), tuple(mask3.shape)
    assert abs(float(mask3[0, 0, 0]) - 200 / 255) < 0.01, float(mask3[0, 0, 0])

    # 非法 dataURL 报错
    try:
        mod_me.save_mask_file(p1, "not-a-dataurl")
        raise AssertionError("invalid dataURL should raise")
    except ValueError:
        pass

# 13. MySaveVideoToFolder: 参数结构 + 真实视频保存(端到端)
sv = mod_sv.MySaveVideoToFolder()
sv_types = sv.INPUT_TYPES()
assert set(sv_types["required"]) == {"video", "folder_path", "filename_prefix"}, sv_types["required"]
assert set(sv_types["optional"]) == {"format", "codec", "crf", "preview"}, sv_types["optional"]
assert sv.RETURN_NAMES == ("video", "saved_path"), sv.RETURN_NAMES
assert sv.OUTPUT_NODE is True

# 出队前校验: folder_path 为空/纯空格/引号包裹空串都要拦下
for bad in ("", "   ", '""'):
    r = sv.VALIDATE_INPUTS(bad)
    assert r is not True and "folder" in str(r), r
assert sv.VALIDATE_INPUTS("D:/videos/out") is True

# 辅助函数: 变量展开 / 计数器 / 目录解析
assert mod_sv._expand_vars("v_%year%", 0, 0).startswith("v_20"), mod_sv._expand_vars("v_%year%")
assert mod_sv._expand_vars("no_vars") == "no_vars"
with tempfile.TemporaryDirectory() as svdir:
    # 计数器: 空目录 -> 1; 已有 00001/00002 -> 3
    assert mod_sv._next_counter(svdir, "clip") == 1
    for n in ("clip_00001_.mp4", "clip_00002_.mp4", "other_00009_.mp4"):
        open(os.path.join(svdir, n), "w").close()
    assert mod_sv._next_counter(svdir, "clip") == 3, mod_sv._next_counter(svdir, "clip")

    # 目录自动创建(含多级)
    deep = os.path.join(svdir, "a", "b")
    resolved = mod_sv._resolve_folder(deep)
    assert os.path.isdir(resolved), resolved
    # 引号包裹的路径也能用
    assert mod_sv._resolve_folder(f'"{deep}"') == resolved
    # 空路径报错
    try:
        mod_sv._resolve_folder("   ")
        raise AssertionError("empty folder_path should raise")
    except ValueError:
        pass

    # 端到端: 用 imageio-ffmpeg 造视频 -> 经 My Load Video 读出 VIDEO -> Save Video 落盘
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        src = os.path.join(svdir, "src.mp4")
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=duration=0.5:size=64x48:rate=8",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", src],
            check=True,
        )
        video, *_ = node.load_video("", src, False, 0.0, 0.0)
        out_dir = os.path.join(svdir, "out")
        res = sv.save(video, out_dir, "saved_%width%x%height%", "auto", "auto", -1)
        saved_path = res["result"][1]
        assert os.path.isfile(saved_path), saved_path
        assert os.path.basename(saved_path).startswith("saved_64x48_00001_"), saved_path
        assert saved_path.endswith(".mp4"), saved_path
        assert res["result"][0] is video  # VIDEO 原样透传
        assert res["ui"]["mervyn_save_video"][0] == saved_path
        # 再存一次: 计数器递增到 00002, 不覆盖
        res2 = sv.save(video, out_dir, "saved_%width%x%height%", "auto", "auto", -1)
        assert os.path.basename(res2["result"][1]).startswith("saved_64x48_00002_"), res2["result"][1]
        assert os.path.isfile(saved_path)  # 原文件仍在
    except ImportError:
        pass

# 14. 结构性防呆: 所有节点的 INPUT_TYPES 输入名必须都能被执行方法接收
# (历史上三次崩溃都源于"加了输入忘了改签名", 这里统一拦住)
import inspect

for mod, cls_name in (
    (mod, "MyLoadVideoUnderPath"),
    (mod_li, "MyLoadImageUnderPath"),
    (mod_save, "MySaveImage"),
    (mod_move, "MyMoveFile"),
    (mod_code, "MyPythonCode"),
    (mod_mb, "MyMediaBrowser"),
    (mod_sv, "MySaveVideoToFolder"),
    (mod_me, "MyMaskEditor"),
):
    cls = getattr(mod, cls_name, None)
    if cls is None:
        continue
    types = cls.INPUT_TYPES()
    names = set(types.get("required") or {}) | set(types.get("optional") or {})
    fn_name = getattr(cls, "FUNCTION", None)
    assert fn_name, f"{cls_name}: missing FUNCTION"
    fn = getattr(cls, fn_name, None)
    assert callable(fn), f"{cls_name}.{fn_name} not callable"
    sig = inspect.signature(fn)
    accepts_kwargs = any(
        p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
    )
    if accepts_kwargs:
        continue
    missing = names - set(sig.parameters)
    assert not missing, (
        f"{cls_name}.{fn_name}() 缺少输入参数 {sorted(missing)} "
        f"(INPUT_TYPES 声明了但方法签名没有, 执行时会 TypeError)"
    )

print("smoke test OK")
