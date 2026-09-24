// My Move File - 在节点上直接展示后端回传的 status / moved_path。
import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: "Mervyn.MyMoveFile",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyMoveFile") return;

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

      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        if (message && message.mervyn_move_file) {
          const [status, moved] = message.mervyn_move_file;
          node._mervyn_status = String(status ?? "");
          node._mervyn_moved = String(moved ?? "");
          wStatus.value = node._mervyn_status;
          wMoved.value = node._mervyn_moved;
          node.setDirtyCanvas(true, true);
        }
      };

      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        wStatus.value = node._mervyn_status || "";
        wMoved.value = node._mervyn_moved || "";
      };

      return result;
    };
  },
});
