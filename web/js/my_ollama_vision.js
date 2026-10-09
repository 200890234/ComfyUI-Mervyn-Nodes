// My Ollama Vision - 在节点上直接展示模型回答(反推的提示词)与调用信息。
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
  if (!out || !out.mervyn_ollama_vision) return;
  const node = findNode(detail.display_node) || findNode(detail.node);
  if (!node || (node.comfyClass ?? node.type) !== "MyOllamaVision") return;
  console.debug("[Mervyn] ollama vision executed:", out.mervyn_ollama_vision);
  node._mervynApplyResult?.(out.mervyn_ollama_vision);
});

app.registerExtension({
  name: "Mervyn.MyOllamaVision",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MyOllamaVision") return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const node = this;
      const result = onNodeCreated?.apply(this, arguments);

      const wText = node.addWidget("text", "result", "", () => {}, {
        multiline: true,
      });
      wText.disabled = true;
      wText.serializeValue = () => node._mervyn_vision_text || "";
      const wInfo = node.addWidget("text", "info", "", () => {}, {
        multiline: true,
      });
      wInfo.disabled = true;
      wInfo.serializeValue = () => node._mervyn_vision_info || "";

      // 两条通道共用: ui 回传 { mervyn_ollama_vision: [text, info] }
      node._mervynApplyResult = (vals) => {
        if (!Array.isArray(vals)) return;
        node._mervyn_vision_text = String(vals[0] ?? "");
        node._mervyn_vision_info = String(vals[1] ?? "");
        wText.value = node._mervyn_vision_text;
        wInfo.value = node._mervyn_vision_info;
        node.setDirtyCanvas(true, true);
      };

      // 兜底通道: 传统 onExecuted(旧前端上仍有效)
      node.onExecuted = function (message) {
        nodeType.prototype.onExecuted?.apply(node, arguments);
        if (message && message.mervyn_ollama_vision) {
          node._mervynApplyResult(message.mervyn_ollama_vision);
        }
      };

      // 工作流加载后恢复上次展示
      node.onConfigure = function () {
        nodeType.prototype.onConfigure?.apply(this, arguments);
        wText.value = node._mervyn_vision_text || "";
        wInfo.value = node._mervyn_vision_info || "";
      };

      return result;
    };
  },
});
