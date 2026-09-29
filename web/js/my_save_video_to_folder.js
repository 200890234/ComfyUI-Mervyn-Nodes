// My Save Video to Folder - 节点展示保存结果(saved path + 摘要);
// preview 开关打开时, 保存完成后内嵌播放刚保存的视频。
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// 新版 Vue 前端下 node.onExecuted 不一定会被调用(表现为控件始终为空),
// 故用官方稳定的全局 executed 事件作为主通道, onExecuted 仅作兜底。
function findNode(id) {
  if (id == null) return null;
  const direct = app.graph?.getNodeById?.(id);
  if (direct) return direct;
  return (app.graph?._nodes || []).find((n) => String(n.id) === String(id)) || null;
}

api.addEventListener("executed", ({ detail }) => {
  const out = detail?.output;
  if (!out || !out.mervyn_save_video) return;
  const node = findNode(detail.display_node) || findNode(detail.node);
  if (!node || (node.comfyClass ?? node.type) !== "MySaveVideoToFolder") return;
  console.debug("[Mervyn] save video executed:", out.mervyn_save_video);
  node._mervynApplyResult?.(out.mervyn_save_video);
});

app.registerExtension({
  name: "Mervyn.MySaveVideoToFolder",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MySaveVideoToFolder") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);

      const wPath = node.addWidget("text", "saved path", "", () => {}, { multiline: true });
      wPath.disabled = true;
      wPath.serializeValue = () => node._mervyn_saved || "";
      const wInfo = node.addWidget("text", "info", "", () => {}, { multiline: true });
      wInfo.disabled = true;
      wInfo.serializeValue = () => node._mervyn_info || "";
      // preview 输入是后端新增的: 旧工作流/未重启的后端没有该控件, 必须防御
      const wPreview = node.widgets.find((w) => w.name === "preview") || null;

      // 内嵌视频预览(仅当 preview 开关打开且有已保存文件时显示)
      const videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.loop = true;
      videoEl.preload = "metadata";
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "contain";
      videoEl.style.background = "#000";
      videoEl.style.borderRadius = "4px";
      videoEl.style.display = "none";
      const previewWidget = node.addDOMWidget("video_preview", "video_preview", videoEl);
      previewWidget.serializeValue = () => "";
      previewWidget.computeSize = () =>
        videoEl.style.display === "none" ? [0, -4] : [node.width, 240];

      const refreshPreview = () => {
        const on = wPreview ? !!wPreview.value : false;
        const saved =
          typeof node._mervyn_saved === "string" && node._mervyn_saved
            ? node._mervyn_saved
            : "";
        if (on && saved) {
          const src = `/mervyn/video?path=${encodeURIComponent(saved)}`;
          if (videoEl.dataset.path !== saved) {
            videoEl.dataset.path = saved;
            videoEl.src = src;
          }
          // display:block 消除 <video> 默认 inline 的行盒基线空隙(会溢出压住相邻控件)
          videoEl.style.display = "block";
        } else {
          videoEl.dataset.path = "";
          videoEl.style.display = "none";
          videoEl.pause();
          videoEl.removeAttribute("src");
        }
        // 同步算一次 + 下一帧复算, 保证展开预览后节点高度够
        const fitNode = () => node.setSize([node.size[0], node.computeSize()[1]]);
        fitNode();
        requestAnimationFrame(fitNode);
        node.setDirtyCanvas(true, true);
      };

      if (wPreview) {
        wPreview.callback = () => refreshPreview();
        node.onDrawBackground = function () {
          if (!!wPreview.value !== refreshPreview._seen) {
            refreshPreview._seen = !!wPreview.value;
            refreshPreview();
          }
        };
      }

      // 两条通道共用: ui 回传 { mervyn_save_video: [saved_path, info] }
      node._mervynApplyResult = (vals) => {
        if (!Array.isArray(vals) || vals.length < 2) return;
        node._mervyn_saved = String(vals[0] ?? "");
        node._mervyn_info = String(vals[1] ?? "");
        wPath.value = node._mervyn_saved;
        wInfo.value = node._mervyn_info;
        refreshPreview(); // 保存完成后按开关状态刷新预览
        node.setDirtyCanvas(true, true);
      };

      // 兜底通道: 传统 onExecuted(旧前端上仍有效)
      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        if (message && message.mervyn_save_video) {
          node._mervynApplyResult(message.mervyn_save_video);
        }
      };

      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        wPath.value = node._mervyn_saved || "";
        wInfo.value = node._mervyn_info || "";
        refreshPreview();
      };

      return result;
    };
  },
});
