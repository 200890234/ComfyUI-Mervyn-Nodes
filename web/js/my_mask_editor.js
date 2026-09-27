// My Mask Editor (English UI) - paint a mask over the image.
// Layers: viewCv (displayed: source image + red-tinted mask overlay),
//         maskCanvas (mask data, white strokes on transparent, saved as <name>_mask.png).
// Fully independent of the ComfyUI input directory.
import { app } from "../../../scripts/app.js";

const CSS_ID = "mervyn-mask-editor-css";

const CSS = `
.mervyn-me{display:flex;flex-direction:column;gap:4px;width:100%;box-sizing:border-box;height:fit-content !important;align-self:flex-start;padding-bottom:8px}
.mervyn-me-canvas-wrap{flex:0 0 auto}
.mervyn-me-toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:26px}
.mervyn-me-btn{background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px}
.mervyn-me-btn:hover{background:#333}
.mervyn-me-btn.active{background:#31465e;color:#cfe4ff;border-color:#5a7ca6}
.mervyn-me-canvas-wrap{position:relative;width:100%;background:#111;border:1px solid #333;border-radius:6px}
/* canvas 保持常规流布局: width:100% + height:auto 由浏览器按属性宽高比撑开 wrap 高度 */
.mervyn-me-canvas-wrap canvas{display:block;width:100%;height:auto;cursor:none;border-radius:5px}
/* 笔刷光标固定定位挂 body, 用视口坐标直接定位, 彻底避开各层定位上下文差异 */
.mervyn-me-brush-cursor{position:fixed;top:0;left:0;width:0;height:0;box-sizing:border-box;pointer-events:none;border:1px solid rgba(0,0,0,.9);box-shadow:0 0 0 1px rgba(255,255,255,.9) inset;border-radius:50%;display:none;z-index:99999;opacity:.9}
.mervyn-me-slider{display:inline-flex;align-items:center;gap:3px}
.mervyn-me-slider .lbl{color:#bbb}
.mervyn-me-slider .val{color:#9ad;min-width:22px;text-align:right}
.mervyn-me-status{color:#9ad;font-size:11px;line-height:16px;padding:0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function injectStyle() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function currentFile(w) {
  const v = (w?.value || "").trim().replace(/^["']|["']$/g, "");
  return v && !v.startsWith("(") ? v : "";
}

function maskPathOf(p) {
  const stem = p.replace(/\.[^.]+$/, "");
  return `${stem}_mask.png`;
}

app.registerExtension({
  name: "Mervyn.MyMaskEditor",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyMaskEditor") return;
    console.debug("[Mervyn] MyMaskEditor extension registered");

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);
      injectStyle();

      // file_path may be converted to an input socket (widget disappears) - guard everywhere
      const wFile = node.widgets.find((w) => w.name === "file_path") || null;

      // DOM: toolbar (top) / canvas wrap (middle) / status (bottom)
      const box = document.createElement("div");
      box.className = "mervyn-me";
      const toolbar = document.createElement("div");
      toolbar.className = "mervyn-me-toolbar";
      const wrap = document.createElement("div");
      wrap.className = "mervyn-me-canvas-wrap";
      const viewCv = document.createElement("canvas"); // displayed: image + red overlay
      const brushCursor = document.createElement("div"); // 笔刷范围圈(跟随光标)
      brushCursor.className = "mervyn-me-brush-cursor";
      const status = document.createElement("div");
      status.className = "mervyn-me-status";
      status.textContent = wFile
        ? "(connect a file_path)"
        : "(connect image via file_path input)";
      wrap.append(viewCv);
      box.append(toolbar, wrap, status);
      // 笔刷光标挂到 body 并固定定位: 与 wrap/box 的布局(Z 层、塌陷、transform)完全解耦
      document.body.append(brushCursor);
      const wCanvas = node.addDOMWidget("mask_canvas", "mask_canvas", box);
      wCanvas.serializeValue = () => "";

      // Offscreen layers
      const maskCanvas = document.createElement("canvas"); // mask data (white strokes)
      const tintCv = document.createElement("canvas");     // red-tinted mask cache
      const srcImage = new Image();                        // source image
      let toolbarH = 46;

      // ---- Toolbar ----
      const mkBtn = (text, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mervyn-me-btn";
        b.textContent = text;
        if (title) b.title = title;
        return b;
      };
      const bPaint = mkBtn("🖌 Paint");
      bPaint.className = "mervyn-me-btn active";
      const bErase = mkBtn("🧽 Erase");
      const bUndo = mkBtn("↩ Undo");
      const bRedo = mkBtn("Redo ↪");
      const bFill = mkBtn("Fill");
      bFill.title = "Fill entire mask";
      const bInvert = mkBtn("Invert");
      bInvert.title = "Invert mask";
      const bClear = mkBtn("Clear");
      const bSave = mkBtn("💾 Save Mask");
      bSave.style.cssText = "background:#234;color:#adf;border-color:#346";
      const mkSlider = (label, min, max, val, title) => {
        const wrapS = document.createElement("span");
        wrapS.className = "mervyn-me-slider";
        const name = document.createElement("span");
        name.className = "lbl";
        name.textContent = label;
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = String(min);
        inp.max = String(max);
        inp.value = String(val);
        inp.title = title;
        const valEl = document.createElement("span");
        valEl.className = "val";
        valEl.textContent = val;
        inp.oninput = () => { valEl.textContent = inp.value; };
        wrapS.append(name, inp, valEl);
        return { wrap: wrapS, inp };
      };
      const sSize = mkSlider("Size", 2, 120, 24, "Brush size");
      const sOpacity = mkSlider("Opacity", 10, 100, 100, "Brush opacity %");
      const sSoft = mkSlider("Soft", 0, 30, 0, "Brush softness (blur px)");
      toolbar.append(
        bPaint, bErase, sSize.wrap, sOpacity.wrap, sSoft.wrap,
        bUndo, bRedo, bFill, bInvert, bClear, bSave,
      );

      // ---- State / layers ----
      let erasing = false;
      let drawing = false;
      let last = null;
      let token = 0;
      let timer = null;
      let saveTimer = null;
      const seen = { file: wFile?.value ?? null, resolved: null, src: "" };
      const undoStack = [];
      const redoStack = [];
      const MAX_HISTORY = 20;

      // 由原图宽高比 + wrap 实际可用宽, 推算出画布应有的显示高(不依赖节点当前高度)
      const naturalViewH = () => {
        const d = node._mervyn_dims;
        if (!d || !d.w) return 0;
        const availW = Math.max(40, wrap.clientWidth || (node.width - 20));
        return Math.round(availW * (d.h / d.w));
      };

      const computeSize = () => {
        // box 已是常规流布局(canvas width:100%/height:auto 撑开), 直接量 box 真实总高
        // 最准: 自动包含工具栏换行、gap、边框, 无需手工相加
        const measured = box.offsetHeight;
        if (measured > 10) return [node.width, Math.ceil(measured) + 2];
        // DOM 尚未布局完成时的兜底(首帧)
        toolbarH = toolbar.offsetHeight || 46;
        const statusH = status.offsetHeight || 16;
        if (viewCv.style.display === "none") return [node.width, toolbarH + statusH + 8];
        const viewH = naturalViewH() || viewCv.offsetHeight || 200;
        return [node.width, toolbarH + viewH + 2 + statusH + 8];
      };
      // 关键: DOM widget 的高度由 computeSize 决定, 必须挂到 widget 上,
      // 否则画布区域被裁为零高(图片加载成功也看不到)
      wCanvas.computeSize = computeSize;

      // box 已用 height:fit-content 免疫父容器拉伸, 其高度只反映真实内容,
      // 因此可以双向同步(过高时收回), 用 2px 容差避免亚像素抖动
      const fitNode = () => {
        const need = computeSize()[1];
        if (need > 10 && Math.abs(node.size[1] - need) > 2) {
          node.setSize([node.size[0], need]);
        }
        node.setDirtyCanvas(true, true);
      };

      // 内容(图片加载完成 / 工具栏换行)导致需求高度变化时同步, 同样只增不减
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => fitNode());
        ro.observe(box);
        ro.observe(toolbar);
        node.onRemoved = () => {
          ro.disconnect();
          brushCursor.remove();
          nodeType.prototype.onRemoved?.apply(node, arguments);
        };
      }

      // Render view: source image + red-tinted mask overlay
      const renderView = () => {
        const w = viewCv.width, h = viewCv.height;
        if (!w || !h) return;
        const ctx = viewCv.getContext("2d");
        ctx.clearRect(0, 0, w, h);
        if (srcImage.complete && srcImage.naturalWidth) ctx.drawImage(srcImage, 0, 0);
        tintCv.width = w;
        tintCv.height = h;
        const t = tintCv.getContext("2d");
        t.drawImage(maskCanvas, 0, 0);
        t.globalCompositeOperation = "source-in";
        t.fillStyle = "rgba(255,45,45,0.65)";
        t.fillRect(0, 0, w, h);
        ctx.drawImage(tintCv, 0, 0);
      };

      // ---- Undo / redo ----
      const snap = () => { try { return maskCanvas.toDataURL("image/png"); } catch { return null; } };
      const restore = (dataUrl) => {
        const probe = new Image();
        probe.onload = () => {
          const ctx = maskCanvas.getContext("2d");
          ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          ctx.drawImage(probe, 0, 0);
          renderView();
        };
        probe.src = dataUrl;
      };
      const pushUndo = () => {
        const s = snap();
        if (s === null) return;
        undoStack.push(s);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack.length = 0;
      };
      bUndo.onclick = () => {
        if (!undoStack.length) return;
        redoStack.push(snap());
        restore(undoStack.pop());
        scheduleSave();
      };
      bRedo.onclick = () => {
        if (!redoStack.length) return;
        undoStack.push(snap());
        restore(redoStack.pop());
        scheduleSave();
      };

      const setMode = (erase) => {
        erasing = erase;
        bPaint.classList.toggle("active", !erase);
        bErase.classList.toggle("active", erase);
      };
      bPaint.onclick = () => setMode(false);
      bErase.onclick = () => setMode(true);

      const applyFull = (invert) => {
        pushUndo();
        const ctx = maskCanvas.getContext("2d");
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.filter = invert ? "invert(100%)" : "none";
        ctx.fillStyle = invert ? "#000" : "#fff";
        ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        ctx.restore();
        renderView();
        scheduleSave();
        status.textContent = invert ? "Inverted (auto-saved)" : "Filled (auto-saved)";
      };
      bFill.onclick = () => applyFull(false);
      bInvert.onclick = () => applyFull(true);
      bClear.onclick = () => {
        pushUndo();
        maskCanvas.getContext("2d").clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        renderView();
        scheduleSave();
        status.textContent = "Cleared (auto-saved)";
      };

      // ---- Paint ----
      // 单一事实源: 每次交互都取一次 viewCv 的视口矩形, 所有换算(光标定位 + 落点)
      // 都基于同一份快照, 消除"两套坐标系"带来的偏移
      const viewRect = () => viewCv.getBoundingClientRect();

      // 笔刷范围圈: 尺寸按画布显示比例换算, 位置跟随鼠标(固定定位 -> 视口坐标直接可用)
      const updateBrushCursorSize = () => {
        const rect = viewRect();
        const scale = rect.width && viewCv.width ? rect.width / viewCv.width : 1;
        const d = (parseInt(sSize.inp.value, 10) || 24) * scale;
        brushCursor.style.width = `${d}px`;
        brushCursor.style.height = `${d}px`;
      };
      sSize.inp.addEventListener("input", updateBrushCursorSize);

      const moveBrushCursor = (e) => {
        if (brushCursor.style.display === "none" || !brushCursor.style.display) updateBrushCursorSize();
        // 固定定位挂 body: left/top 即视口坐标, 与鼠标 clientX/clientY 同一坐标系
        const d = brushCursor.offsetWidth || 0;
        brushCursor.style.left = `${e.clientX - d / 2}px`;
        brushCursor.style.top = `${e.clientY - d / 2}px`;
      };
      // 事件绑在 canvas 上(鼠标实际所处的元素), 而非 wrap
      viewCv.addEventListener("pointerenter", () => {
        updateBrushCursorSize();
        brushCursor.style.display = "block";
      });
      viewCv.addEventListener("pointerleave", () => {
        brushCursor.style.display = "none";
      });
      viewCv.addEventListener("pointermove", moveBrushCursor);

      // 视口坐标 -> 画布像素坐标 (viewCv 属性尺寸 / 显示尺寸)
      const toXY = (e) => {
        const rect = viewRect();
        const w = viewCv.width || 1;
        const h = viewCv.height || 1;
        const sx = rect.width ? w / rect.width : 1;
        const sy = rect.height ? h / rect.height : 1;
        return {
          x: (e.clientX - rect.left) * sx,
          y: (e.clientY - rect.top) * sy,
        };
      };
      const strokeTo = (p) => {
        const ctx = maskCanvas.getContext("2d");
        ctx.save();
        ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
        ctx.globalAlpha = parseInt(sOpacity.inp.value, 10) / 100;
        const soft = parseInt(sSoft.inp.value, 10) || 0;
        try { ctx.filter = soft > 0 ? `blur(${soft}px)` : "none"; } catch { /* no filter */ }
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = parseInt(sSize.inp.value, 10) || 24;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
        last = p;
        renderView();
      };
      viewCv.addEventListener("pointerdown", (e) => {
        const r = viewRect();
        const p = toXY(e);
        console.debug("[Mervyn] paint: mouse=", e.clientX, e.clientY,
          " rect=", Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height),
          " attr=", viewCv.width, "x", viewCv.height,
          " -> px=", Math.round(p.x), Math.round(p.y),
          " dpr=", window.devicePixelRatio);
        pushUndo();
        drawing = true;
        last = toXY(e);
        strokeTo(last);
        viewCv.setPointerCapture(e.pointerId);
      });
      viewCv.addEventListener("pointermove", (e) => {
        if (drawing) strokeTo(toXY(e));
      });
      viewCv.addEventListener("pointerup", () => {
        drawing = false;
        last = null;
        scheduleSave();
      });

      // ---- Save (auto after each stroke, debounced) ----
      const saveMask = async () => {
        const file = resolveFile();
        if (!file) { status.textContent = "(no image)"; return; }
        try {
          const res = await fetch("/mervyn/save_mask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: file, dataUrl: maskCanvas.toDataURL("image/png") }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          status.textContent = `Saved: ${data.saved}`;
        } catch (err) {
          status.textContent = `Save failed: ${err.message}`;
        }
      };
      const scheduleSave = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveMask(), 800);
      };
      bSave.onclick = () => saveMask();

      // ---- Resolve file: widget value, else follow upstream link ----
      // 解析要编辑的图片路径:
      // 1) 自身 file_path 控件值(手动输入/序列化恢复)
      // 2) 已连线时读上游节点的候选控件值(Load Image 的 image / file_path 输出
      //    在编辑期尚未物化, 但其 image 控件保存着选中的绝对路径)
      const resolveFile = () => {
        const own = currentFile(wFile);
        if (own) return own;
        try {
          const idx = (node.inputs || []).findIndex((i) => i.name === "file_path");
          const slot = idx >= 0 ? node.inputs[idx] : null;
          const linkId = slot?.link;
          let src = idx >= 0 ? node.getInputNode?.(idx) : null;
          // link 存在但 getInputNode 失效时, 手工沿 link 找源节点
          if (!src && linkId != null && node.graph?.links) {
            const link = node.graph.links[linkId];
            src = node.graph.getNodeById?.(link?.origin_id) ?? null;
          }
          if (src) {
            for (const nm of ["image", "file_path", "selected_file", "path"]) {
              const w = src.widgets?.find((x) => x.name === nm);
              const val = typeof w?.value === "string" ? w.value : "";
              if (val && !val.startsWith("(")) {
                console.debug("[Mervyn] mask editor resolved from upstream:", nm, val);
                return val;
              }
            }
            console.debug("[Mervyn] upstream found but no usable widget:",
              src.type, (src.widgets || []).map((x) => `${x.name}=${x.value}`));
          }
        } catch (err) {
          console.debug("[Mervyn] resolveFile failed:", err);
        }
        return "";
      };

      // ---- Refresh: load source image + existing mask ----
      const refresh = () => {
        const myToken = ++token;
        const file = resolveFile();
        seen.resolved = file;
        console.debug("[Mervyn] mask editor refresh, file =", file);
        if (!file) {
          viewCv.style.display = "none";
          status.textContent = wFile
            ? "(connect a file_path)"
            : "(connect image via file_path input)";
          fitNode();
          return;
        }
        viewCv.style.display = "";
        // 每次都强制重设 onload 与 src: 之前的 seen.src 缓存会让"首次
        // onload 被 token 丢弃"变成永久空白(不再重试)
        const src = `/mervyn/media?path=${encodeURIComponent(file)}`;
        const applyLoaded = () => {
          console.debug("[Mervyn] mask editor source loaded:",
            srcImage.naturalWidth, "x", srcImage.naturalHeight);
          viewCv.width = srcImage.naturalWidth;
          viewCv.height = srcImage.naturalHeight;
          maskCanvas.width = srcImage.naturalWidth;
          maskCanvas.height = srcImage.naturalHeight;
          node._mervyn_dims = { w: srcImage.naturalWidth, h: srcImage.naturalHeight };
          // 载入已有伴生蒙版继续编辑
          const probe = new Image();
          probe.onload = () => {
            maskCanvas.getContext("2d").drawImage(probe, 0, 0);
            renderView();
            fitNode();
            status.textContent = "Existing mask loaded - continue editing";
          };
          probe.onerror = () => {
            renderView();
            fitNode();
            status.textContent = "No mask yet - paint strokes (auto-saved)";
          };
          probe.src = `/mervyn/media?path=${encodeURIComponent(maskPathOf(file))}`;
        };
        if (srcImage.dataset.src === src && srcImage.complete && srcImage.naturalWidth) {
          applyLoaded(); // 已加载过同一张图: 直接重绘
        } else {
          srcImage.dataset.src = src;
          srcImage.onload = applyLoaded;
          srcImage.onerror = () => {
            console.debug("[Mervyn] mask editor source load FAILED:", src);
            status.textContent = "(image load failed)";
          };
          srcImage.src = src;
        }
        fitNode();
      };

      const scheduleRefresh = () => {
        clearTimeout(timer);
        timer = setTimeout(() => refresh(), 300);
      };

      // Event path 1: widget callback (only when still a widget)
      if (wFile) wFile.callback = () => scheduleRefresh();

      // Event path 2: draw-time polling (linked input values don't touch widget.value)
      node.onDrawBackground = function () {
        const resolved = resolveFile();
        if (resolved !== seen.resolved) {
          seen.resolved = resolved;
          scheduleRefresh();
        }
        if (wFile && wFile.value !== seen.file) {
          seen.file = wFile.value;
          scheduleRefresh();
        }
        // 高度同步交给 fitNode(带容差), 这里不再直接 setSize, 避免与 ResizeObserver 互相打架
        fitNode();
      };

      // Linked/unlinked changes refresh immediately
      node.onConnectionsChange = function () {
        nodeType.prototype.onConnectionsChange?.apply(this, arguments);
        scheduleRefresh();
      };

      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        refresh();
      };

      if (currentFile(wFile)) refresh();
      fitNode();

      return result;
    };
  },
});







