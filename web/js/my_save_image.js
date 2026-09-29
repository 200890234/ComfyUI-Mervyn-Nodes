// My Save Image - 在节点上直接展示后端回传的 status / moved_path。
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
  if (!out || !out.mervyn_save_image) return;
  const node = findNode(detail.display_node) || findNode(detail.node);
  if (!node || (node.comfyClass ?? node.type) !== "MySaveImage") return;
  console.debug("[Mervyn] save image executed:", out.mervyn_save_image);
  node._mervynApplyResult?.(out.mervyn_save_image);
});

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

      // 两条通道共用: ui 回传 { mervyn_save_image: [status, moved] }
      node._mervynApplyResult = (vals) => {
        if (!Array.isArray(vals) || vals.length < 2) return;
        node._mervyn_status = String(vals[0] ?? "");
        node._mervyn_moved = String(vals[1] ?? "");
        wStatus.value = node._mervyn_status;
        wMoved.value = node._mervyn_moved;
        node.setDirtyCanvas(true, true);
      };

      // 兜底通道: 传统 onExecuted(旧前端上仍有效)
      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        if (message && message.mervyn_save_image) {
          node._mervynApplyResult(message.mervyn_save_image);
        }
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
