// My Save Image - 在节点上直接展示后端回传的 status / moved_path。
import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: "Mervyn.MySaveImage",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MySaveImage") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);

      const wStatus = node.addWidget("text", "status", "", () => {}, {
        multiline: true,
      });
      wStatus.disabled = true;
      wStatus.serializeValue = () => node._mervyn_status || "";
      const wMoved = node.addWidget("text", "moved path", "", () => {}, {
        multiline: true,
      });
      wMoved.disabled = true;
      wMoved.serializeValue = () => node._mervyn_moved || "";

      const apply = (vals) => {
        if (!Array.isArray(vals) || vals.length < 2) return;
        node._mervyn_status = String(vals[0] ?? "");
        node._mervyn_moved = String(vals[1] ?? "");
        wStatus.value = node._mervyn_status;
        wMoved.value = node._mervyn_moved;
        node.setDirtyCanvas(true, true);
      };

      // 后端 ui 回传: { mervyn_save_image: [status, moved] }
      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        if (message && message.mervyn_save_image) apply(message.mervyn_save_image);
      };

      // 工作流加载后恢复上次展示
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        wStatus.value = node._mervyn_status || "";
        wMoved.value = node._mervyn_moved || "";
      };

      return result;
    };
  },
});

