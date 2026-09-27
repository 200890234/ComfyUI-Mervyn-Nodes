// My Save Video to Folder - 节点展示保存结果(saved path + 摘要);
// preview 开关打开时, 保存完成后内嵌播放刚保存的视频。
import { app } from "../../../scripts/app.js";

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
          videoEl.style.display = "";
        } else {
          videoEl.dataset.path = "";
          videoEl.style.display = "none";
          videoEl.pause();
          videoEl.removeAttribute("src");
        }
        node.setSize([node.size[0], node.computeSize()[1]]);
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

      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        const vals = message && message.mervyn_save_video;
        if (Array.isArray(vals) && vals.length >= 2) {
          node._mervyn_saved = String(vals[0] ?? "");
          node._mervyn_info = String(vals[1] ?? "");
          wPath.value = node._mervyn_saved;
          wInfo.value = node._mervyn_info;
          refreshPreview(); // 保存完成后按开关状态刷新预览
          node.setDirtyCanvas(true, true);
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
