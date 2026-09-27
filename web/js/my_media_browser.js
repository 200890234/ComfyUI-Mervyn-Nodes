// My Media Browser - 节点内联网格: 填目录直接显示图片/视频缩略窗, 无需弹窗。
// 面包屑逐级进入子目录; 游标分页; 收藏目录(localStorage 全局); 选中内联大预览。
import { app } from "../../../scripts/app.js";

const PAGE_SIZE = 20;
const FAVS_KEY = "mervyn_media_favs";
const CSS_ID = "mervyn-mb-inline-css";

const CSS = `
.mervyn-mb{display:flex;flex-direction:column;gap:4px;width:100%}
.mervyn-mb-favs{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.mervyn-mb-fav{display:inline-flex;align-items:center;gap:4px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:12px;padding:2px 8px;cursor:pointer;font-size:11px}
.mervyn-mb-fav:hover{background:#333}
.mervyn-mb-fav .x{color:#f77;font-weight:bold;padding-left:2px}
.mervyn-mb-addfav{background:#234;color:#adf;border-color:#346}
.mervyn-mb-crumbs{display:flex;flex-wrap:wrap;gap:2px;align-items:center}
.mervyn-mb-crumb{background:none;border:none;color:#9ad;cursor:pointer;padding:2px 3px;font-size:11px}
.mervyn-mb-crumb:hover{text-decoration:underline}
.mervyn-mb-sep{color:#666;padding:0 3px;font-weight:bold}
.mervyn-mb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;height:280px;overflow-y:auto;padding:2px}
.mervyn-mb-cell{background:#151515;border:1px solid #333;border-radius:6px;padding:3px;cursor:pointer;position:relative}
.mervyn-mb-cell:hover{border-color:#5af}
.mervyn-mb-cell.selected{border-color:#9ad;box-shadow:0 0 0 1px #9ad}
.mervyn-mb-thumb{width:100%;height:84px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:4px;background:#0d0d0d}
.mervyn-mb-thumb img{max-width:100%;max-height:100%;object-fit:contain}
.mervyn-mb-thumb video{width:100%;height:100%;object-fit:contain}
.mervyn-mb-name{font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#bbb}
.mervyn-mb-more{display:block;margin:2px auto;padding:3px 14px;background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:11px}
.mervyn-mb-empty{grid-column:1/-1;padding:12px;text-align:center;color:#777;font-style:italic}
.mervyn-mb-lightbox{position:fixed;z-index:10001;background:#141414;border:1px solid #555;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);padding:6px}
.mervyn-mb-lightbox img,.mervyn-mb-lightbox video{max-width:min(560px,72vw);max-height:min(420px,64vh);object-fit:contain;display:block;border-radius:4px}
.mervyn-mb-lightbox .close{position:absolute;top:-9px;right:-9px;width:22px;height:22px;background:#333;color:#eee;border:1px solid #666;border-radius:50%;cursor:pointer;font-size:12px;line-height:20px;text-align:center}
.mervyn-mb-lightbox .close:hover{background:#555}
`;

function injectStyle() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function currentRoot(w) {
  return (w.value || "").trim().replace(/^["']|["']$/g, "");
}

function joinPath(root, rel, name) {
  const base = root.replace(/[\\/]+$/, "");
  const mid = rel ? "/" + rel : "";
  return `${base}${mid}/${name}`;
}

async function listMedia(root, rel) {
  const qs = new URLSearchParams({ root, rel });
  const res = await fetch(`/mervyn/listmedia?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getFavs() {
  try { return JSON.parse(localStorage.getItem(FAVS_KEY)) || []; }
  catch { return []; }
}

function setFavs(favs) {
  localStorage.setItem(FAVS_KEY, JSON.stringify(favs));
}

app.registerExtension({
  name: "Mervyn.MyMediaBrowser",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyMediaBrowser") return;
    console.debug("[Mervyn] MyMediaBrowser extension registered");

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);
      injectStyle();

      const wFolder = node.widgets.find((w) => w.name === "folder");
      const wFile = node.widgets.find((w) => w.name === "selected_file");

      // 内联浏览器容器: 收藏栏 + 面包屑 + 网格 + 分页 + 预览
      const box = document.createElement("div");
      box.className = "mervyn-mb";
      box.innerHTML = `
        <div class="mervyn-mb-favs"></div>
        <div class="mervyn-mb-crumbs"></div>
        <div class="mervyn-mb-grid"></div>
        <button class="mervyn-mb-more" style="display:none"></button>`;
      const wBox = node.addDOMWidget("browser", "browser", box);
      wBox.serializeValue = () => "";
      // DOM 控件默认高度很小, 显式按内容高度计算, 新增节点即有完整网格展示区
      wBox.computeSize = () => [node.width, Math.max(360, box.offsetHeight || 360)];

      // 选中文件回显
      const wEcho = node.addWidget("text", "selected", "", () => {}, { multiline: true });
      wEcho.disabled = true;
      wEcho.serializeValue = () => node._mervyn_selected || "";

      // 控件顺序: folder, browser, selected_file, selected 回显
      const order = ["folder", "browser", "selected_file", "selected"];
      node.widgets.sort((a, b) => {
        const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      let cursor = PAGE_SIZE;
      let entries = [];
      let timer = null;
      let token = 0;
      let previewEl = null;
      const seen = { folder: wFolder.value, file: wFile.value };

      const updateEcho = () => {
        node._mervyn_selected = wFile.value || "";
        wEcho.value = node._mervyn_selected;
      };

      const stopPreview = () => {
        if (previewEl) {
          if (previewEl.tagName === "VIDEO") previewEl.pause();
          previewEl = null;
        }
      };

      // 灯箱: 浮动大预览, 出现在点击位置附近; 关闭按钮/点空白/Esc 均可关闭
      let lightbox = null;
      let lbOutside = null;
      let lbEsc = null;

      const closeLightbox = () => {
        if (lbOutside) document.removeEventListener("mousedown", lbOutside, true);
        if (lbEsc) document.removeEventListener("keydown", lbEsc, true);
        lbOutside = lbEsc = null;
        stopPreview();
        if (lightbox) lightbox.remove();
        lightbox = null;
      };

      const showLightbox = (entry, anchor) => {
        closeLightbox();
        lightbox = document.createElement("div");
        lightbox.className = "mervyn-mb-lightbox";
        const close = document.createElement("button");
        close.className = "close";
        close.textContent = "✕";
        close.title = "Close (Esc)";
        close.onclick = closeLightbox;
        lightbox.appendChild(close);

        if (entry.kind === "image") {
          previewEl = document.createElement("img");
          previewEl.src = `/mervyn/media?path=${encodeURIComponent(entry.path)}`;
        } else {
          previewEl = document.createElement("video");
          previewEl.src = `/mervyn/video?path=${encodeURIComponent(entry.path)}`;
          previewEl.controls = true;
          previewEl.autoplay = true;
          previewEl.loop = true;
        }
        lightbox.appendChild(previewEl);
        document.body.appendChild(lightbox);

        // 定位: 优先出现在点击单元右侧, 空间不足换左侧, 并夹紧视口
        const rect = anchor.getBoundingClientRect();
        const lw = Math.min(580, window.innerWidth * 0.76);
        let left = rect.right + 10;
        if (left + lw > window.innerWidth - 8) left = rect.left - lw - 10;
        if (left < 8) left = Math.max(8, (window.innerWidth - lw) / 2);
        const top = Math.max(8, Math.min(rect.top - 30, window.innerHeight - 470));
        lightbox.style.left = `${left}px`;
        lightbox.style.top = `${top}px`;

        lbOutside = (e) => {
          if (lightbox && !lightbox.contains(e.target)) closeLightbox();
        };
        lbEsc = (e) => {
          if (e.key === "Escape") closeLightbox();
        };
        document.addEventListener("mousedown", lbOutside, true);
        document.addEventListener("keydown", lbEsc, true);
      };

      const select = (entry, cell) => {
        wFile.value = entry.path;
        seen.file = entry.path;
        updateEcho();
        node.setDirtyCanvas(true, true);
        showLightbox(entry, cell);
        renderGrid();
      };

      const thumbHTML = (entry) => {
        if (entry.kind === "dir") {
          return `<div class="mervyn-mb-thumb" style="font-size:32px">📁</div>`;
        }
        if (entry.kind === "image") {
          return `<div class="mervyn-mb-thumb"><img loading="lazy" src="/mervyn/media?path=${encodeURIComponent(entry.path)}" alt=""></div>`;
        }
        return `<div class="mervyn-mb-thumb"><video src="/mervyn/video?path=${encodeURIComponent(entry.path)}" autoplay muted loop playsinline preload="metadata"></video></div>`;
      };

      const renderGrid = () => {
        const grid = box.querySelector(".mervyn-mb-grid");
        const moreBtn = box.querySelector(".mervyn-mb-more");
        grid.innerHTML = "";
        const shown = entries.slice(0, cursor);
        for (const entry of shown) {
          const cell = document.createElement("div");
          cell.className = "mervyn-mb-cell" + (entry.path === wFile.value ? " selected" : "");
          cell.title = entry.path;
          cell.innerHTML = thumbHTML(entry) + `<div class="mervyn-mb-name">${entry.name}</div>`;
          cell.onclick = () => {
            if (entry.kind === "dir") {
              // 进入子目录 = folder 值直接更新为子目录完整路径(Kiko 同款)
              wFolder.value = joinPath(currentRoot(wFolder), "", entry.name);
              seen.folder = wFolder.value;
              onFolderChanged();
            } else {
              select(entry, cell);
            }
          };
          grid.appendChild(cell);
        }
        if (!shown.length) {
          grid.innerHTML = `<div class="mervyn-mb-empty">(empty)</div>`;
        }
        const hidden = entries.length - cursor;
        moreBtn.style.display = hidden > 0 ? "block" : "none";
        moreBtn.textContent = `Load more (${hidden} hidden)`;
        moreBtn.onclick = () => {
          cursor += PAGE_SIZE;
          renderGrid();
        };
        // 网格区域固定高, 节点高度不足时自动增高(免去手动拉大)
        const need = node.computeSize()[1];
        if (node.size[1] < need) node.setSize([node.size[0], need]);
      };

      const renderCrumbs = () => {
        const bar = box.querySelector(".mervyn-mb-crumbs");
        bar.innerHTML = "";
        // 面包屑直接来自 folder 的路径分段: 进入子目录后 folder 更新, 面包屑随之延伸
        const parts = currentRoot(wFolder).split(/[\\/]+/).filter(Boolean);
        const mk = (label, prefix) => {
          const b = document.createElement("button");
          b.className = "mervyn-mb-crumb";
          b.textContent = label;
          b.title = prefix;
          b.onclick = () => {
            wFolder.value = prefix;
            seen.folder = wFolder.value;
            onFolderChanged();
          };
          bar.appendChild(b);
        };
        parts.forEach((p, i) => {
          if (i > 0) {
            const sep = document.createElement("span");
            sep.className = "mervyn-mb-sep";
            sep.textContent = "›";
            bar.appendChild(sep);
          }
          const prefix = parts.slice(0, i + 1).join("/");
          mk(i === 0 && p.endsWith(":") ? `${p}\\` : p, prefix);
        });
      };

      const renderFavs = () => {
        const bar = box.querySelector(".mervyn-mb-favs");
        bar.innerHTML = "";
        for (const fav of getFavs()) {
          const chip = document.createElement("span");
          chip.className = "mervyn-mb-fav";
          const name = document.createElement("span");
          name.textContent = `★ ${fav.split(/[\\/]/).pop() || fav}`;
          name.title = fav;
          name.onclick = () => {
            wFolder.value = fav;
            seen.folder = fav;
            onFolderChanged();
          };
          const x = document.createElement("span");
          x.className = "x";
          x.textContent = "✕";
          x.title = "Remove from favorites";
          x.onclick = (e) => {
            e.stopPropagation();
            setFavs(getFavs().filter((f) => f !== fav));
            renderFavs();
          };
          chip.appendChild(name);
          chip.appendChild(x);
          bar.appendChild(chip);
        }
        const cur = currentRoot(wFolder);
        const add = document.createElement("button");
        add.className = "mervyn-mb-fav mervyn-mb-addfav";
        add.textContent = "＋★ favorite folder";
        add.title = `Add the folder input to favorites${cur ? `: ${cur}` : ""}`;
        add.onclick = () => {
          if (!cur) return;
          const favs = getFavs();
          if (!favs.includes(cur)) {
            favs.push(cur);
            setFavs(favs);
          }
          renderFavs();
        };
        bar.appendChild(add);
      };

      const refresh = async () => {
        const myToken = ++token;
        const root = currentRoot(wFolder);
        const grid = box.querySelector(".mervyn-mb-grid");
        if (!root) {
          entries = [];
          grid.innerHTML = `<div class="mervyn-mb-empty">(set folder to browse)</div>`;
          return;
        }
        try {
          const data = await listMedia(root, "");
          if (myToken !== token) return;
          entries = [
            ...data.subdirs.map((n) => ({ kind: "dir", name: n, path: n })),
            ...data.images.map((n) => ({ kind: "image", name: n, path: joinPath(root, "", n) })),
            ...data.videos.map((n) => ({ kind: "video", name: n, path: joinPath(root, "", n) })),
          ];
          renderCrumbs();
          renderGrid();
        } catch (err) {
          if (myToken !== token) return;
          entries = [];
          grid.innerHTML = `<div class="mervyn-mb-empty">(error: ${err.message})</div>`;
        }
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), 300);
      };

      const onFolderChanged = () => {
        cursor = PAGE_SIZE;
        renderFavs();
        scheduleRefresh();
      };

      // 事件路径 1: widget callback(部分前端版本支持)
      wFolder.callback = () => onFolderChanged();

      // 事件路径 2: onDrawBackground 轮询兜底
      node.onDrawBackground = function () {
        if (wFolder.value !== seen.folder) {
          seen.folder = wFolder.value;
          onFolderChanged();
        }
        if (wFile.value !== seen.file) {
          seen.file = wFile.value;
          updateEcho();
        }
      };

      // 工作流加载后恢复
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        updateEcho();
        renderFavs();
        if (currentRoot(wFolder)) refresh();
      };

      renderFavs();
      updateEcho();
      if (currentRoot(wFolder)) refresh();
      // 初始即按内容撑起节点高度, 无需手动拉大
      node.setSize([node.size[0], node.computeSize()[1]]);

      return result;
    };
  },
});
