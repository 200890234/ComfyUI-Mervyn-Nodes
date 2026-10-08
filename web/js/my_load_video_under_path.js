// My Load Video Under Path - frontend extension
// Browse: 列式浏览面板(子目录逐级向右展开); preview: 节点内嵌视频预览。
// 导航即 path: 进入子目录/返回上级都会更新 path 字段值(Kiko 同款)。
import { app } from "../../../scripts/app.js";

const NONE_LABEL = "(no video files)";
const ERROR_LABEL = "(error)";
const POLL_MS = 300;
const STYLE_ID = "mervyn-dir-panel-style";

const CSS = `
.mervyn-dir-panel{position:fixed;z-index:10000;background:#1e1e1e;border:1px solid #444;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);font:12px/1.4 system-ui,sans-serif;color:#ccc}
.mervyn-dir-strip{display:flex;max-width:min(720px,90vw);max-height:320px;overflow-x:auto;overflow-y:hidden;border-radius:8px}
.mervyn-dir-close{position:absolute;top:4px;right:4px;width:22px;height:22px;background:#333;color:#eee;border:1px solid #666;border-radius:50%;cursor:pointer;font-size:12px;line-height:20px;text-align:center;z-index:1}
.mervyn-dir-close:hover{background:#555}
.mervyn-dir-col{min-width:170px;max-width:170px;max-height:318px;overflow-y:auto;border-right:1px solid #3a3a3a;padding:4px}
.mervyn-dir-col:last-child{border-right:none}
.mervyn-dir-head{padding:4px 6px;font-weight:600;color:#9ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #333;margin-bottom:2px}
.mervyn-dir-item{padding:4px 6px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mervyn-dir-item:hover{background:#2e2e2e}
.mervyn-dir-item.selected{background:#31465e;color:#cfe4ff}
.mervyn-dir-empty{padding:4px 6px;color:#777;font-style:italic}
.mervyn-dir-loading{padding:8px;color:#777}
.mervyn-browse-btn{display:block;width:100%;padding:6px 8px;cursor:pointer;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:6px;font-size:13px;text-align:left}
.mervyn-browse-btn:hover{background:#333}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function joinPath(root, rel, name) {
  const base = root.replace(/[\\/]+$/, "");
  const mid = rel ? "/" + rel : "";
  return `${base}${mid}/${name}`;
}

function currentRoot(wPath) {
  return (wPath.value || "").trim().replace(/^["']|["']$/g, "");
}

function parentDir(p) {
  const norm = p.replace(/[\\/]+$/, ""); // 去掉结尾斜杠
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (idx <= 0) return idx === -1 ? p : norm.slice(0, idx + 1); // 根目录无上级
  return norm.slice(0, idx + 1); // 保留结尾斜杠
}

async function listDir(root, rel) {
  const qs = new URLSearchParams({ root, rel });
  const res = await fetch(`/mervyn/listdir?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

app.registerExtension({
  name: "Mervyn.MyLoadVideoUnderPath",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyLoadVideoUnderPath") return;
    console.debug("[Mervyn] MyLoadVideoUnderPath extension registered");

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);
      injectStyle();

      const wPath = node.widgets.find((w) => w.name === "path");
      const wFile = node.widgets.find((w) => w.name === "video_file");
      const wPreview = node.widgets.find((w) => w.name === "preview");
      // 影响"截取窗口"的参数(与后端 load_video 的窗口公式一一对应)
      const wStart = node.widgets.find((w) => w.name === "start_time");
      const wDur = node.widgets.find((w) => w.name === "duration");
      const wSkip = node.widgets.find((w) => w.name === "skip_first_frames");
      const wCap = node.widgets.find((w) => w.name === "frame_load_cap");
      const wNth = node.widgets.find((w) => w.name === "select_every_nth");
      const wRate = node.widgets.find((w) => w.name === "force_rate");
      const wWin = [wStart, wDur, wSkip, wCap, wNth, wRate].filter(Boolean);
      // video_file 原生下拉由三段式选择器替代, 塌缩隐藏(仍在 widgets 数组中序列化)
      if (wFile) {
        wFile.computeSize = () => [0, -4];
        wFile.draw = () => {}; // 禁用画布文字绘制, 避免与相邻控件重叠
      }

      // 内嵌视频预览: 外层 box 承载播放器 + 区间角标(角标绝对定位, 不参与布局计算)
      const box = document.createElement("div");
      box.style.cssText = "position:relative;width:100%;display:none";
      const videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.loop = true;
      // 默认静音: 浏览器会拦截"带声音的自动播放", play() 会被 reject(下面的 catch 又吞掉了),
      // 结果预览根本不会自动播。muted 是自动播放的前提; 需要听声音时用播放器控件手动取消静音。
      videoEl.muted = true;
      videoEl.defaultMuted = true;
      videoEl.preload = "metadata";
      videoEl.style.width = "100%";
      videoEl.style.minWidth = "256px";
      videoEl.style.objectFit = "contain";
      videoEl.style.background = "#000";
      // display:block 而非默认的 inline —— 行盒会在 height 之外再添一段基线空隙(约 4px),
      // 导致画面溢出去盖住下一个控件(overlap)
      videoEl.style.display = "block";
      const badge = document.createElement("div");
      badge.style.cssText =
        "position:absolute;left:8px;bottom:8px;max-width:calc(100% - 16px);padding:2px 7px;" +
        "border-radius:5px;background:rgba(0,0,0,.62);color:#cfe4ff;font:11px/1.5 system-ui,sans-serif;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none";
      box.append(videoEl, badge);
      const previewWidget = node.addDOMWidget("video_preview", "video_preview", box);
      previewWidget.serializeValue = () => "";
      previewWidget.computeSize = () =>
        box.style.display === "none" ? [0, -4] : [node.width, 240];

      // 三段式选择器: ◀ | 当前文件名(点击=列式浏览面板) | ▶
      const btn = document.createElement("button"); // 面板定位锚点 = 中段
      btn.type = "button";
      const pickBox = document.createElement("div");
      pickBox.style.cssText = "display:flex;width:100%";
      const mkNav = (label, dir) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = dir < 0 ? "Previous video in folder" : "Next video in folder";
        b.style.cssText = "flex:0 0 44px;background:#2a2a2a;color:#ddd;border:1px solid #444;cursor:pointer;font-size:13px;" +
          (dir < 0 ? "border-radius:6px 0 0 6px" : "border-radius:0 6px 6px 0");
        b.onclick = () => {
          const vals = (wFile.options.values || []).filter(
            (v) => typeof v === "string" && v && !v.startsWith("(")
          );
          if (!vals.length) return;
          let i = vals.indexOf(wFile.value);
          i = ((i + dir) % vals.length + vals.length) % vals.length;
          wFile.value = vals[i];
          seen.file = wFile.value;
          refreshFileUI();
          refreshPreview();
          node.setDirtyCanvas(true, true);
        };
        return b;
      };
      btn.className = "mervyn-browse-btn";
      btn.style.cssText = "flex:1;border-radius:0;border-left:none;border-right:none";
      btn.textContent = "📁 (no file)";
      btn.title = "Click to browse directories";
      pickBox.append(mkNav("◀", -1), btn, mkNav("▶", 1));
      const pickWidget = node.addDOMWidget("pick", "pick", pickBox);
      pickWidget.serializeValue = () => "";

      // 控件顺序: path, 三段选择器, 各帧参数(含 select_every_nth), preview 开关, 视频预览区(最底)
      // 注意: select_every_nth 必须列入, 否则会落到默认档(99)被排到节点最底部
      const order = [
        "path", "pick",
        "start_time", "duration", "skip_first_frames", "frame_load_cap",
        "select_every_nth", "force_rate", "custom_width", "custom_height",
        "preview", "video_preview",
      ];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let token = 0;
      let timer = null;
      // 截取窗口相关参数的签名, 用于轮询兜底检测变化
      const winKey = () =>
        [wStart, wDur, wSkip, wCap, wNth, wRate]
          .map((w) => (w ? String(w.value) : "-"))
          .join("|");
      const seen = {
        path: wPath.value,
        file: wFile.value,
        preview: !!wPreview.value,
        win: winKey(),
      };

      // 中段按钮显示当前文件名(或状态占位)
      const refreshFileUI = () => {
        const v = typeof wFile.value === "string" ? wFile.value : "";
        const display = v && !v.startsWith("(")
          ? `🎞 ${v.split(/[\\/]/).pop()}`
          : v || "📁 (no file)";
        btn.textContent = display;
        btn.title = `${v}\n(click to browse)`;
      };

      // ---------- 选区预览: 只播放执行时真正会取用的那一段 ----------
      const numOf = (w) => {
        const v = w ? Number(w.value) : 0;
        return Number.isFinite(v) ? v : 0;
      };
      const infoCache = new Map();   // 视频路径 -> { info, at }
      const INFO_RETRY_MS = 10000;   // 探测失败 10s 后允许重试(文件可能刚写完)
      let activeWin = null;          // 当前正在播放的区间
      let rafId = 0;

      const fetchInfo = async (file) => {
        const hit = infoCache.get(file);
        if (hit && (hit.info || Date.now() - hit.at < INFO_RETRY_MS)) return hit.info;
        let info = null;
        try {
          const res = await fetch(`/mervyn/videoinfo?path=${encodeURIComponent(file)}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data && data.fps > 0) info = data;
        } catch (err) {
          info = null;
        }
        infoCache.set(file, { info, at: Date.now() });
        return info;
      };

      // 与后端 load_video 的窗口公式保持一致(改一处必须同步改另一处):
      //   eff_start = start_time + skip_first_frames / src_fps
      //   eff_dur   = frame_load_cap>0 ? cap*nth/out_rate : length_eff - skip/src_fps
      //   out_rate  = force_rate>0 ? force_rate : src_fps,  nth_eff = select_every_nth||1
      const computeWindow = (info) => {
        const start = Math.max(0, numOf(wStart));
        const dur = Math.max(0, numOf(wDur));
        const skip = Math.max(0, Math.round(numOf(wSkip)));
        const cap = Math.max(0, Math.round(numOf(wCap)));
        const nth = Math.max(0, Math.round(numOf(wNth)));
        const rate = Math.max(0, Math.round(numOf(wRate)));
        const fps = info && info.fps > 0 ? info.fps : 0;
        const total =
          info && info.duration > 0
            ? info.duration
            : Number.isFinite(videoEl.duration) && videoEl.duration > 0
              ? videoEl.duration
              : 0;

        // duration=0 表示"到结尾": 先算出剩余时长
        const lengthEff = dur > 0 ? dur : total > 0 ? Math.max(0, total - start) : 0;
        if (lengthEff <= 0) return null;
        if (!(fps > 0)) {
          // 拿不到 fps(探测失败)时退化成纯时间区间, 帧控制参数无法体现
          return { start, end: start + lengthEff, fps: 0, frames: 0, exact: false };
        }
        const outRate = rate > 0 ? rate : fps;
        const nthEff = nth > 0 ? nth : 1;
        const effStart = start + skip / fps;
        const effDur =
          cap > 0 ? (cap * nthEff) / outRate : Math.max(0, lengthEff - skip / fps);
        if (!(effDur > 0)) return null;
        const effFps = outRate / nthEff;          // 抽帧后有效帧率(播放时长不变)
        const frames = Math.max(0, Math.round(effDur * effFps));
        const end = total > 0 ? Math.min(total, effStart + effDur) : effStart + effDur;
        return {
          start: effStart,
          end,
          fps: effFps,
          frames,
          // 没动帧控制参数时就是原生区间, 角标里不必再提
          exact: !(skip > 0 || cap > 0 || nth > 0 || rate > 0),
        };
      };

      const updateBadge = (win) => {
        if (!win) {
          badge.textContent = "";
          return;
        }
        const secs = (v) => `${v.toFixed(2)}s`;
        const parts = [`${secs(win.start)} → ${secs(win.end)}`, `区间 ${secs(win.end - win.start)}`];
        if (win.frames > 0) parts.push(`≈${win.frames} 帧 @${win.fps.toFixed(2)}fps`);
        if (!win.exact) parts.push("含帧控制");
        badge.textContent = parts.join(" · ");
        badge.title = badge.textContent;
      };

      // #t= 片段结束点若被内核忽略, 用帧级看门狗把播放钉回区间起点
      const clampToWindow = () => {
        if (!activeWin) return;
        if (videoEl.currentTime >= activeWin.end - 0.03) {
          try {
            videoEl.currentTime = activeWin.start;
          } catch (err) {
            /* 元数据未就绪时忽略 */
          }
        }
      };
      const guardLoop = () => {
        rafId = 0;
        if (videoEl.paused || !box.isConnected) return;
        clampToWindow();
        rafId = requestAnimationFrame(guardLoop);
      };
      videoEl.addEventListener("play", () => {
        if (!rafId) rafId = requestAnimationFrame(guardLoop);
      });
      videoEl.addEventListener("timeupdate", clampToWindow);
      videoEl.addEventListener("loadedmetadata", () => {
        if (activeWin) {
          try {
            videoEl.currentTime = activeWin.start;
          } catch (err) {
            /* ignore */
          }
        }
        videoEl.play().catch(() => {});
      });

      const showBox = (visible) => {
        box.style.display = visible ? "block" : "none";
        videoEl.style.height = visible ? "240px" : "0px";
        // 开/关后都按当前控件重新计算节点高度(避免节点只增不减)。
        // 先同步算一次让布局立即跟上, 再延后一帧按 <video> 的最终布局复算一次,
        // 防止展开预览时节点高度算少而把画面裁掉/挤到控件上
        const fitNode = () => node.setSize([node.size[0], node.computeSize()[1]]);
        fitNode();
        requestAnimationFrame(fitNode);
        node.setDirtyCanvas(true, true);
      };

      const refreshPreview = async () => {
        const on = !!wPreview.value;
        const file =
          typeof wFile.value === "string" && wFile.value && !wFile.value.startsWith("(")
            ? wFile.value
            : "";
        if (!on || !file) {
          activeWin = null;
          videoEl.dataset.src = "";
          videoEl.pause();
          videoEl.removeAttribute("src");
          if (videoEl.load) videoEl.load();   // 中断在途请求
          updateBadge(null);
          showBox(false);
          return;
        }

        const info = await fetchInfo(file);
        // 探测期间预览被关掉 / 又换了文件 -> 丢弃这次结果
        if (!wPreview.value || String(wFile.value || "") !== file) return;

        const win = computeWindow(info);
        const url = `/mervyn/video?path=${encodeURIComponent(file)}`;
        const frag = win && win.end > win.start + 0.001
          ? `#t=${win.start.toFixed(3)},${win.end.toFixed(3)}`
          : "";
        const src = url + frag;
        activeWin = win;
        updateBadge(win);
        if (box.style.display === "none") showBox(true);   // 仅显隐变化时才重算节点高度

        // 只改 #t= 片段: 同一文件不会重新下载, 浏览器只应用新区间并重新 seek
        if (videoEl.dataset.src !== src) {
          videoEl.dataset.src = src;
          videoEl.src = src;
        }
        if (win) {
          try {
            videoEl.currentTime = win.start;   // 参数一变就回到区间起点重播
          } catch (err) {
            /* 元数据未就绪时由 loadedmetadata 兜底 */
          }
        }
        videoEl.play().catch(() => {});
      };

      let winTimer = null;
      const scheduleWindow = () => {
        clearTimeout(winTimer);
        winTimer = setTimeout(() => {
          refreshPreview();
        }, 250);
      };

      const refresh = async () => {
        const myToken = ++token;
        const root = currentRoot(wPath);
        if (!root) {
          wFile.options.values = [NONE_LABEL];
          wFile.value = NONE_LABEL;
          seen.file = wFile.value;
          refreshFileUI();
          refreshPreview();
          node.setDirtyCanvas(true, true);
          return;
        }
        try {
          const data = await listDir(root, "");
          if (myToken !== token) return;
          const fulls = data.videos.map((n) => joinPath(root, "", n));
          wFile.options.values = fulls.length ? fulls : [NONE_LABEL];
          if (!fulls.includes(wFile.value)) wFile.value = fulls[0] ?? NONE_LABEL;
          seen.file = wFile.value;
          refreshFileUI();
          refreshPreview();
        } catch (err) {
          if (myToken !== token) return;
          wFile.options.values = [`${ERROR_LABEL}: ${err.message}`];
          wFile.value = wFile.options.values[0];
          seen.file = wFile.value;
          refreshFileUI();
          refreshPreview();
        }
        node.setDirtyCanvas(true, true);
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), POLL_MS);
      };

      const onPathChanged = () => {
        scheduleRefresh();
      };

      // ---- 列式浏览面板 ----
      let panel = null;   // 外壳: 定位 + 关闭按钮(不滚动)
      let strip = null;   // 内层条带: 列容器(横向滚动)
      let outsideHandler = null;
      let escHandler = null;

      const closePanel = () => {
        if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
        if (escHandler) document.removeEventListener("keydown", escHandler, true);
        outsideHandler = escHandler = null;
        if (panel) panel.remove();
        panel = strip = null;
      };

      // 导航 = 更新 path(值即当前目录), 再在面板里追加对应列
      const navigateTo = (newPath, anchorCol) => {
        wPath.value = newPath;
        seen.path = newPath;
        refresh();
        if (strip) appendColumn(newPath, anchorCol);
      };

      const appendColumn = async (dirPath, afterEl) => {
        if (!strip) return;
        let child = afterEl ? afterEl.nextElementSibling : strip.firstElementChild;
        while (child) {
          const next = child.nextElementSibling;
          child.remove();
          child = next;
        }
        const col = document.createElement("div");
        col.className = "mervyn-dir-col";
        col.innerHTML = `<div class="mervyn-dir-loading">loading…</div>`;
        strip.appendChild(col);
        strip.scrollLeft = strip.scrollWidth;
        let data;
        try {
          data = await listDir(dirPath, "");
        } catch (err) {
          col.innerHTML = `<div class="mervyn-dir-empty">${ERROR_LABEL}: ${err.message}</div>`;
          return;
        }
        if (!panel) return;
        col.innerHTML = "";

        const head = document.createElement("div");
        head.className = "mervyn-dir-head";
        const seg = dirPath.split(/[\\/]/).filter(Boolean);
        head.textContent = seg[seg.length - 1] || dirPath;
        head.title = dirPath;
        col.appendChild(head);

        const parent = parentDir(dirPath);
        if (parent && parent !== dirPath) {
          const up = document.createElement("div");
          up.className = "mervyn-dir-item";
          up.textContent = "..";
          up.onclick = () => navigateTo(parent, col.previousElementSibling);
          col.appendChild(up);
        }

        for (const name of data.subdirs) {
          const item = document.createElement("div");
          item.className = "mervyn-dir-item";
          item.textContent = `📁 ${name}`;
          item.onclick = () => navigateTo(joinPath(dirPath, "", name), col);
          col.appendChild(item);
        }

        for (const name of data.videos) {
          const full = joinPath(dirPath, "", name);
          const item = document.createElement("div");
          item.className = "mervyn-dir-item";
          item.textContent = `🎞 ${name}`;
          item.title = full;
          if (full === wFile.value) item.classList.add("selected");
          item.onclick = () => {
            wFile.value = full;
            seen.file = full;
            refreshFileUI();
            refreshPreview();
            closePanel();
            node.setDirtyCanvas(true, true);
          };
          col.appendChild(item);
        }

        if (!data.subdirs.length && !data.videos.length) {
          const empty = document.createElement("div");
          empty.className = "mervyn-dir-empty";
          empty.textContent = "(empty)";
          col.appendChild(empty);
        }
      };

      const openPanel = () => {
        if (panel) {
          closePanel();
          return;
        }
        const root = currentRoot(wPath);
        if (!root) return;
        panel = document.createElement("div");
        panel.className = "mervyn-dir-panel";
        strip = document.createElement("div");
        strip.className = "mervyn-dir-strip";
        panel.appendChild(strip);
        const closeBtn = document.createElement("button");
        closeBtn.className = "mervyn-dir-close";
        closeBtn.textContent = "✕";
        closeBtn.title = "Close (Esc)";
        closeBtn.onclick = closePanel;
        panel.appendChild(closeBtn);
        document.body.appendChild(panel);
        const rect = btn.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 560));
        const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 330));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        appendColumn(root, null);
        outsideHandler = (e) => {
          if (panel && !panel.contains(e.target) && !btn.contains(e.target)) closePanel();
        };
        escHandler = (e) => {
          if (e.key === "Escape") closePanel();
        };
        document.addEventListener("mousedown", outsideHandler, true);
        document.addEventListener("keydown", escHandler, true);
      };

      btn.addEventListener("click", openPanel);
      node.onRemoved = () => {
        closePanel();
        clearTimeout(timer);
        clearTimeout(winTimer);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        activeWin = null;
        videoEl.pause();
        videoEl.removeAttribute("src");
        nodeType.prototype.onRemoved?.apply(node, arguments);
      };

      // 事件路径 1: widget callback(部分前端版本支持)
      wPath.callback = () => onPathChanged();
      wPreview.callback = () => refreshPreview();
      for (const w of wWin) {
        w.callback = () => {
          seen.win = winKey();
          scheduleWindow();
        };
      }

      // 事件路径 2: onDrawBackground 轮询兜底
      node.onDrawBackground = function () {
        if (wPath.value !== seen.path) {
          seen.path = wPath.value;
          onPathChanged();
        }
        if (wFile.value !== seen.file) {
          seen.file = wFile.value;
          refreshFileUI();
          refreshPreview();
        }
        if (!!wPreview.value !== seen.preview) {
          seen.preview = !!wPreview.value;
          refreshPreview();
        }
        const key = winKey();
        if (key !== seen.win) {
          // 截取参数变化 -> 重算区间并从头重播(防抖, 拖数字时不抖动)
          seen.win = key;
          scheduleWindow();
        }
      };

      refreshFileUI();

      // 工作流加载后刷新列表
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        refresh();
      };

      if (wPath.value) refresh();
      else {
        wFile.options.values = [NONE_LABEL];
        wFile.value = NONE_LABEL;
      }

      return result;
    };
  },
});
