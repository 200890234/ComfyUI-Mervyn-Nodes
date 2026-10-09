# ComfyUI-Mervyn-Nodes

[English](README.md) | **中文**

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
| `My Ollama Vision` | 把图片（或 VHS 视频帧）交给本机 Ollama 视觉模型，反推提示词 |
| `My Save Image` | 把 IMAGE 保存到任意目录，支持重名跳过/覆盖，节点上直接显示保存结果 |
| `My Save Video to Folder` | 把 VIDEO 保存到任意目录（ComfyUI 自带 writer，兼容则流复制），文件名计数器永不覆盖 |
| `My Move File` | 把一个或多个文件移动到任意目录，支持重名跳过/覆盖，节点上直接显示移动结果；可直接接 VHS「Video Combine」的 Filenames 输出 |
| `My Python Code` | 执行一段自定义 Python 代码（V1：固定输入槽），变换数字/字符串输入并输出结果 |
| `My Python Code V2` | 同一套沙箱与输出，改用 V3 API + Autogrow，输入槽自动增长（`var_0`/`var_1`/…） |

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

`My Save Image`：输入 IMAGE，单张存 `前缀.png`，批量存 `前缀_00001.png` 起递增。`filename_prefix` 同样支持 `%width% %height% %year% %month% %day% %hour% %minute% %second%` 变量（与 `My Save Video to Folder` 对齐）。
`My Move File`：输入文件路径——`file_paths` 支持多行文本（每行一个路径）或上游传入的路径列表；不存在/为空的路径会在 status 中标记 `error` 并跳过，不中断整批。

可选输入 `filenames`（类型 `VHS_FILENAMES`）：直接接 VHS「Video Combine」的 Filenames 输出，其产出的视频会与 `file_paths` 一起移动（同一路径自动去重）。作用是替代 `JDCN_VHSFileMover`——按习惯搜 "move file" 就能找到，不必去记那个名字。未安装 VHS 时该插槽空置，不影响其他输入。

## My Python Code / My Python Code V2

两个节点共用完全相同的沙箱与执行语义（`nodes/my_python_code_core.py`），同一段代码在两边行为一致，差别只在输入槽：

| | My Python Code（V1） | My Python Code V2 |
|---|---|---|
| 输入槽 | 固定：`string_value` / `int_value` / `float_value` / `boolean_value` / `any1` / `any2` | 同样 4 个具名输入 + **自动增长**的槽位（上限 20 个） |
| 槽位变量名 | `any1` / `any2` | 按槽位顺序为 `var_0`、`var_1`、…（类型不限，可接 IMAGE/LATENT） |
| 接口 | 经典写法 | V3（`io.ComfyNode` + `io.Autogrow`） |
| 输出 | `string` / `int` / `float` / `boolean` / `any` | 完全相同 |

两者可并行存在：删掉任一个都不影响另一个（共享代码在独立模块里）。

- 在 `python_code` 里直接用变量名访问输入；给 `result_string` / `result_int` / `result_float` / `result_boolean` / `result_any` 赋值即产生对应输出。**未赋值的结果按端口类型给零值**：`""` / `0` / `0.0` / `False`（`any` 仍为 `None`）；显式赋值的原样透传。
- 内置函数采用白名单（类型转换、`len`/`sum`/`sorted`/`min`/`max`/`all`/`any`/`zip`/`enumerate`/`chr`/`ord`/`pow`/`hex`/`bin`、`getattr`/`isinstance`/`type` 等）；静态拒绝 `import` / `global` / `nonlocal`。
- 以下标准库已**预绑定**，直接用模块名即可，无需 import：`math`、`random`、`json`、`re`、`datetime`、`itertools`、`functools`、`string`。示例：`result_string = json.dumps({"n": math.floor(float_value)})`
- `import` 语句仍然禁用。唯一存在的 `__import__` 是受控版本，只为放行标准库内部的延迟导入（`datetime.strftime`/`date.today` 需要 `time`，`strptime` 需要 `_strptime`）；`os` / `sys` / `subprocess` 等一律拒绝。
- `now()` 是便捷的时间来源：`now()` 返回当前本地时间，格式 `%Y%m%d_%H%M%S`（如 `20261007_233437`）；`now("%Y")` 可传任意 `strftime` 格式。也可以用 `datetime.datetime.now().strftime(...)`。
- 缓存：代码里一旦用到非确定性入口（`now()`、`random.*`、`datetime.now()` 等），节点会强制每次重算——否则 ComfyUI 会把第一次的值缓存住，批量出图会拿到同一时间戳/同一随机数。不含这些入口的代码保持可缓存。
- 定位说明：沙箱只防意外，不防对抗。
- V2 输出说明：核心 V3 API 的 Autogrow 只支持**输入**（没有 `Autogrow.Output`，也没有 `DynamicOutput` 实现类），所以 V2 输出仍是固定的 5 个。动态输出槽需要自写前端 widget，暂不涉及。

## My Ollama Vision

- `images`：要分析的帧。直接接 VHS `Load Video` 的 **IMAGE** 输出（VHS 的 VAE 不要接，否则它第一路会变成 `LATENT`），也可以接任意单张图片
- `model`：**已拉取**的 Ollama 视觉模型。**模型名字不能证明它真能看图**——用 `ollama show <模型名>` 看 **Capabilities** 里有没有 `vision`。本机实测：`qwen3.5:9b` 有 `vision`，而 `gemma3:1b` / `qwen3:8b` / `gpt-oss:20b` 都没有
- `prompt`：要问什么。默认是"从这些帧反推一条视频提示词"
- `language`：**唯一决定输出语言的开关**，只有四个值——`auto`（默认）原样发送提示词，语言由 prompt / `system` 文本决定（想用别的语言就用它：写一句 `用日语回答。` 即可；直接写中文提示词通常也行，但"镜像输入语言"是倾向、不是保证）；`english` / `chinese` 会把指令追加到**提示词末尾**来强制该语言，这也是它能压过冲突 `system` 的原因（本机 qwen3.5 实测：追加在提示词末尾 3/3 生效，追加到 `system` 0/3）；`both` 要求输出两行带标记的答案并拆开，于是**英文进 `text`、中文进 `text_alt`**
- `english` / `chinese` / `both` 是**强制而非仅请求**：节点会检查回答的语言，不符就追加更硬的指令**重试一次**；仍旧不符时照常返回答案，并在 `info` 里标注 `language check still failing`——问题会暴露出来，而不是静默通过。（任何大模型都无法做到 100% 确定；本机实测中重试从未需要触发，因为追加的指令位于最后、权重最高。）
- 抽帧与压缩：按 `max_frames`（默认 6）**在整段视频里等间隔抽帧，且必定包含首尾帧**；每帧再等比缩放到长边 `max_side`（默认 768，填 0 表示保持原尺寸）并编码为 JPEG 后发送。所以 300 帧的视频只发 6 张小图，而不是 300 张原图
- 其他参数：`ollama_url`（默认 `http://127.0.0.1:11434`，会自动补 `/api/generate`；只填 `主机:端口` 或末尾带 `/` 都能识别）、`system`、`temperature`、`seed`、`num_predict`、`think`、`timeout`
- 输出：`text`（模型回答，也就是提示词；`language=both` 时是英文那份）、`info`（一行摘要：模型、发送帧数、token 数、耗时）、`text_alt`（仅 `language=both` 时有值，是另一种语言）。它们同时显示在节点上——选 `both` 时两个版本会叠在一起显示。`text_alt` 特意加在最后，所以已有的 `text`/`info` 连线不会错位
- 选了 `both` 但模型没有按 `EN:` / `ZH:` 标记输出时也不会丢内容：整段回答进 `text`，`text_alt` 留空，并在 `info` 里标注 `could not split EN/ZH`
- 缓存：输入不变时复用缓存，所以调整下游节点不会反复调用大模型。**想换一个结果就改 `seed`**
- `think` **默认关闭**：在"描述这些帧"这类任务上，推理会大量消耗输出 token（本机同一提示词实测：开启 157 输出 token，关闭仅 2 个），而描述质量没有提升。只对声明了思考能力的模型（如 `qwen3.5`）才有意义；非思考模型会直接报 `does not support thinking`
- 思考模型会**先**把一部分 `num_predict` 花在推理上，所以 `num_predict` 给小了可能一个字的答案都拿不到；这时节点会明确说明原因，而不是只抛一句 "empty response"。只要答案被截断，`info` 会标记 `truncated (num_predict reached)`
- 全部走本机 Ollama 的 `POST /api/generate`，不需要 API Key，数据不出本机。前提是 Ollama 正在运行（`ollama serve`）且已拉取视觉模型
- 首次调用较慢（要加载模型）：本机 `qwen3.5:9b` 处理 2 帧约 10 秒
- 失败时给明确报错而不是静默失败：连不上、超时、模型不存在（会提示 `ollama pull`）、返回为空，都会抛出可读信息

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
- `preview`：开关，打开后在节点上内嵌播放**执行时真正取用的那一段**
  - 区间由 `start_time` / `duration` 先截取，再由 `skip_first_frames` / `frame_load_cap` / `select_every_nth` / `force_rate` 收窄（公式与执行期完全一致），预览只播放这一段并循环
  - 改动上述任一参数会立即重算区间，并跳回区间起点重播（250ms 防抖）
  - 视频左下角角标显示当前区间与按参数算出的输出帧数/帧率，便于确认参数是否生效
  - 实现方式：`src` 用媒体片段 `#t=start,end` 交给内核限制播放范围，另加帧级看门狗兜底；同一文件只改 `#t=` 不会重新下载
  - `custom_width` / `custom_height` 的缩放、以及 `select_every_nth` 的抖动不影响画面（预览按源帧率播放）；拿不到 fps（探测失败）时退化为纯时间区间

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

> 注意：目录浏览与视频预览 API 会读取本机任意路径，仅供本地 ComfyUI 使用，请勿在暴露公网的实例上启用。

**前端用到的后端路由**

| 路由 | 说明 |
|------|------|
| `GET /mervyn/listdir?root=&rel=` | 列出某层目录的子目录与视频文件 |
| `GET /mervyn/video?path=` | 流式返回视频（支持 Range，前端 `#t=` 片段播放依赖它） |
| `GET /mervyn/videoinfo?path=` | 只读容器头返回 `fps` / `duration` / `width` / `height` / `frame_count_est`（毫秒级，按 mtime+size 缓存最近一个文件），前端据此算出与执行一致的截取窗口 |

## 开发

- `__init__.py` — 插件入口，维护 `NODE_CLASS_MAPPINGS` 与 `WEB_DIRECTORY`
- `nodes/` — 节点实现，按功能拆分模块
- `web/js/` — 前端扩展（动态下拉、节点内预览等界面逻辑）
- `tests/smoke_test.py` — 免启动冒烟测试：`conda run -n ComfyuiP python tests/smoke_test.py`
- `pyproject.toml` — Comfy Registry 发布元数据

节点开发文档：https://docs.comfy.org/essentials/custom-node-basics
