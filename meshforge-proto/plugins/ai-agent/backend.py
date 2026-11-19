"""AI Agent proxy. The provider key arrives per request and is not stored or logged.

Original MIT code. Stdlib HTTP only.
"""
from __future__ import annotations
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

from fastapi import APIRouter, Body, Request

router = APIRouter()

_DEFAULTS = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "xai": "https://api.x.ai/v1",
    "compatible": "http://127.0.0.1:11434/v1",
}
_SUGGESTED = {
    "anthropic": ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
    "openai": ["gpt-4o-mini", "gpt-4o"],
    "xai": ["grok-2-latest", "grok-2-image"],
    "compatible": [],
}


def _scrub(text: str, key: str) -> str:
    out = str(text or "")
    if key:
        out = out.replace(key, "[REDACTED]")
    return out[:500]


def _loopback(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost"}


def resolve_base(provider: str, requested: str | None) -> str:
    if provider not in _DEFAULTS:
        raise ValueError("Unknown provider")
    default = _DEFAULTS[provider]
    asked = (requested or "").strip().rstrip("/")
    if provider == "compatible":
        if not asked:
            raise ValueError("A base URL is required for a custom endpoint")
        return asked
    if asked and _loopback(asked):
        return asked
    return default


def resolve_google(requested: str | None) -> str:
    asked = (requested or "").strip().rstrip("/")
    if asked and _loopback(asked):
        return asked
    return "https://generativelanguage.googleapis.com/v1beta"


def _key(request: Request, name: str) -> str:
    return request.headers.get(f"x-plugin-secret-{name}") or request.headers.get(f"X-Plugin-Secret-{name}") or ""


def _http(method: str, url: str, headers: dict, body: dict | None = None, timeout: float = 25):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except Exception as exc:
        raise ConnectionError("network") from exc


def _json_body(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode() or "{}")
        return data if isinstance(data, dict) else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _auth_headers(provider: str, key: str) -> dict:
    if provider == "anthropic":
        return {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    return {"Authorization": "Bearer " + key, "content-type": "application/json"}


def verify(provider: str, key: str, base: str) -> list[str]:
    url = base.rstrip("/") + ("/v1/models" if provider == "anthropic" and not base.rstrip("/").endswith("/v1") else "/models")
    if provider == "anthropic" and base.rstrip("/").endswith("/v1"):
        url = base.rstrip("/") + "/models"
    status, raw = _http("GET", url, _auth_headers(provider, key), timeout=12)
    if status in (401, 403):
        raise PermissionError("invalid")
    if status >= 400:
        raise ConnectionError("network")
    data = _json_body(raw)
    found = []
    for item in data.get("data") or data.get("models") or []:
        if isinstance(item, dict):
            mid = item.get("id") or item.get("name")
            if isinstance(mid, str):
                found.append(mid.split("/")[-1])
        elif isinstance(item, str):
            found.append(item)
    return found or list(_SUGGESTED.get(provider) or [])


def _openai_messages(messages: list) -> list:
    out = []
    for msg in messages:
        role = msg.get("role")
        if role == "tool":
            out.append({"role": "tool", "tool_call_id": msg.get("tool_call_id") or "", "content": str(msg.get("content") or "")[:8000]})
        elif role == "assistant" and msg.get("tool_calls"):
            calls = []
            for call in msg["tool_calls"]:
                args = call.get("arguments") if isinstance(call.get("arguments"), str) else json.dumps(call.get("arguments") or {})
                calls.append({"id": call.get("id") or "call", "type": "function", "function": {"name": call.get("name"), "arguments": args}})
            out.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        else:
            out.append({"role": role if role in ("user", "assistant", "system") else "user", "content": str(msg.get("content") or "")[:8000]})
    return out


def _anthropic_messages(messages: list) -> list:
    out = []
    for msg in messages:
        role = msg.get("role")
        if role == "tool":
            out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": msg.get("tool_call_id") or "", "content": str(msg.get("content") or "")[:8000]}]})
        elif role == "assistant" and msg.get("tool_calls"):
            blocks = []
            if msg.get("content"):
                blocks.append({"type": "text", "text": str(msg["content"])[:8000]})
            for call in msg["tool_calls"]:
                blocks.append({"type": "tool_use", "id": call.get("id") or "call", "name": call.get("name"), "input": call.get("arguments") or {}})
            out.append({"role": "assistant", "content": blocks})
        elif role == "assistant":
            out.append({"role": "assistant", "content": str(msg.get("content") or "")[:8000]})
        else:
            out.append({"role": "user", "content": str(msg.get("content") or "")[:8000]})
    return out


def _parse_openai(data: dict) -> dict:
    message = ((data.get("choices") or [{}])[0].get("message") or {})
    calls = []
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        raw = fn.get("arguments") or "{}"
        try:
            args = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            args = {}
        calls.append({"id": call.get("id") or "call", "name": fn.get("name") or "", "arguments": args if isinstance(args, dict) else {}})
    return {"text": message.get("content") or "", "tool_calls": calls}


def _parse_anthropic(data: dict) -> dict:
    text = []
    calls = []
    for block in data.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            text.append(block.get("text") or "")
        elif block.get("type") == "tool_use":
            calls.append({"id": block.get("id") or "call", "name": block.get("name") or "", "arguments": block.get("input") or {}})
    return {"text": "\n".join(text), "tool_calls": calls}


def complete(provider: str, key: str, base: str, model: str, messages: list, tools: list) -> dict:
    headers = _auth_headers(provider, key)
    if provider == "anthropic":
        url = base.rstrip("/") + ("/messages" if base.rstrip("/").endswith("/v1") else "/v1/messages")
        body = {
            "model": model,
            "max_tokens": 800,
            "messages": _anthropic_messages(messages),
            "tools": [{"name": t["name"], "description": t.get("description") or "", "input_schema": t.get("parameters") or {"type": "object", "properties": {}}} for t in tools],
        }
        status, raw = _http("POST", url, headers, body)
        parsed = _parse_anthropic(_json_body(raw))
    else:
        url = base.rstrip("/") + "/chat/completions"
        body = {"model": model, "messages": _openai_messages(messages), "tools": [{"type": "function", "function": {"name": t["name"], "description": t.get("description") or "", "parameters": t.get("parameters") or {"type": "object", "properties": {}}}} for t in tools]}
        status, raw = _http("POST", url, headers, body)
        parsed = _parse_openai(_json_body(raw))
    if status in (401, 403):
        raise PermissionError("invalid")
    if status >= 400:
        raise ConnectionError("network")
    parsed["text"] = _scrub(parsed.get("text") or "", key)
    return parsed


def _image_from(data: dict, key: str) -> str:
    item = ((data.get("data") or data.get("images") or [None])[0]) or {}
    if isinstance(item, str):
        return item if item.startswith("data:") else ""
    b64 = item.get("b64_json") or item.get("base64")
    if b64:
        return "data:image/png;base64," + _scrub(b64, key)
    return ""


@router.get("/providers")
def providers():
    return {"providers": [{"id": k, "models": v, "needsBase": k == "compatible"} for k, v in _SUGGESTED.items()]}


@router.post("/connect")
def connect(request: Request, body: dict = Body(...)):
    key = _key(request, "Provider")
    provider = str(body.get("provider") or "")
    if not key:
        return {"ok": False, "status": "invalid", "message": "Invalid key"}
    try:
        base = resolve_base(provider, body.get("base"))
        models = verify(provider, key, base)
    except PermissionError:
        return {"ok": False, "status": "invalid", "message": "Invalid key"}
    except ValueError as exc:
        return {"ok": False, "status": "invalid", "message": _scrub(str(exc), key)}
    except Exception:
        return {"ok": False, "status": "network", "message": "Network error"}
    return {"ok": True, "status": "connected", "message": "Connected", "models": models[:40]}


@router.post("/chat")
def chat(request: Request, body: dict = Body(...)):
    key = _key(request, "Provider")
    provider = str(body.get("provider") or "")
    if not key:
        return {"ok": False, "status": "invalid", "message": "Invalid key"}
    try:
        base = resolve_base(provider, body.get("base"))
        result = complete(provider, key, base, str(body.get("model") or ""), list(body.get("messages") or []), list(body.get("tools") or []))
    except PermissionError:
        return {"ok": False, "status": "invalid", "message": "Invalid key"}
    except Exception:
        return {"ok": False, "status": "network", "message": "Network error"}
    return {"ok": True, "status": "connected", **result}


@router.post("/image")
def image(request: Request, body: dict = Body(...)):
    """Paid image call. OpenAI and xAI only. The picture comes back as a data URL."""
    key = _key(request, "Provider")
    provider = str(body.get("provider") or "")
    if provider not in ("openai", "xai", "compatible"):
        return {"ok": False, "status": "unsupported", "message": "This provider has no image API in MeshForge. Use OpenAI, xAI, or an OpenAI-compatible image endpoint.", "spends": False}
    if not key:
        return {"ok": False, "status": "invalid", "message": "Invalid key", "spends": True}
    try:
        base = resolve_base(provider, body.get("base"))
        status, raw = _http("POST", base.rstrip("/") + "/images/generations", _auth_headers(provider, key), {"model": body.get("imageModel") or ("dall-e-3" if provider == "openai" else "grok-2-image"), "prompt": str(body.get("prompt") or "")[:2000], "n": 1, "size": "1024x1024"})
    except Exception:
        return {"ok": False, "status": "network", "message": "Network error", "spends": True}
    if status in (401, 403):
        return {"ok": False, "status": "invalid", "message": "Invalid key", "spends": True}
    if status >= 400:
        return {"ok": False, "status": "network", "message": "Network error", "spends": True}
    picture = _image_from(_json_body(raw), key)
    if not picture:
        return {"ok": False, "status": "network", "message": "The provider returned no image", "spends": True}
    return {"ok": True, "status": "connected", "image": picture, "spends": True, "message": "Image ready. This call spends API credit."}


@router.post("/views")
def views(request: Request, body: dict = Body(...)):
    """Optional paid step: four Gemini image calls, one per view. Uses the Google key only."""
    key = _key(request, "Google")
    if not key:
        return {"ok": False, "status": "invalid", "message": "Add a Google key for the multi-view step.", "spends": True}
    base = resolve_google(body.get("base"))
    prompt = str(body.get("prompt") or "object")[:1500]
    model = str(body.get("model") or "gemini-2.5-flash-image")
    images = []
    headers = {"x-goog-api-key": key, "content-type": "application/json"}
    for view in ("front", "back", "left", "right"):
        payload = {"contents": [{"parts": [{"text": f"Product photo, {view} view, plain background, of: {prompt}"}]}]}
        url = f"{base}/models/{model}:generateContent"
        try:
            status, raw = _http("POST", url, headers, payload, timeout=40)
        except Exception:
            return {"ok": False, "status": "network", "message": "Network error", "spends": True, "images": images}
        if status in (401, 403):
            return {"ok": False, "status": "invalid", "message": "Invalid key", "spends": True}
        if status >= 400:
            return {"ok": False, "status": "network", "message": "Network error", "spends": True, "images": images}
        data = _json_body(raw)
        picture = ""
        for cand in data.get("candidates") or []:
            for part in ((cand.get("content") or {}).get("parts") or []):
                inline = part.get("inlineData") or part.get("inline_data") or {}
                if inline.get("data"):
                    picture = "data:image/png;base64," + _scrub(inline["data"], key)
        if not picture and data.get("image"):
            picture = _image_from(data, key)
        if picture:
            images.append({"view": view, "image": picture})
    if len(images) < 4:
        return {"ok": False, "status": "network", "message": "The view step did not return four images", "spends": True, "images": images}
    return {"ok": True, "status": "connected", "images": images, "spends": True, "message": "Four views ready. This step made four paid Gemini image calls."}
