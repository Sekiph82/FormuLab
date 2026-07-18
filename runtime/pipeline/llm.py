"""Multi-provider LLM client for FormuLab v2 (stdlib only, no agent loop).

One direct request/response call — no sidecar, no SSE, no tool loop. Most
providers speak the OpenAI /chat/completions shape, so they share a single code
path with a different base URL + key; Gemini has its own endpoint. Free-tier
friendly (Groq, Mistral, Cerebras, OpenRouter free models, local Ollama).
"""

from __future__ import annotations

import json
import urllib.request
from typing import Dict

# OpenAI-compatible providers: same request/response, only base_url differs.
OPENAI_COMPATIBLE: Dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "groq": "https://api.groq.com/openai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "together": "https://api.together.xyz/v1",
    "cerebras": "https://api.cerebras.ai/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "ollama": "http://127.0.0.1:11434/v1",  # local, no key
}


class LLMError(RuntimeError):
    pass


def _post(url: str, headers: Dict[str, str], body: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise LLMError(f"{e.code} {e.reason}: {detail}")
    except Exception as e:
        raise LLMError(str(e))


def call(provider: str, model: str, api_key: str, system: str, user: str,
         temperature: float = 0.4, json_mode: bool = True) -> str:
    """Return the assistant text for one prompt. Raises LLMError on failure."""
    provider = (provider or "").lower().strip()

    if provider in OPENAI_COMPATIBLE:
        base = OPENAI_COMPATIBLE[provider]
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        if provider == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/Sekiph82/FormuLab"
            headers["X-Title"] = "FormuLab"
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        data = _post(f"{base}/chat/completions", headers, body)
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise LLMError(f"unexpected response shape: {json.dumps(data)[:300]}")

    if provider in ("gemini", "google"):
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={api_key}")
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": temperature,
                **({"responseMimeType": "application/json"} if json_mode else {}),
            },
        }
        data = _post(url, {}, body)
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise LLMError(f"unexpected Gemini response: {json.dumps(data)[:300]}")

    raise LLMError(f"unknown provider: {provider!r}")


def parse_json(text: str) -> dict:
    """Parse the model's JSON, tolerating markdown code fences."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.lstrip().startswith("json"):
            t = t.lstrip()[4:]
    return json.loads(t.strip())
