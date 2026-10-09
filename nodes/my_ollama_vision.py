"""My Ollama Vision: 把图片/视频帧交给本地 Ollama 视觉模型, 反推视频提示词。

输入 IMAGE(单张图, 或视频帧批次 —— 直接接 VHS ``Load Video`` 的 IMAGE 输出),
按 max_frames 等间隔抽帧、等比缩小后 base64 编码, 通过 ``POST /api/generate``
提交给本地 Ollama 视觉模型, 返回模型回答(默认提示词是"反推视频提示词")。

设计要点:
- 只依赖 ComfyUI 核心自带的 requests, 不新增第三方依赖;
- 视频可能有几百帧, 默认只抽 6 张、长边缩到 768, 避免一次提交几十张原图;
- 节点是 OUTPUT_NODE, 回答直接显示在节点上(前端脚本 web/js/my_ollama_vision.js),
  同时从 text 输出口供下游使用;
- 不对 IS_CHANGED 做特殊处理: 输入不变就复用缓存, 不会每次排队都白跑一次大模型。
  想换一个结果就改 seed(输入变了缓存自然失效)。
"""

import base64
import io

import numpy as np
from PIL import Image

try:
    import requests
except ImportError:  # 理论上不会发生: requests 是 ComfyUI 核心依赖
    requests = None

DEFAULT_URL = "http://127.0.0.1:11434"

# PIL 10 起 LANCZOS 移到了 Image.Resampling 下, 这里兼容新旧版本
_RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS

_DEFAULT_PROMPT = (
    "You are a prompt engineer for text-to-video generation. The attached images "
    "are frames sampled in order from a single video clip. Study them and write one "
    "prompt that could recreate that clip.\n"
    "Describe, in this order: the main subject, what it is doing, the setting, the "
    "camera (shot size and movement), the lighting, the colour and mood, and the "
    "overall visual style.\n"
    "Answer with a single plain paragraph in English, present tense, under 120 words. "
    "No preamble, no bullet points, no headings, no meta commentary — output only the "
    "prompt itself."
)

_PROMPT_TOOLTIP = (
    "What to ask the vision model. The default reverse-engineers a video prompt "
    "from the frames. To get the answer in another language, add a sentence such as "
    "\"Answer in Chinese.\" to the prompt."
)


def pick_frames(images, max_frames: int):
    """从帧批次里等间隔挑 max_frames 帧, 覆盖首尾。

    images: (N, H, W, C) 张量(单张图时 N=1)。
    """
    total = int(images.shape[0])
    if max_frames >= total:
        return [images[index] for index in range(total)]
    if max_frames <= 1:
        return [images[0]]
    step = (total - 1) / (max_frames - 1)
    indices = sorted({int(round(index * step)) for index in range(max_frames)})
    return [images[index] for index in indices]


def encode_frame(frame, max_side: int, quality: int = 90) -> str:
    """把单帧张量编码成 base64 JPEG 字符串(max_side 为 0 时不缩放)。"""
    array = frame.cpu().numpy() if hasattr(frame, "cpu") else np.asarray(frame)
    array = np.clip(np.asarray(array, dtype=np.float32), 0.0, 1.0)
    if array.ndim == 2:
        array = np.stack([array] * 3, axis=-1)
    elif array.ndim == 3 and array.shape[-1] not in (1, 3, 4) and array.shape[0] in (1, 3, 4):
        array = np.transpose(array, (1, 2, 0))  # CHW -> HWC 兜底
    if array.shape[-1] == 4:
        array = array[..., :3]
    elif array.shape[-1] == 1:
        array = np.repeat(array, 3, axis=-1)

    image = Image.fromarray((array * 255.0).round().astype("uint8"))
    if max_side and max(image.size) > max_side:
        scale = max_side / float(max(image.size))
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            _RESAMPLE,
        )
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def build_endpoint(url: str) -> str:
    """把用户填的地址归一化成 /api/generate 端点(容错常见写法)。"""
    base = (url or "").strip().rstrip("/")
    if not base:
        base = DEFAULT_URL
    if not base.startswith(("http://", "https://")):
        base = "http://" + base
    if base.endswith("/api/generate"):
        return base
    if base.endswith("/api"):
        return base + "/generate"
    return base + "/api/generate"


def build_payload(model: str, prompt: str, images_b64: list, system: str = "",
                  temperature: float = 0.2, seed: int = 0, num_predict: int = 512,
                  think: bool = False) -> dict:
    """构造 /api/generate 的请求体(纯函数, 便于测试)。"""
    options = {
        "temperature": float(temperature),
        "num_predict": int(num_predict),
    }
    if seed is not None and int(seed) >= 0:
        options["seed"] = int(seed)
    payload = {
        "model": str(model or "").strip(),
        "prompt": prompt,
        "images": images_b64,
        "stream": False,
        "options": options,
        # think 总是显式下发: 实测 false 对思考模型(关闭推理)和非思考模型(无副作用)
        # 都安全; 而 true 在非思考模型上会 400 "does not support thinking"。
        "think": bool(think),
    }
    if system and system.strip():
        payload["system"] = system.strip()
    return payload


def _error_text(response) -> str:
    """尽量从 Ollama 的错误响应里取出可读信息。"""
    try:
        data = response.json()
    except ValueError:
        return (response.text or "").strip()[:200]
    if isinstance(data, dict):
        return str(data.get("error") or data)[:200]
    return str(data)[:200]


def call_ollama(endpoint: str, payload: dict, timeout: float):
    """调用 Ollama, 返回 (文本, 原始 JSON); 各类失败都转成可读的 RuntimeError。"""
    if requests is None:
        raise RuntimeError(
            "the `requests` package is missing; it ships with ComfyUI, "
            "reinstall ComfyUI's requirements or `pip install requests`"
        )
    try:
        response = requests.post(endpoint, json=payload, timeout=float(timeout))
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(
            f"cannot reach Ollama at {endpoint} — is `ollama serve` running? ({e})"
        ) from e
    except requests.exceptions.Timeout as e:
        raise RuntimeError(
            f"Ollama did not answer within {timeout}s ({endpoint}); "
            "raise `timeout` or use a smaller model"
        ) from e
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Ollama request failed ({endpoint}): {e}") from e

    if response.status_code == 404:
        raise RuntimeError(
            f"Ollama 404: {_error_text(response)} — "
            f"run `ollama pull {payload.get('model', '')}` first"
        )
    if response.status_code >= 400:
        raise RuntimeError(f"Ollama HTTP {response.status_code}: {_error_text(response)}")

    try:
        data = response.json()
    except ValueError as e:
        raise RuntimeError(
            f"Ollama returned a non-JSON response: {(response.text or '')[:200]!r}"
        ) from e

    text = str(data.get("response") or "").strip()
    if not text:
        # 思考模型会先把 token 花在 reasoning 上: num_predict 给小了就会拿不到任何答案
        # (done_reason='length' 且 response 为空), 这时给出可操作的提示而不是干巴巴的报错。
        if data.get("done_reason") == "length":
            reasoning = "yes" if data.get("thinking") else "no"
            raise RuntimeError(
                "Ollama ran out of tokens (num_predict) before writing any answer "
                f"[done_reason='length', reasoning_used={reasoning}]. "
                "Thinking models spend tokens on their reasoning first — raise "
                "`num_predict`, or turn `think` off."
            )
        raise RuntimeError(f"Ollama returned an empty response: {str(data)[:200]}")
    return text, data


class MyOllamaVision:
    """把图片/视频帧交给本地 Ollama 视觉模型, 反推(或任意分析)提示词。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE", {
                    "tooltip": (
                        "Frames to analyse. Connect VHS `Load Video`'s IMAGE output "
                        "(leave its VAE unconnected so the output stays IMAGE), or any "
                        "single image."
                    ),
                }),
                "model": ("STRING", {
                    "default": "qwen3.5:9b",
                    "tooltip": (
                        "Ollama vision model name; it must already be pulled. Any "
                        "multimodal model works, e.g. qwen3.5:9b, qwen2.5vl:7b, llava, "
                        "llama3.2-vision, minicpm-v. Note that a model's name does not "
                        "prove it can see images — check with `ollama show <model>` and "
                        "look for `vision` under Capabilities."
                    ),
                }),
                "prompt": ("STRING", {
                    "default": _DEFAULT_PROMPT,
                    "multiline": True,
                    "tooltip": _PROMPT_TOOLTIP,
                }),
            },
            "optional": {
                "ollama_url": ("STRING", {
                    "default": DEFAULT_URL,
                    "tooltip": "Ollama base URL; /api/generate is appended automatically.",
                }),
                "max_frames": ("INT", {
                    "default": 6, "min": 1, "max": 64, "step": 1,
                    "tooltip": "How many frames to send, sampled evenly across the clip.",
                }),
                "max_side": ("INT", {
                    "default": 768, "min": 0, "max": 4096, "step": 64,
                    "tooltip": "Longest edge each frame is scaled to (0 = keep original size).",
                }),
                "system": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "Optional system message (sent as `system` when non-empty).",
                }),
                "temperature": ("FLOAT", {
                    "default": 0.2, "min": 0.0, "max": 2.0, "step": 0.05,
                }),
                "seed": ("INT", {
                    "default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF,
                    "tooltip": (
                        "Passed to Ollama and part of the cache key: keep it to reuse "
                        "the cached answer, change it to get a different sample."
                    ),
                }),
                "num_predict": ("INT", {
                    "default": 512, "min": 1, "max": 8192, "step": 1,
                    "tooltip": (
                        "Maximum number of tokens to generate. Thinking models spend part "
                        "of this budget on their reasoning first — if this is too small "
                        "you get no answer at all."
                    ),
                }),
                "think": ("BOOLEAN", {
                    "default": False,
                    "tooltip": (
                        "Let a thinking model reason before answering. Off by default: on "
                        "a 'describe these frames' task the reasoning burns output tokens "
                        "(measured with the same prompt: 157 with it on vs 2 with it off) "
                        "without improving the answer, and it eats into num_predict. Only "
                        "turn it on for models that advertise thinking (e.g. qwen3.5) — "
                        "non-thinking models reject it with 'does not support thinking'."
                    ),
                }),
                "timeout": ("INT", {
                    "default": 300, "min": 5, "max": 3600, "step": 5,
                    "tooltip": "HTTP timeout in seconds (vision models can be slow).",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "info")
    OUTPUT_TOOLTIPS = (
        "The model's answer (the reverse-engineered prompt by default).",
        "One-line summary: model, frames sent, token counts and elapsed time.",
    )
    FUNCTION = "run"
    CATEGORY = "my"
    OUTPUT_NODE = True
    DESCRIPTION = "Send images/video frames to a local Ollama vision model and get a prompt back."

    @classmethod
    def VALIDATE_INPUTS(cls, model="", prompt=""):
        if not str(model or "").strip():
            return "model is empty — try qwen2.5vl:7b, llava or llama3.2-vision"
        if not str(prompt or "").strip():
            return "prompt is empty — tell the vision model what to produce"
        return True

    def run(self, images, model, prompt, ollama_url=DEFAULT_URL, max_frames=6,
            max_side=768, system="", temperature=0.2, seed=0, num_predict=512,
            think=False, timeout=300):
        if images is None:
            raise ValueError("images is required")
        frames = pick_frames(images, int(max_frames))
        if not frames:
            raise ValueError("images is empty — nothing to send to Ollama")

        encoded = [encode_frame(frame, int(max_side)) for frame in frames]
        endpoint = build_endpoint(ollama_url)
        payload = build_payload(
            model, prompt, encoded, system=system, temperature=temperature,
            seed=seed, num_predict=num_predict, think=think,
        )
        text, data = call_ollama(endpoint, payload, timeout)

        elapsed = float(data.get("total_duration") or 0) / 1e9
        # done_reason='length' 但仍有文本 -> 答案是截断的, 在信息行里标出来
        truncated = (" | truncated (num_predict reached)"
                     if data.get("done_reason") == "length" else "")
        info = (
            f"{payload['model']} | {len(encoded)} frame(s) | "
            f"prompt {data.get('prompt_eval_count', '?')} tok | "
            f"output {data.get('eval_count', '?')} tok | {elapsed:.1f}s{truncated}"
        )
        return {"ui": {"mervyn_ollama_vision": [text, info]}, "result": (text, info)}
