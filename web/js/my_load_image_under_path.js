// My Load Image Under Path - 三段式选择器(◀ 文件名 ▶) + 列式浏览面板 + 内嵌图片预览
// + 右键菜单 Open Image / Save Image(对齐核心 LoadImage)。
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const PAGE_DIR_CSS_ID = "mervyn-dir-panel-css"; // 与 Load Video 共用一套面板样式
const NONE_LABEL = "(no images)";
const ERROR_LABEL = "(error)";
const POLL_MS = 300;

const CSS = `
.mervyn-browse-btn{display:block;width:100%;padding:6px 8px;background:#2a2a2a;color:#ddd;border:1px solid #444;cursor:pointer;font-size:12px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mervyn-browse-btn:hover{background:#333}
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
.mervyn-img-preview img{width:100%;height:240px;object-fit:contain;background:#000;border-radius:4px;display:block}
`;

function injectStyle() {
  if (document.getElementById(PAGE_DIR_CSS_ID)) return;
  const s = document.createElement("style");
  s.id = PAGE_DIR_CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function currentRoot(w) {
  return (w.value || "").trim().replace(/^["']|["']$/g, "");
}

function joinPath(dir, name) {
  const base = dir.replace(/[\\/]+$/, "");
  return `${base}/${name}`;
}

function parentDir(p) {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  if (idx <= 0) return idx === -1 ? p : norm.slice(0, idx + 1);
  return norm.slice(0, idx + 1);
}

async function listMedia(root) {
  const qs = new URLSearchParams({ root, rel: "" });
  const res = await fetch(`/mervyn/listmedia?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

app.registerExtension({
  name: "Mervyn.MyLoadImageUnderPath",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyLoadImageUnderPath") return;
    console.debug("[Mervyn] MyLoadImageUnderPath extension registered");

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);
      injectStyle();

      const wFolder = node.widgets.find((w) => w.name === "folder");
      const wImage = node.widgets.find((w) => w.name === "image");
      if (wImage) wImage.computeSize = () => [0, -4]; // 原生下拉塌缩隐藏(仍序列化)

      // 桥接: 把任意路径图片上传副本到 input/mervyn, 让核心 MaskEditor 标准流程可用。
      // 桥接名 -> 原始绝对路径 的映射存在 node.properties.mervyn_src(随工作流保存)。
      const srcMap = node.properties.mervyn_src || (node.properties.mervyn_src = {});
      const baseOf = (p) => p.split(/[\\/]/).pop();
      const uploadBridge = async (abs) => {
        if (srcMap[abs]) return srcMap[abs];
        const blob = await fetch(`/mervyn/media?path=${encodeURIComponent(abs)}`)
          .then((r) => {
            if (!r.ok) throw new Error(`fetch source failed (${r.status})`);
            return r.blob();
          });
        const form = new FormData();
        form.append("image", blob, baseOf(abs));
        form.append("subfolder", "mervyn");
        form.append("type", "input");
        const res = await api.fetchApi("/upload/image", { method: "POST", body: form });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const bridged = data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
        srcMap[abs] = bridged;
        return bridged;
      };
      const pickFile = async (abs, cell) => {
        try {
          wImage.value = await uploadBridge(abs);
        } catch (err) {
          console.warn("[Mervyn] bridge upload failed, fallback to abs path:", err);
          wImage.value = abs; // 桥接失败时回退直读绝对路径
        }
        seen.file = wImage.value;
        refreshFileUI();
        refreshPreview();
        node.setDirtyCanvas(true, true);
        if (cell) showLightbox({ kind: "image", path: abs }, cell);
      };

      // 三段式选择器: ◀ | 文件名(点击=浏览面板) | ▶
      const btn = document.createElement("button");
      btn.type = "button";
      const pickBox = document.createElement("div");
      pickBox.style.cssText = "display:flex;width:100%";
      const mkNav = (label, dir) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = dir < 0 ? "Previous image in folder" : "Next image in folder";
        b.style.cssText = "flex:0 0 44px;background:#2a2a2a;color:#ddd;border:1px solid #444;cursor:pointer;font-size:13px;" +
          (dir < 0 ? "border-radius:6px 0 0 6px" : "border-radius:0 6px 6px 0");
        b.onclick = () => {
          const vals = (wImage.options.values || []).filter(
            (v) => typeof v === "string" && v && !v.startsWith("(")
          );
          if (!vals.length) return;
          let i = vals.indexOf(wImage.value);
          i = ((i + dir) % vals.length + vals.length) % vals.length;
          pickFile(vals[i]);
        };
        return b;
      };
      btn.className = "mervyn-browse-btn";
      btn.style.cssText = "flex:1;border-radius:0;border-left:none;border-right:none";
      btn.textContent = "🖼 (no image)";
      btn.title = "Click to browse directories";
      pickBox.append(mkNav("◀", -1), btn, mkNav("▶", 1));
      const pickWidget = node.addDOMWidget("pick", "pick", pickBox);
      pickWidget.serializeValue = () => "";

      // 内嵌图片预览(选中即显示, 无需执行); widget 高度按图片宽高比自适应
      const imgEl = document.createElement("img");
      imgEl.style.width = "100%";
      imgEl.style.height = "100%";
      imgEl.style.objectFit = "contain"; // 双保险: 即便容器比例不匹配也不拉伸
      imgEl.style.background = "#000";
      imgEl.style.borderRadius = "4px";
      imgEl.style.display = "none";
      const previewWidget = node.addDOMWidget("image_preview", "image_preview", imgEl);
      previewWidget.serializeValue = () => "";
      previewWidget.computeSize = () => {
        if (imgEl.style.display === "none") return [0, -4];
        const d = node._mervyn_dims;
        if (!d || !d.w) return [node.width, 240];
        const h = Math.round(Math.min(480, Math.max(48, node.width * (d.h / d.w))));
        return [node.width, h];
      };

      // 尺寸回显(对齐核心 LoadImage)
      const wSize = node.addWidget("text", "size", "", () => {}, { multiline: false });
      wSize.disabled = true;
      wSize.serializeValue = () => node._mervyn_size || "";
      imgEl.onload = () => {
        node._mervyn_dims = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
        node._mervyn_size = `${imgEl.naturalWidth} × ${imgEl.naturalHeight} px`;
        wSize.value = node._mervyn_size;
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
      };

      // 控件顺序: folder, pick, image(隐藏), size, 预览
      const order = ["folder", "pick", "image", "size", "image_preview"];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let token = 0;
      let timer = null;
      const seen = { folder: wFolder.value, file: wImage.value };

      const refreshFileUI = () => {
        const v = typeof wImage.value === "string" ? wImage.value : "";
        const clean = v.split(" [")[0]; // 去掉可能的 " [temp]" 注解尾巴
        const display = clean && !clean.startsWith("(")
          ? `🖼 ${baseOf(clean)}`
          : clean || "🖼 (no image)";
        btn.textContent = display;
        btn.title = `${v}\n(click to browse)`;
      };

      const refreshPreview = () => {
        const raw = typeof wImage.value === "string" ? wImage.value : "";
        const name = raw.split(" [")[0];
        const ann = raw.match(/\[([a-z]+)\]\s*$/i)?.[1]?.toLowerCase() || "";
        let src = "";
        if (name && !name.startsWith("(")) {
          const abs = Object.entries(srcMap).find(([, b]) => b === name)?.[0];
          if (abs) src = `/mervyn/media?path=${encodeURIComponent(abs)}`;
          else if (name.includes(":") || name.startsWith("\\\\")) {
            src = `/mervyn/media?path=${encodeURIComponent(name)}`;
          } else {
            // 桥接副本或 MaskEditor 保存的结果: 走核心 /view
            const type = ann === "output" ? "output" : "input";
            src = `/view?filename=${encodeURIComponent(baseOf(name))}&type=${type}&subfolder=`;
          }
        }
        if (src) {
          if (imgEl.dataset.path !== src) {
            imgEl.dataset.path = src;
            imgEl.src = src;
          }
          imgEl.style.display = "";
        } else {
          imgEl.dataset.path = "";
          imgEl.style.display = "none";
          imgEl.removeAttribute("src");
          node._mervyn_dims = null;
          node._mervyn_size = "";
          wSize.value = "";
        }
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
      };

      const refresh = async () => {
        const myToken = ++token;
        const root = currentRoot(wFolder);
        if (!root) {
          wImage.options.values = [NONE_LABEL];
          wImage.value = NONE_LABEL;
          seen.file = wImage.value;
          refreshFileUI();
          refreshPreview();
          node.setDirtyCanvas(true, true);
          return;
        }
        try {
          const data = await listMedia(root);
          if (myToken !== token) return;
          const fulls = data.images.map((n) => joinPath(root, n));
          wImage.options.values = fulls.length ? fulls : [NONE_LABEL];
          if (!fulls.includes(wImage.value)) wImage.value = fulls[0] ?? NONE_LABEL;
          seen.file = wImage.value;
          refreshFileUI();
          refreshPreview();
        } catch (err) {
          if (myToken !== token) return;
          wImage.options.values = [`${ERROR_LABEL}: ${err.message}`];
          wImage.value = wImage.options.values[0];
          seen.file = wImage.value;
          refreshFileUI();
          refreshPreview();
        }
        node.setDirtyCanvas(true, true);
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), POLL_MS);
      };

      const onFolderChanged = () => scheduleRefresh();

      // ---- 列式浏览面板(与 Load Video 同款交互, 进入子目录即更新 folder) ----
      let panel = null;
      let strip = null;
      let outsideHandler = null;
      let escHandler = null;

      const closePanel = () => {
        if (outsideHandler) document.removeEventListener("mousedown", outsideHandler, true);
        if (escHandler) document.removeEventListener("keydown", escHandler, true);
        outsideHandler = escHandler = null;
        if (panel) panel.remove();
        panel = strip = null;
      };

      const navigateTo = (newPath, anchorCol) => {
        wFolder.value = newPath;
        seen.folder = newPath;
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
          data = await listMedia(dirPath);
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
          item.onclick = () => navigateTo(joinPath(dirPath, name), col);
          col.appendChild(item);
        }

        for (const name of data.images) {
          const full = joinPath(dirPath, name);
          const item = document.createElement("div");
          item.className = "mervyn-dir-item";
          item.textContent = `🖼 ${name}`;
          item.title = full;
          if (full === wImage.value) item.classList.add("selected");
          item.onclick = () => {
            pickFile(full, cell);
            closePanel();
          };
          col.appendChild(item);
        }

        if (!data.subdirs.length && !data.images.length) {
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
        const root = currentRoot(wFolder);
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

      // 右键菜单: 对齐核心 LoadImage 的 Open Image / Save Image
      nodeType.prototype.getExtraMenuOptions = function (_, options) {
        const file = typeof wImage.value === "string" && wImage.value && !wImage.value.startsWith("(")
          ? wImage.value : "";
        if (file) {
          const url = `/mervyn/media?path=${encodeURIComponent(file)}`;
          options.unshift(
            {
              content: "Open Image",
              callback: () => window.open(url, "_blank"),
            },
            {
              content: "Save Image",
              callback: () => {
                const a = document.createElement("a");
                a.href = url;
                a.download = file.split(/[\\/]/).pop() || "image.png";
                a.click();
              },
            },
            null, // 分隔线
          );
        }
        return options;
      };

      // 事件路径 1: widget callback(部分前端版本支持)
      wFolder.callback = () => onFolderChanged();

      // 事件路径 2: onDrawBackground 轮询兜底
      node.onDrawBackground = function () {
        if (wFolder.value !== seen.folder) {
          seen.folder = wFolder.value;
          onFolderChanged();
        }
        if (wImage.value !== seen.file) {
          seen.file = wImage.value;
          refreshFileUI();
          refreshPreview();
        }
      };

      // 工作流加载后恢复(mervyn_src 随工作流载入, 重指向映射)
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        Object.assign(srcMap, node.properties.mervyn_src || {});
        refreshFileUI();
        wSize.value = node._mervyn_size || "";
        refreshPreview();
        if (currentRoot(wFolder)) refresh();
      };

      refreshFileUI();
      if (currentRoot(wFolder)) refresh();

      return result;
    };
  },
});

