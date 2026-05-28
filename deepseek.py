import os
import logging
import requests
from dotenv import load_dotenv

# 加载 .env 文件中的环境变量
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# 中文说明：
# 这个模块封装了对 Deepseek 外部检索/聊天 API 的调用逻辑。
# 函数 `query_deepseek` 接受一个文本查询（query），将其发送到 Deepseek 的
# chat/completions 接口（优先），并把返回的结果规范化为：
#   [ { "text": "...", "source": "...", "score": 0.0 }, ... ]
#
# 主要职责：
# - 根据环境变量 `DEEPSEEK_API_KEY` 和可选的 `DEEPSEEK_ENDPOINT` 构建请求；
# - 首先尝试调用 chat/completions（便于获得更丰富的聊天式回答）；
# - 如果 chat 接口不可用或没有 choices，则回退到搜索风格的结果解析（results/items/hits 等）；
# - 统一输出格式供上层调用（例如后端的 RAG/chain、图片处理流程使用）。
#
# 使用注意：
# - 需要在运行环境中设置 `DEEPSEEK_API_KEY`（Bearer token）；
# - `DEEPSEEK_ENDPOINT` 可用于替换默认的 https://api.deepseek.com；
# - 若需支持多模态（图片/二进制）检索，应在上层将图片转成文本（caption/OCR）后再调用此函数，
#   或者根据 Deepseek 的能力扩展本模块以直接上传图片/URL（目前本模块仅处理文本）。

def query_deepseek(query: str, k: int = 5, timeout: int = 8):
    """
    Query Deepseek external API. Expects environment variables:
      DEEPSEEK_API_KEY, DEEPSEEK_ENDPOINT
    Returns list of dicts: { "text": str, "source": str, "score": float }
    """
    key = os.environ.get("DEEPSEEK_API_KEY")
    endpoint_base = os.environ.get("DEEPSEEK_ENDPOINT") or "https://api.deepseek.com"
    if not key or not endpoint_base:
        raise RuntimeError("Deepseek not configured (DEEPSEEK_API_KEY/DEEPSEEK_ENDPOINT)")

    # Prefer chat completions path for richer responses; compose full URL
    chat_path = endpoint_base.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # Build chat-completions payload (example API shape)
    payload_chat = {
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        "messages": [
            {"role": "system", "content": """你是一名专业的医生助手。

【重要规则】
1. 根据提供的参考内容回答用户问题
2. 只使用与问题相关的内容，不要牵强附会
3. 如果参考内容与问题无关或不足以回答，直接基于医学常识回答
4. 回答要专业、准确、简洁
5. 不要编造或推测无关信息"""},
            {"role": "user", "content": query}
        ],
        "stream": False
    }

    try:
        logging.info("Deepseek.chat start endpoint=%s model=%s q=%s", chat_path, payload_chat["model"], query[:120])
        resp = requests.post(chat_path, json=payload_chat, headers=headers, timeout=timeout)
        # if chat endpoint not found or not supported, fall back to search-like behavior
        if resp.status_code == 404:
            logging.warning("Deepseek chat endpoint returned 404, will fallback to search-style call")
        resp.raise_for_status()
        data = resp.json()

        # Parse chat-like responses first (choices -> message/content or text)
        out = []
        if isinstance(data, dict) and data.get("choices"):
            for ch in data.get("choices", []):
                msg = ch.get("message") or {}
                text = msg.get("content") or ch.get("text") or ""
                out.append({"text": text, "source": "deepseek-chat", "score": 1.0})
            logging.info("Deepseek.chat returned %d choices for q=%s", len(out), query[:80])
            return out

        # Fallback: try search-style fields
        items = data.get("results") or data.get("items") or data.get("hits") or data.get("data") or []
        for it in items:
            text = it.get("text") or it.get("content") or it.get("snippet") or it.get("body") or ""
            source = it.get("source") or it.get("url") or it.get("id") or it.get("doc_id") or None
            score = it.get("score") or it.get("similarity") or it.get("score_value") or 0.0
            out.append({"text": text, "source": source, "score": float(score or 0)})
        logging.info("Deepseek.search returned %d items for q=%s", len(out), query[:80])
        return out
    except Exception as e:
        logging.error("Deepseek query failed: %s", e, exc_info=True)
        raise


def query_deepseek_with_image(image_url: str, question: str = "请描述这张图片并给出相关医学建议", timeout: int = 30):
    """
    Query Deepseek API with an image URL to get AI analysis.
    Uses the vision-capable model to analyze the image.
    """
    key = os.environ.get("DEEPSEEK_API_KEY")
    endpoint_base = os.environ.get("DEEPSEEK_ENDPOINT") or "https://api.deepseek.com"
    if not key or not endpoint_base:
        raise RuntimeError("Deepseek not configured (DEEPSEEK_API_KEY/DEEPSEEK_ENDPOINT)")

    chat_path = endpoint_base.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    # Build payload with image content (vision model)
    payload_chat = {
        "model": os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
        "messages": [
            {"role": "system", "content": "你是一个专业的医疗助手，请根据用户提供的图片进行分析和建议。如果图片是医学相关的（如检查报告、处方、X光片等），请给出专业的解读。如果图片不包含医学相关内容，请告知用户并建议提供相关的医学资料。\n\n回答格式要求：\n1. 使用中文标题和中文标点符号\n2. 每个段落之间用空行分隔\n3. 不要使用 -、*、• 等符号开头\n4. 使用数字序号如「1.」「2.」来列举要点\n5. 保持段落简洁，每段不超过3行"},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image_url}},
                {"type": "text", "text": question}
            ]}
        ],
        "stream": False
    }

    try:
        logging.info("Deepseek.vision start endpoint=%s image_url=%s", chat_path, image_url[:100])
        resp = requests.post(chat_path, json=payload_chat, headers=headers, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()

        out = []
        if isinstance(data, dict) and data.get("choices"):
            for ch in data.get("choices", []):
                msg = ch.get("message") or {}
                text = msg.get("content") or ch.get("text") or ""
                out.append({"text": text, "source": "deepseek-vision", "score": 1.0})
            logging.info("Deepseek.vision returned %d choices", len(out))
            return out

        return out
    except Exception as e:
        logging.error("Deepseek vision query failed: %s", e, exc_info=True)
        raise