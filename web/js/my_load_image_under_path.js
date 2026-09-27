// My Load Image Under Path - core LoadImage mechanism + any-folder picker.
// Preview & right-click menus (Open/Copy/Save Image, Open in MaskEditor) come
// from the core frontend once node.imgs + previewMediaType are set.
// This extension only adds: ◀ name ▶ picker + column browse panel, writing the
// picked ABSOLUTE path into the hidden 'image' widget.
import { app } from "../../../scripts/app.js";

const NONE_LABEL = "(no images)";
const ERROR_LABEL = "(error)";
const POLL_MS = 300;
const CSS_ID = "mervyn-load-image-css";

// 三段选择器与列式浏览面板的样式(与 Load Video 保持一致的观感)
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
`;

function injectStyle() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function currentRoot(w) {
  return (w?.value || "").trim().replace(/^["']|["']$/g, "");
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

// 说明: 核心 MaskEditor 无法用于任意目录 ——
// 其 /view 加载拒绝绝对路径与目录外 subfolder(server.py: 539/551), 保存又强制
// 写回 input 目录。涂蒙版请使用 My Mask Editor 节点(接本节点的 file_path 输出)。

// 自建右键小菜单(预览图专用): 不依赖 litegraph/其他扩展的菜单管线
let _previewMenuEl = null;
function showPreviewMenu(x, y, items) {
  if (_previewMenuEl) _previewMenuEl.remove();
  const menu = document.createElement("div");
  menu.style.cssText =
    "position:fixed;z-index:10002;background:#1e1e1e;border:1px solid #555;" +
    "border-radius:6px;box-shadow:0 6px 20px rgba(0,0,0,.6);padding:4px 0;" +
    "font:12px/1.4 system-ui,sans-serif;color:#ddd;min-width:160px";
  for (const [label, fn] of items) {
    const it = document.createElement("div");
    it.textContent = label;
    it.style.cssText = "padding:5px 12px;cursor:pointer;white-space:nowrap";
    it.onmouseenter = () => { it.style.background = "#31465e"; };
    it.onmouseleave = () => { it.style.background = ""; };
    it.onclick = () => { menu.remove(); _previewMenuEl = null; fn(); };
    menu.appendChild(it);
  }
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - items.length * 26 - 12)}px`;
  document.body.appendChild(menu);
  _previewMenuEl = menu;
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    _previewMenuEl = null;
    document.removeEventListener("mousedown", close, true);
  };
  setTimeout(() => document.addEventListener("mousedown", close, true), 0);
}

// Copy Image (core LoadImage parity): PNG into clipboard, transcoding non-PNG
async function copyImageToClipboard(url) {
  try {
    const blob = await (await fetch(url)).blob();
    let png = blob;
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const cvs = document.createElement("canvas");
      cvs.width = bmp.width;
      cvs.height = bmp.height;
      cvs.getContext("2d").drawImage(bmp, 0, 0);
      png = await new Promise((r) => cvs.toBlob(r, "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } catch (err) {
    console.warn("[Mervyn] copy image failed:", err);
  }
}

app.registerExtension({
  name: "Mervyn.MyLoadImageUnderPath",
  // Right-click menu via the official new-API hook (bundle: collectNodeMenuItems
  // -> invokeExtensions('getNodeMenuItems', node).flat()).
  // "Open in Mask Editor" runs the same core command that the stock node uses.
  getNodeMenuItems(node) {
    console.debug("[Mervyn] getNodeMenuItems hook called, node =", node?.type, node?.comfyClass);
    if ((node.comfyClass ?? node.type) !== "MyLoadImageUnderPath") return [];
    const wImg = node.widgets?.find((w) => w.name === "image");
    const file =
      typeof wImg?.value === "string" && wImg.value && !wImg.value.startsWith("(")
        ? wImg.value
        : "";
    if (!file) return [];
    const url = `/mervyn/media?path=${encodeURIComponent(file)}`;
    // New-UI menu items use {label, action}; content/callback kept for the
    // legacy canvas menu pipeline.
    return [
      {
        label: "Open Image", content: "Open Image",
        action: () => window.open(url, "_blank"),
        callback: () => window.open(url, "_blank"),
      },
      {
        label: "Copy Image", content: "Copy Image",
        action: () => copyImageToClipboard(
          `/mervyn/media?path=${encodeURIComponent(file)}`),
        callback: () => copyImageToClipboard(
          `/mervyn/media?path=${encodeURIComponent(file)}`),
      },
      {
        label: "Save Image", content: "Save Image",
        action: () => {
          const a = document.createElement("a");
          a.href = `/mervyn/media?path=${encodeURIComponent(file)}`;
          a.download = file.split(/[\\/]/).pop() || "image.png";
          a.click();
        },
        callback: () => {
          const a = document.createElement("a");
          a.href = `/mervyn/media?path=${encodeURIComponent(file)}`;
          a.download = file.split(/[\\/]/).pop() || "image.png";
          a.click();
        },
      },
      null,
    ];
  },
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

      // Keep the image widget functional but out of sight; it stays in
      // node.widgets for serialization and for the core menus.
      if (wImage) {
        wImage.computeSize = () => [0, -4];
        wImage.draw = () => {};
      }

      // Mark as image node so the core draws the preview and provides
      // Open/Copy/Save Image + Open in MaskEditor menus (core parity).
      const setNodeImg = () => {
        const v = typeof wImage?.value === "string" ? wImage.value : "";
        const file = v && !v.startsWith("(") ? v : "";
        if (file) {
          node.previewMediaType = "image";
          node.imgs = [
            { src: `/mervyn/media?path=${encodeURIComponent(file)}`, filename: file },
          ];
        } else {
          node.imgs = null;
        }
      };

      let files = []; // absolute paths of images in the current folder
      let token = 0;
      let timer = null;
      const seen = { folder: wFolder?.value, file: wImage?.value };

      // ---- Picker: ◀ | filename (click = browse panel) | ▶ ----
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
          if (!files.length) return;
          let i = files.indexOf(wImage.value);
          i = ((i + dir) % files.length + files.length) % files.length;
          wImage.value = files[i];
          seen.file = wImage.value;
          applyPicked();
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

      // ---- Inline preview (works for any-folder absolute paths) ----
      const sizeBox = document.createElement("div");
      sizeBox.style.cssText = "padding:1px 6px;color:#9ad;font:11px/1.2 system-ui,sans-serif";
      const sizeWidget = node.addDOMWidget("size", "size", sizeBox);
      sizeWidget.serializeValue = () => "";
      let sizeToken = 0;
      const updateSize = (src) => {
        if (!src) { sizeBox.textContent = ""; return; }
        const myToken = ++sizeToken;
        const probe = new Image();
        probe.onload = () => {
          if (myToken !== sizeToken) return;
          sizeBox.textContent = `size: ${probe.naturalWidth} × ${probe.naturalHeight} px`;
        };
        probe.onerror = () => {
          if (myToken !== sizeToken) return;
          sizeBox.textContent = "size: (failed to load)";
        };
        probe.src = src;
      };
      const imgEl = document.createElement("img");
      imgEl.style.cssText = "width:100%;object-fit:contain;background:#000;border-radius:4px;display:none";
      const previewWidget = node.addDOMWidget("image_preview", "image_preview", imgEl);
      previewWidget.serializeValue = () => "";
      previewWidget.computeSize = () => {
        if (imgEl.style.display === "none") return [0, -4];
        const d = node._mervyn_dims;
        const h = d && d.w
          ? Math.round(Math.min(480, Math.max(48, node.width * (d.h / d.w))))
          : 240;
        return [node.width, h];
      };
      imgEl.onload = () => {
        node._mervyn_dims = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
      };
      // 预览图上右键: 弹自建小菜单(不依赖 litegraph 管线, 行为可控)
      imgEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = typeof wImage?.value === "string" ? wImage.value : "";
        if (!v || v.startsWith("(")) return;
        const url = `/mervyn/media?path=${encodeURIComponent(v)}`;
        showPreviewMenu(e.clientX, e.clientY, [
          ["Open Image", () => window.open(url, "_blank")],
          ["Copy Image", () => copyImageToClipboard(url)],
          ["Save Image", () => {
            const a = document.createElement("a");
            a.href = url;
            a.download = v.split(/[\\/]/).pop() || "image.png";
            a.click();
          }],
          // 核心 MaskEditor 强制走 input 目录, 与任意目录互斥;
          // 涂蒙版请使用 My Mask Editor 节点(接本节点的 file_path 输出)
        ]);
      });

      // Widget order: folder, pick, size, image(hidden), preview, upload widgets last
      const order = ["folder", "pick", "size", "image", "image_preview", "file_upload"];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      const refreshFileUI = () => {
        const v = typeof wImage?.value === "string" ? wImage.value : "";
        const display = v && !v.startsWith("(")
          ? `🖼 ${v.split(/[\\/]/).pop()}`
          : v || "🖼 (no image)";
        btn.textContent = display;
        btn.title = `${v}\n(click to browse)`;
        // preview follows the picked file
        if (v && !v.startsWith("(")) {
          const src = `/mervyn/media?path=${encodeURIComponent(v)}`;
          if (imgEl.dataset.path !== src) {
            imgEl.dataset.path = src;
            imgEl.src = src;
          }
          imgEl.style.display = "";
          updateSize(src);
        } else {
          imgEl.dataset.path = "";
          imgEl.style.display = "none";
          imgEl.removeAttribute("src");
          node._mervyn_dims = null;
          updateSize("");
        }
        setNodeImg();
      };

      const applyPicked = () => {
        refreshFileUI();
        node.setDirtyCanvas(true, true);
      };

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
            wImage.value = full;
            seen.file = full;
            applyPicked();
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
        if (panel) { closePanel(); return; }
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
        panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 560))}px`;
        panel.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 330))}px`;
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

      const refresh = async () => {
        const myToken = ++token;
        const root = currentRoot(wFolder);
        if (!root) {
          files = [];
          refreshFileUI();
          node.setDirtyCanvas(true, true);
          return;
        }
        try {
          const data = await listMedia(root);
          if (myToken !== token) return;
          files = data.images.map((n) => joinPath(root, n));
          // keep previously picked absolute paths selectable
          wImage.options.values = [
            ...new Set([...files, ...wImage.options.values.filter(
              (v) => typeof v === "string" && v && !v.startsWith("(")
            )]),
          ];
          if (files.length && !files.includes(wImage.value)) {
            wImage.value = files[0];
          }
          seen.file = wImage.value;
          refreshFileUI();
        } catch (err) {
          if (myToken !== token) return;
          files = [];
          refreshFileUI();
        }
        node.setDirtyCanvas(true, true);
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), POLL_MS);
      };

      const onFolderChanged = () => scheduleRefresh();

      // Event path 1: widget callback (only when still a widget)
      if (wFolder) wFolder.callback = () => onFolderChanged();

      // Event path 2: draw-time polling (linked values never touch widget.value)
      node.onDrawBackground = function () {
        // 每帧重设 imgs: 前端预览刷新会清掉非输出节点的 node.imgs,
        // 不重设的话核心 "Open in Mask Editor" 点击时守卫失败静默返回
        setNodeImg();
        if (wFolder && wFolder.value !== seen.folder) {
          seen.folder = wFolder.value;
          onFolderChanged();
        }
        if (wImage && wImage.value !== seen.file) {
          seen.file = wImage.value;
          refreshFileUI();
        }
      };

      // 实例级右键菜单(旧画布菜单路径): 前端会给原型统一挂 getExtraMenuOptions
      // 并覆盖任何原型注入, 实例属性优先级更高且不被覆盖
      node.getExtraMenuOptions = function (_, options) {
        const file = typeof wImage?.value === "string" && wImage.value && !wImage.value.startsWith("(")
          ? wImage.value : "";
        if (!file) return options;
        const url = `/mervyn/media?path=${encodeURIComponent(file)}`;
        options.unshift(
          { content: "Open Image", callback: () => window.open(url, "_blank") },
          { content: "Copy Image", callback: () => copyImageToClipboard(url) },
          {
            content: "Save Image",
            callback: () => {
              const a = document.createElement("a");
              a.href = url;
              a.download = file.split(/[\\/]/).pop() || "image.png";
              a.click();
            },
          },
          null,
        );
        return options;
      };

      refreshFileUI();
      if (currentRoot(wFolder)) refresh();

      return result;
    };
  },
});
