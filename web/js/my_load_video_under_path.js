// My Load Video Under Path - frontend extension
// Browse: 列式浏览面板(子目录逐级向右展开); preview: 节点内嵌视频预览。
// 导航状态存于 node.properties.mervyn_rel, 随工作流保存/恢复。
import { app } from "../../../scripts/app.js";

const NONE_LABEL = "(no video files)";
const ERROR_LABEL = "(error)";
const POLL_MS = 300;
const STYLE_ID = "mervyn-dir-panel-style";

const CSS = `
.mervyn-dir-panel{position:fixed;z-index:10000;display:flex;max-width:min(720px,90vw);max-height:320px;overflow-x:auto;overflow-y:hidden;background:#1e1e1e;border:1px solid #444;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);font:12px/1.4 system-ui,sans-serif;color:#ccc}
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

function parentRel(rel) {
  const parts = rel.split("/");
  parts.pop();
  return parts.join("/");
}

function currentRoot(wPath) {
  return (wPath.value || "").trim().replace(/^["']|["']$/g, "");
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

      // Browse 按钮
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mervyn-browse-btn";
      btn.textContent = "📁 Browse…";
      btn.title = "Browse directories (expands rightward)";
      const browseWidget = node.addDOMWidget("browse", "browse", btn);
      browseWidget.serializeValue = () => "";

      const order = ["path", "browse", "video_file", "preview", "video_preview"];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let rel = "";
      let token = 0;
      let timer = null;
      const seen = { path: wPath.value, file: wFile.value, preview: !!wPreview.value };

      const updateBrowseLabel = () => {
        btn.textContent = rel ? `📁 ${rel}` : "📁 Browse…";
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
          refreshPreview();
          node.setDirtyCanvas(true, true);
          return;
        }
        try {
          const data = await listDir(root, rel);
          if (myToken !== token) return;
          const fulls = data.videos.map((n) => joinPath(root, rel, n));
          wFile.options.values = fulls.length ? fulls : [NONE_LABEL];
          if (!fulls.includes(wFile.value)) wFile.value = fulls[0] ?? NONE_LABEL;
          seen.file = wFile.value;
          refreshPreview();
        } catch (err) {
          if (myToken !== token) return;
          wFile.options.values = [`${ERROR_LABEL}: ${err.message}`];
          wFile.value = wFile.options.values[0];
          seen.file = wFile.value;
          refreshPreview();
        }
        node.setDirtyCanvas(true, true);
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), POLL_MS);
      };

      const onPathChanged = () => {
        rel = "";
        node.properties.mervyn_rel = "";
        updateBrowseLabel();
        scheduleRefresh();
      };

      // ---- 列式浏览面板 ----
      let panel = null;
      let outsideHandler = null;
      let escHandler = null;

      const closePanel = () => {
        if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
        if (escHandler) document.removeEventListener("keydown", escHandler, true);
        outsideHandler = escHandler = null;
        if (panel) panel.remove();
        panel = null;
      };

      const appendColumn = async (root, columnRel, afterEl) => {
        if (!panel) return;
        let child = afterEl ? afterEl.nextElementSibling : panel.firstElementChild;
        while (child) {
          const next = child.nextElementSibling;
          child.remove();
          child = next;
        }
        const col = document.createElement("div");
        col.className = "mervyn-dir-col";
        col.innerHTML = `<div class="mervyn-dir-loading">loading…</div>`;
        panel.appendChild(col);
        panel.scrollLeft = panel.scrollWidth;
        let data;
        try {
          data = await listDir(root, columnRel);
        } catch (err) {
          col.innerHTML = `<div class="mervyn-dir-empty">${ERROR_LABEL}: ${err.message}</div>`;
          return;
        }
        if (!panel) return;
        col.innerHTML = "";

        const head = document.createElement("div");
        head.className = "mervyn-dir-head";
        head.textContent = columnRel ? columnRel.split("/").pop() : "(root)";
        head.title = columnRel || root;
        col.appendChild(head);

        if (columnRel) {
          const up = document.createElement("div");
          up.className = "mervyn-dir-item";
          up.textContent = "..";
          up.onclick = () =>
            appendColumn(root, parentRel(columnRel), col.previousElementSibling);
          col.appendChild(up);
        }

        for (const name of data.subdirs) {
          const item = document.createElement("div");
          item.className = "mervyn-dir-item";
          item.textContent = `📁 ${name}`;
          const childRel = columnRel ? `${columnRel}/${name}` : name;
          item.onclick = () => appendColumn(root, childRel, col);
          col.appendChild(item);
        }

        for (const name of data.videos) {
          const full = joinPath(root, columnRel, name);
          const item = document.createElement("div");
          item.className = "mervyn-dir-item";
          item.textContent = `🎞 ${name}`;
          item.title = full;
          if (full === wFile.value) item.classList.add("selected");
          item.onclick = () => {
            rel = columnRel;
            node.properties.mervyn_rel = rel;
            wFile.value = full;
            seen.file = full;
            updateBrowseLabel();
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
        document.body.appendChild(panel);
        const rect = btn.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - 560));
        const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 330));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        appendColumn(root, rel || "");
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
      wFile.callback = () => refreshPreview();
      wPreview.callback = () => refreshPreview();

      // 事件路径 2: onDrawBackground 轮询兜底
      node.onDrawBackground = function () {
        if (wPath.value !== seen.path) {
          seen.path = wPath.value;
          onPathChanged();
        }
        if (wFile.value !== seen.file) {
          seen.file = wFile.value;
          refreshPreview();
        }
        if (!!wPreview.value !== seen.preview) {
          seen.preview = !!wPreview.value;
          refreshPreview();
        }
      };

      // 工作流加载后恢复导航状态
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        rel = (node.properties.mervyn_rel || "").replace(/\\/g, "/");
        updateBrowseLabel();
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
