# ComfyUI-Mervyn-Nodes

Mervyn 的 ComfyUI 自定义节点包。

## 安装

手动 clone 到 ComfyUI 的节点目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/200890234/ComfyUI-Mervyn-Nodes.git
```

发布到 Comfy Registry 后，也可直接在 ComfyUI Manager 中搜索 `ComfyUI-Mervyn-Nodes` 安装。

## 节点列表

- `Mervyn: Example Node` — 示例节点（占位）

## 开发

- `__init__.py` — 插件入口，维护 `NODE_CLASS_MAPPINGS`
- `nodes/` — 节点实现，按功能拆分模块
- `nodes/example.py` — 示例节点，可修改或删除
- `pyproject.toml` — Comfy Registry 发布元数据

节点开发文档：https://docs.comfy.org/essentials/custom-node-basics
