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
      // video_file 原生下拉由三段式选择器替代, 塌缩隐藏(仍在 widgets 数组中序列化)
      if (wFile) {
        wFile.computeSize = () => [0, -4];
        wFile.draw = () => {}; // 禁用画布文字绘制, 避免与相邻控件重叠
      }

      // 内嵌视频预览
      const videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.loop = true;
      videoEl.preload = "metadata";
      videoEl.style.width = "100%";
      videoEl.style.minWidth = "256px";
      videoEl.style.objectFit = "contain";
      videoEl.style.background = "#000";
      videoEl.style.display = "none";
      const previewWidget = node.addDOMWidget("video_preview", "video_preview", videoEl);
      previewWidget.serializeValue = () => "";
      previewWidget.computeSize = () =>
        videoEl.style.display === "none" ? [0, -4] : [node.width, 240];

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

      // 控件顺序: path, 三段选择器, 各帧参数, preview 开关, 视频预览区(最底)
      const order = [
        "path", "pick",
        "start_time", "duration", "skip_first_frames", "frame_load_cap",
        "force_rate", "custom_width", "custom_height",
        "preview", "video_preview",
      ];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let token = 0;
      let timer = null;
      const seen = { path: wPath.value, file: wFile.value, preview: !!wPreview.value };

      // 中段按钮显示当前文件名(或状态占位)
      const refreshFileUI = () => {
        const v = typeof wFile.value === "string" ? wFile.value : "";
        const display = v && !v.startsWith("(")
          ? `🎞 ${v.split(/[\\/]/).pop()}`
          : v || "📁 (no file)";
        btn.textContent = display;
        btn.title = `${v}\n(click to browse)`;
      };

      const refreshPreview = () => {
        const on = !!wPreview.value;
        const file =
          typeof wFile.value === "string" && wFile.value && !wFile.value.startsWith("(")
            ? wFile.value
            : "";
        if (on && file) {
          if (videoEl.dataset.path !== file) {
            videoEl.dataset.path = file;
            videoEl.src = `/mervyn/video?path=${encodeURIComponent(file)}`;
          }
          videoEl.style.display = "";
          videoEl.style.height = "240px";
        } else {
          videoEl.dataset.path = "";
          videoEl.style.display = "none";
          videoEl.style.height = "0px";
          videoEl.pause();
          videoEl.removeAttribute("src");
        }
        // 开/关后都按当前控件重新计算节点高度(避免节点只增不减)
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
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
        nodeType.prototype.onRemoved?.apply(node, arguments);
      };

      // 事件路径 1: widget callback(部分前端版本支持)
      wPath.callback = () => onPathChanged();
      wPreview.callback = () => refreshPreview();

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
