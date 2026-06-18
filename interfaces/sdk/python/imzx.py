"""
imzx-agent-sdk Python SDK — standalone wrapper for the REST API.

Usage:
    from imzx import ImzxAgent

    agent = ImzxAgent("http://localhost:3000", api_key="*** # Synchronous
    response = agent.run("What is Rust?", persona="general-purpose")

    # Streaming
    for chunk in agent.stream("Explain ownership"):
        print(chunk, end="", flush=True)

    # Chat (OpenAI-compatible)
    response = agent.chat([{"role": "user", "content": "Hello!"}])

    # Stats
    stats = agent.stats()
"""

import json
import urllib.request
import urllib.error
from typing import Iterator, Optional


class ImzxAgent:
    """Python client for the imzx-agent-sdk REST API."""

    def __init__(self, base_url: str = "http://localhost:3000", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode() if e.fp else str(e)
            raise RuntimeError(f"API error {e.code}: {error_body}") from e

    def run(self, prompt: str, persona: str = "general-purpose", **kwargs) -> str:
        """Run the agent synchronously."""
        body = {"prompt": prompt, "persona": persona, "streaming": False, **kwargs}
        result = self._request("POST", "/api/run", body)
        return result.get("response", "")

    def stream(self, prompt: str, persona: str = "general-purpose", **kwargs) -> Iterator[str]:
        """Run with streaming. Yields text chunks."""
        body = {"prompt": prompt, "persona": persona, "streaming": True, **kwargs}
        url = f"{self.base_url}/api/run"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        data = json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

        with urllib.request.urlopen(req, timeout=300) as resp:
            buffer = ""
            while True:
                chunk = resp.read(1024)
                if not chunk:
                    break
                buffer += chunk.decode()
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip()
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload == "[DONE]":
                        return
                    try:
                        obj = json.loads(payload)
                        if obj.get("type") == "text":
                            yield obj.get("content", "")
                        elif obj.get("type") == "tool_call":
                            yield f"\n[Tool: {obj.get('content', '')}] "
                        elif obj.get("type") == "tool_result":
                            yield "✓"
                        elif obj.get("type") == "thinking":
                            yield f"\n⟳ {obj.get('content', '')}\n"
                    except json.JSONDecodeError:
                        continue

    def chat(self, messages: list, model: str = "default") -> dict:
        """OpenAI-compatible chat completion."""
        body = {"messages": messages, "model": model}
        return self._request("POST", "/api/chat", body)

    def stats(self) -> dict:
        return self._request("GET", "/api/stats")

    def health(self) -> dict:
        return self._request("GET", "/api/health")

    def personas(self) -> list:
        result = self._request("GET", "/api/personas")
        return result.get("personas", [])

    def __repr__(self) -> str:
        return f"ImzxAgent(base_url='{self.base_url}')"
