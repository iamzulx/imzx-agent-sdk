"""
imzx Python SDK — REST client for imzx-agent-sdk.

Wraps the imzx serve REST API with a clean Python interface.
Zero external deps — uses only urllib.request and asyncio.

Usage:
    from imzx import ImzxAgent

    agent = ImzxAgent("http://localhost:3000")

    # Sync
    result = agent.run("What is Rust?")
    print(result)

    # Async
    import asyncio
    result = asyncio.run(agent.arun("What is Rust?"))

    # Stream
    for chunk in agent.stream("Tell me a story"):
        print(chunk, end="", flush=True)

    # Stats
    stats = agent.stats()
    print(stats)

    # Auto-start server if not running (requires api_key)
    agent = ImzxAgent(api_key="wn_...", auto_start=True)  # starts imzx serve on localhost:3000
"""

import json
import urllib.request
import urllib.error
import subprocess
import atexit
import time
import asyncio
import os
from typing import Any, Iterator, Optional


class ImzxAgent:
    """Python client for the imzx-agent-sdk REST API.

    Args:
        base_url: REST API base URL (default: http://localhost:3000)
        api_key: Optional API key for authentication (required when auto_start=True)
        auto_start: If True, auto-start imzx serve if not reachable (requires api_key, binds to 127.0.0.1)
        timeout: HTTP request timeout in seconds (default: 120)
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3000",
        api_key: Optional[str] = None,
        auto_start: bool = False,
        timeout: int = 120,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._server_process: Optional[subprocess.Popen] = None

        if auto_start:
            if not api_key:
                raise ValueError(
                    "api_key is required when auto_start=True. "
                    "Pass a valid API key to start the server securely."
                )
            if not self._is_server_running():
                self._start_server()

    def _is_server_running(self) -> bool:
        """Check if the imzx server is reachable."""
        try:
            self._request("GET", "/api/health")
            return True
        except Exception:
            return False

    def _start_server(self, port: int = 3000) -> None:
        """Start imzx serve in the background.

        Always binds to 127.0.0.1 (localhost) and passes IMZX_API_KEY
        via environment variable so the server requires authentication.
        """
        env = os.environ.copy()
        env["IMZX_API_KEY"] = self.api_key  # type: ignore[assignment]

        self._server_process = subprocess.Popen(
            [
                "npx",
                "tsx",
                "interfaces/cli/cli-handler.ts",
                "serve",
                "--port",
                str(port),
                "--host",
                "127.0.0.1",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Register cleanup so the subprocess is killed if the Python process exits
        atexit.register(self._cleanup_server)

        # Wait for server to be ready
        for _ in range(30):
            time.sleep(1)
            if self._is_server_running():
                return
        raise RuntimeError("Server failed to start within 30 seconds")

    def _cleanup_server(self) -> None:
        """Terminate the subprocess and wait for it to exit."""
        if self._server_process is not None:
            try:
                self._server_process.terminate()
                self._server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._server_process.kill()
                self._server_process.wait(timeout=5)
            except OSError:
                pass  # Process already exited
            finally:
                self._server_process = None

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        """Make an HTTP request to the REST API."""
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body else None
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body_text = e.read().decode() if e.fp else ""
            try:
                err_data = json.loads(body_text)
                raise RuntimeError(f"API error ({e.code}): {err_data.get('error', body_text)}")
            except (json.JSONDecodeError, AttributeError):
                raise RuntimeError(f"API error ({e.code}): {body_text}")

    def run(self, prompt: str, persona: str = "general-purpose", **kwargs) -> str:
        """Run agent with a prompt (synchronous).

        Args:
            prompt: The prompt to send to the agent
            persona: Persona name (default: general-purpose)
            **kwargs: Additional options (budget, model, etc.)

        Returns:
            Agent response as string
        """
        body = {"prompt": prompt, "persona": persona, "streaming": False}
        if "budget" in kwargs:
            body["budget"] = kwargs["budget"]
        result = self._request("POST", "/api/run", body)
        return result.get("response", "")

    def stream(self, prompt: str, persona: str = "general-purpose", **kwargs) -> Iterator[str]:
        """Run agent with streaming output (generator).

        Args:
            prompt: The prompt to send
            persona: Persona name

        Yields:
            Text chunks as they arrive
        """
        url = f"{self.base_url}/api/run"
        body = json.dumps({"prompt": prompt, "persona": persona, "streaming": True}).encode()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
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
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        return
                    try:
                        data = json.loads(data_str)
                        if data.get("type") == "text":
                            yield data.get("content", "")
                        elif data.get("type") == "done":
                            return
                    except json.JSONDecodeError:
                        continue

    def stats(self) -> dict:
        """Get server/session statistics.

        Returns:
            Dict with stats info
        """
        return self._request("GET", "/api/stats")

    def personas(self) -> list:
        """List available personas.

        Returns:
            List of persona objects
        """
        result = self._request("GET", "/api/personas")
        return result.get("personas", [])

    def health(self) -> dict:
        """Health check.

        Returns:
            Dict with status, version, uptime
        """
        return self._request("GET", "/api/health")

    # ── Async support ──────────────────────────────────────────────────────

    async def arun(self, prompt: str, persona: str = "general-purpose", **kwargs) -> str:
        """Async version of run(). Uses asyncio.to_thread for urllib calls."""
        return await asyncio.to_thread(self.run, prompt, persona, **kwargs)

    async def astream(self, prompt: str, persona: str = "general-purpose", **kwargs) -> list:
        """Async version of stream(). Collects all chunks into a list."""
        return await asyncio.to_thread(lambda: list(self.stream(prompt, persona, **kwargs)))

    async def astats(self) -> dict:
        """Async version of stats()."""
        return await asyncio.to_thread(self.stats)

    def close(self) -> None:
        """Stop the auto-started server (if any)."""
        if self._server_process is not None:
            self._cleanup_server()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def __repr__(self) -> str:
        return f"ImzxAgent(base_url={self.base_url!r})"


# ── Demo ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("imzx Python SDK demo")
    print("=" * 40)

    agent = ImzxAgent()

    try:
        health = agent.health()
        print(f"Server status: {health.get('status', 'unknown')}")
        print(f"Version: {health.get('version', '?')}")
        print(f"Uptime: {health.get('uptime', 0):.0f}s")
    except Exception as e:
        print(f"Server not running: {e}")
        print("Start with: imzx serve --port 3000")
