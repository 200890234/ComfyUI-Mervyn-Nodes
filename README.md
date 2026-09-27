# ComfyUI-Mervyn-Nodes

Mervyn 的 ComfyUI 自定义节点包。

## 安装

手动 clone 到 ComfyUI 的节点目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/200890234/ComfyUI-Mervyn-Nodes.git
```

发布到 Comfy Registry 后，也可直接在 ComfyUI Manager 中搜索 `ComfyUI-Mervyn-Nodes` 安装。

## 节点列表

| 节点 | 说明 |
|------|------|
| `My Load Video Under Path` | 浏览任意目录（可逐层进入子目录）并加载选中的视频文件，支持节点内预览 |
| `My Load Image Under Path` | 任意目录选图（三段式选择器 + 列式浏览面板 + 内嵌预览 + 尺寸回显），输出 IMAGE + file_path，右键 Open/Save Image |
| `My Mask Editor` | 任意目录图片上涂蒙版（画/擦/粗细/软度/撤销/Fill/Invert/Clear），蒙版存为图片旁 `<同名>_mask.png`，输出 MASK |
| `My Media Browser` | 节点内联网格浏览任意目录的图片/视频/子目录（视频自动播放 + 面包屑 + 分页 + 收藏目录），选中即输出 IMAGE/VIDEO |
| `My Save Image` | 把 IMAGE 保存到任意目录，支持重名跳过/覆盖，节点上直接显示保存结果 |
| `My Save Video to Folder` | 把 VIDEO 保存到任意目录（ComfyUI 自带 writer，兼容则流复制），文件名计数器永不覆盖 |
| `My Move File` | 把一个或多个文件移动到任意目录，支持重名跳过/覆盖，节点上直接显示移动结果 |
| `My Python Code` | 执行一段自定义 Python 代码，变换数字/字符串输入并输出结果 |
| `My Example Node` | 示例节点（占位，可删） |

## My Media Browser

- `folder`：任意根目录，填入后节点内直接展开网格（无需弹窗）
- 网格：图片缩略图 + 视频自动静音循环播放小窗（comfyui-browser 同款体验），面包屑（`›` 分隔）逐级进入子目录（只列当前层，进入即更新 folder 值），游标分页（初始 20 项 + Load more）
- 收藏：收藏栏可把 folder 加入 favorites（localStorage 全局保存，跨工作流共享），点击收藏快速切换，✕ 移除
- 点击图片/视频 → 选中（格子高亮）+ 灯箱大预览（视频可拖进度条，Range 流式；✕ / 点空白 / Esc 关闭）
- 输出：`selected_file`（完整路径）+ `image`（选中图片时的 IMAGE，否则 None）+ `video`（选中视频时的 VIDEO，否则 None）
- `selected_file` 输入可连接，也支持 `folder` 直填完整媒体路径（跳过浏览直接加载）

## My Load Image Under Path

- `folder`：任意图片目录；三段式选择器（◀ 文件名 ▶）——左右箭头同目录循环切换，中间点击弹列式浏览面板（进入子目录即更新 folder）
- 选中即内嵌预览（高度按图片宽高比自适应，`size` 只读框显示原始宽高）；无需执行即可看到
- 输出：`image`（1,H,W,3，EXIF 方向修正）+ `file_path`（选中文件的绝对路径，接给 `My Mask Editor`）
- 设计说明：选中即用绝对路径，不做 input 目录桥接上传（任意目录场景）。**本节点不输出 MASK**——蒙版的唯一事实源是 `My Mask Editor`（接本节点的 `file_path` 涂蒙版，输出 `mask`），避免同一份 `<同名>_mask.png` 出现两个输出端造成歧义
- 因走绝对路径，本节点**不含**核心的 `Open in Mask Editor` 菜单（该功能依赖 input 目录，原因见下方 `My Mask Editor` 小节的限制说明）

## My Mask Editor

- `file_path`：要涂蒙版的图片（接 `My Load Image Under Path` 的 `file_path` 输出，或直接填绝对路径）
- 节点内画布：画笔/橡皮、粗细、不透明度、软度、Undo/Redo、Fill、Invert、Clear
- 保存：每次笔触后自动保存（防抖 800ms），写成图片同目录的 `<同名>_mask.png`（白=选中、黑=排除）
- 输出：`mask`（1,H,W，1=选中区；未涂过则全零）+ `mask_path`（实际使用的蒙版文件，无则空）
- 与 `My Load Image Under Path` 配合：Load Image 取 `file_path` → 本节点涂蒙版 → 输出 `mask`（两节点分工：加载归加载、蒙版归蒙版）
- **设计说明（限制）**：核心的 MaskEditor 弹窗（右键 `Open in Mask Editor`）**无法用于任意目录**——加载走 `/view`（拒绝绝对路径与非 input 子目录），保存走 `/upload/mask`（强制写回 `input/clipspace/`）。因此本包的蒙版能力**只能是一个独立节点**：无法内嵌进 `My Load Image Under Path`，也无法像 Pixaroma 那样复用核心弹窗（那些做法的前提是图片必须位于 ComfyUI 的 input 目录内）

## My Save Video to Folder

行为对齐社区同类节点（ChrisColeTech/ComfyUI-Get-Random-File 的 Save Video to Folder）：

- `video`：接收 VIDEO（如 `My Load Video Under Path` 的输出）
- `folder_path`：任意绝对目录，不存在自动创建（去首尾引号，支持 `~`）
- `filename_prefix`：支持 `%width% %height% %year% %month% %day% %hour% %minute% %second%` 变量；自动追加 stock 风格计数器 `_00001_`，**永不覆盖**已有文件
- `format` / `codec` / `crf`（可选）：走 ComfyUI 自带 writer——**格式兼容时直接流复制**（快、无损），仅当格式/编码器/指定 crf 需要时才重新编码；`crf = -1` 交给 ComfyUI 决定，设为 0-51 会强制重编码
- 输出：`video`（原样透传，便于串接后续节点）+ `saved_path`（保存后的完整路径）
- 节点上直接展示保存路径与摘要（分辨率 / 体积），执行后即见

## My Save Image / My Move File

两个节点的公共行为：
- `directory`：任意绝对路径（不局限于 output），不存在自动创建
- `overwrite`：默认 False；False 时目标重名则跳过该文件（不写入/不移动），True 时覆盖
- `status` / `moved_path` 输出：逐文件的 `saved/moved: <路径>` 或 `skipped (already exists): <路径>`；`moved_path` 为实际写入的完整路径（跳过时不含）
- 两个值同时渲染在节点上（执行后立即更新，随工作流保存），无需接预览节点即可看到结果

`My Save Image`：输入 IMAGE，单张存 `前缀.png`，批量存 `前缀_00001.png` 起递增。
`My Move File`：输入文件路径——`file_paths` 支持多行文本（每行一个路径）或上游传入的路径列表；不存在/为空的路径会在 status 中标记 `error` 并跳过，不中断整批。

## My Python Code

- 输入：`string_value` / `int_value` / `float_value` / `boolean_value` / `any1` / `any2`（均为可选输入端口）
- 输出：`string` / `int` / `float` / `boolean` / `any`
- 在 `python_code` 里直接用上面的变量名访问输入；给 `result_string` / `result_int` / `result_float` / `result_boolean` / `result_any` 赋值即产生对应输出（未赋值输出 None）
- 内置函数采用白名单（len/str/int/float/range/sorted/sum 等），禁用 import/global；数据流内使用足够，不是防对抗沙箱

## My Load Video Under Path

- `path`：根目录路径（如 `D:/videos`），输入后自动刷新；也可直接填完整视频文件路径（跳过浏览直接加载）
- `Browse`：列式浏览面板，子目录逐级向右展开（Finder 风格）；每层列出该层的子目录与视频，点击视频即选中；`..` 返回上一级，点击面板外或按 Esc 关闭
- `video_file`：选中的视频文件（完整路径）；所有输入（path / video_file / preview / start_time / duration）均可转换为输入端口由上游驱动
- `start_time` / `duration`：截取区间（秒），0 表示从头开始 / 播放到结尾
- `skip_first_frames` / `frame_load_cap`：跳过前 N 帧 / 最多加载 N 帧（0 = 不限制）
- `select_every_nth`：每 N 帧取 1 帧抽稀（0 = 保留全部）；有效帧率变为 force_rate/N，输出时长不变
- `force_rate`：重采样到指定帧率（慢放补帧、快放丢帧），0 = 原生
- `custom_width` / `custom_height`：加载时缩放，只填一边则保持比例
- 帧控制参数全部默认时保持惰性加载（不解码）；任一启用时按窗口收窄后有界解码，输出的 VIDEO 同步反映重采样/缩放结果
- `preview`：开关，打开后在节点上内嵌播放选中的视频

**输出**

| 端口 | 类型 | 说明 |
|------|------|------|
| `video` | VIDEO | 视频对象（含音轨）；需要单独的帧序列/音频时接核心 `GetVideoComponents` 节点 |
| `file_path` | STRING | 选中视频的完整路径 |
| `audio` | AUDIO | 音频轨（浮点波形，可在音频类节点间传递）；文件无音轨时为空 |
| `video_frames` | IMAGE | 解码后的视频帧批次（N,H,W,3），可直接接图像类节点；使用帧控制参数时与 VIDEO 输出内容一致 |
| `frame_count` | INT | 总帧数 |
| `fps` | FLOAT | 帧率 |
| `width` | INT | 宽（像素） |
| `height` | INT | 高（像素） |
| `duration` | FLOAT | 时长（秒，按截取区间修正） |
- 输出：`video`（VIDEO 类型，可接入视频处理节点）、`file_path`（完整路径字符串）

> 注意：目录浏览与视频预览 API 会读取本机任意路径，仅供本地 ComfyUI 使用，请勿在暴露公网的实例上启用。

## 开发

- `__init__.py` — 插件入口，维护 `NODE_CLASS_MAPPINGS` 与 `WEB_DIRECTORY`
- `nodes/` — 节点实现，按功能拆分模块
- `nodes/example.py` — 示例节点，可修改或删除
- `web/js/` — 前端扩展（动态下拉、节点内预览等界面逻辑）
- `tests/smoke_test.py` — 免启动冒烟测试：`conda run -n ComfyuiP python tests/smoke_test.py`
- `pyproject.toml` — Comfy Registry 发布元数据

节点开发文档：https://docs.comfy.org/essentials/custom-node-basics
