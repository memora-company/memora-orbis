import os
import json
import urllib.request
import urllib.parse
import urllib.error
from typing import Dict, Any, Optional, List


class ChallengeDetectedError(urllib.error.HTTPError):
    """The page is a CAPTCHA / bot check / block page / 429 and the daemon runs with
    --on-challenge stop (HTTP 409). Orbis detects challenges; it never solves them."""

    def __init__(self, err: urllib.error.HTTPError, body: Dict[str, Any]):
        super().__init__(err.url, err.code, body.get("error", err.msg), err.hdrs, None)
        self.body = body
        self.challenge: Dict[str, Any] = body.get("challenge") or {}
        self.cooldown_sec: int = body.get("cooldownSec", 0)


class ChallengeCooldownError(urllib.error.HTTPError):
    """Requests to this host are paused after a challenge or 429 (HTTP 429, Retry-After set)."""

    def __init__(self, err: urllib.error.HTTPError, body: Dict[str, Any]):
        super().__init__(err.url, err.code, body.get("error", err.msg), err.hdrs, None)
        self.body = body
        self.host: str = body.get("host", "")
        self.remaining_sec: int = body.get("remainingSec", 0)
        self.challenge: Dict[str, Any] = body.get("challenge") or {}


def _raise_http_error(err: urllib.error.HTTPError) -> None:
    """Re-raise challenge errors as typed subclasses; everything else unchanged."""
    try:
        body = json.loads(err.read().decode("utf-8"))
    except Exception:
        raise err
    code = body.get("code") if isinstance(body, dict) else None
    if code == "ERR_CHALLENGE_DETECTED":
        raise ChallengeDetectedError(err, body) from None
    if code == "ERR_CHALLENGE_COOLDOWN":
        raise ChallengeCooldownError(err, body) from None
    raise err


class OrbisSnapshot:
    def __init__(self, data: Dict[str, Any]):
        self.raw = data
        self.url = data.get("url", "")
        self.title = data.get("title", "")
        self.markdown = data.get("markdown", "")
        self.action_map_text = data.get("actionMapText", "")
        self.actions = data.get("actions", [])
        self.token_estimate = data.get("tokenEstimate", 0)
        self.interactive_count = data.get("interactiveCount", 0)
        # CAPTCHA / bot-check / rate-limit signal of the last navigation (None when none)
        self.challenge: Optional[Dict[str, Any]] = data.get("challenge")
        self.challenge_cooldown_sec: int = data.get("challengeCooldownSec", 0)

    @property
    def blocked(self) -> bool:
        """True when the loaded page is a challenge or block page, not the real page."""
        return bool(self.challenge and self.challenge.get("blocking"))

    def __repr__(self) -> str:
        flag = f" challenge={self.challenge.get('vendor')}/{self.challenge.get('kind')}" if self.challenge else ""
        return f"<OrbisSnapshot '{self.title}' actions={self.interactive_count} tokens={self.token_estimate}{flag}>"

class OrbisAgent:
    """
    🪐 OrbisAgent — Official Python Agent SDK for Orbis by Memora (https://orbis.memora.company).
    Provides 1-line connection and high-velocity agentic browsing for Browser-Use,
    LangChain, CrewAI, AutoGen, and independent LLM agents.
    """

    def __init__(self, base_url: str = "http://localhost:9222", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or os.environ.get("ORBIS_API_KEY") or os.environ.get("MEMORA_API_KEY")

    @classmethod
    def connect(cls, base_url: str = "http://localhost:9222", api_key: Optional[str] = None) -> "OrbisAgent":
        """Connect to a running Orbis Browser daemon."""
        agent = cls(base_url, api_key=api_key)
        # Verify connectivity
        headers = {}
        if agent.api_key:
            headers["x-api-key"] = agent.api_key
            headers["Authorization"] = f"Bearer {agent.api_key}"
        req = urllib.request.Request(f"{agent.base_url}/json/version", headers=headers)
        with urllib.request.urlopen(req, timeout=5) as res:
            if res.status != 200:
                raise ConnectionError(f"Orbis Browser did not respond on {base_url} (HTTP {res.status})")
        return agent

    def _make_headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = extra or {}
        if self.api_key:
            headers["x-api-key"] = self.api_key
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get(self, path: str, params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params:
            url += f"?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers=self._make_headers())
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            _raise_http_error(err)
            raise

    def _post(self, path: str, data: Dict[str, Any], params: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        if params:
            url += f"?{urllib.parse.urlencode(params)}"
        payload = json.dumps(data).encode("utf-8")
        headers = self._make_headers({"Content-Type": "application/json"})
        req = urllib.request.Request(
            url,
            data=payload,
            headers=headers,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            _raise_http_error(err)
            raise

    def goto(self, url: str) -> OrbisSnapshot:
        """Navigate to target URL and return distilled semantic snapshot.

        If the page is a CAPTCHA / bot check / block page / 429, ``snapshot.challenge`` describes it
        and ``snapshot.blocked`` is True. With ``--on-challenge stop`` this raises
        ChallengeDetectedError instead; a host in cooldown raises ChallengeCooldownError.
        """
        data = self._get("/orbis/goto", {"url": url})
        snap = OrbisSnapshot(data.get("snapshot", data))
        snap.challenge = data.get("challenge")
        snap.challenge_cooldown_sec = data.get("challengeCooldownSec", 0)
        return snap

    def snapshot(self, focus_selector: Optional[str] = None, exclude_selectors: Optional[List[str]] = None) -> OrbisSnapshot:
        """Fetch current semantic snapshot with numbered action IDs (@1, @2, ...)."""
        params = {}
        if focus_selector:
            params["focus"] = focus_selector
        if exclude_selectors:
            params["exclude"] = ",".join(exclude_selectors)
        data = self._get("/orbis/snapshot", params)
        return OrbisSnapshot(data)

    def markdown(self) -> str:
        """Return clean, distilled Markdown representation."""
        url = f"{self.base_url}/orbis/snapshot?format=markdown"
        req = urllib.request.Request(url, headers=self._make_headers())
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.read().decode("utf-8")

    def diff(self) -> Dict[str, Any]:
        """Compute state difference from the previous action (added, removed, mutated interactives)."""
        return self._get("/orbis/diff")

    def act(self, action_id: str, text: Optional[str] = None) -> Dict[str, Any]:
        """Click or type into an element using its @actionId (e.g. '@1', '@2') or selector."""
        payload: Dict[str, Any] = {"actionId": action_id}
        if text is not None:
            payload["type"] = "type"
            payload["text"] = text
        else:
            payload["type"] = "click"
        return self._post("/orbis/act", payload)

    def select_option(self, target: str, value_or_text: str) -> Dict[str, Any]:
        """Select a dropdown option by value or visible text using any locator format."""
        return self._post("/orbis/select-option", {"target": target, "value": value_or_text})

    def fill_form(self, fields: Dict[str, str], submit: bool = True) -> Dict[str, Any]:
        """Fill multiple fields in one atomic turn and optionally submit."""
        return self._post("/orbis/fill-form", {"fields": fields, "submit": submit})

    def save_session(self, file_path: str) -> Dict[str, Any]:
        """Save cookies, localStorage, and sessionStorage to a file."""
        return self._post("/orbis/session/save", {"filePath": file_path})

    def load_session(self, file_path: str) -> Dict[str, Any]:
        """Load session from a file."""
        return self._post("/orbis/session", {"filePath": file_path})

    def to_browser_use(self) -> Dict[str, Any]:
        """Return configuration dictionary for Browser-Use in Python."""
        return {
            "cdp_url": self.base_url,
            "disable_security": True
        }

    def to_langchain_tools(self) -> List[Any]:
        """Return LangChain StructuredTool definitions."""
        try:
            from langchain.tools import tool

            @tool
            def orbis_navigate(url: str) -> str:
                """Navigate to a URL and return distilled snapshot and action map."""
                snap = self.goto(url)
                if snap.blocked:
                    ch = snap.challenge or {}
                    return (f"CHALLENGE DETECTED: {ch.get('vendor')} {ch.get('kind')} (HTTP {ch.get('status')}). "
                            "Page content not available. Stop or try later; Orbis does not solve challenges.")
                return f"{snap.action_map_text}\n\n=== CONTENT ===\n{snap.markdown[:4000]}"

            @tool
            def orbis_act(action_id: str, text: Optional[str] = None) -> str:
                """Click or type into an element by its action ID (@1, @2)."""
                res = self.act(action_id, text)
                diff = self.diff()
                return f"Action {action_id} result: {res.get('success')}\nDiff summary:\n{diff.get('diff', {}).get('summary', '')}"

            @tool
            def orbis_diff() -> str:
                """Check what changed on the page after the last action."""
                d = self.diff().get("diff", {})
                return d.get("summary", "No changes detected.")

            return [orbis_navigate, orbis_act, orbis_diff]
        except ImportError:
            raise ImportError("LangChain is not installed. Install via `pip install langchain` to use to_langchain_tools().")

# Backward Compatibility Aliases
MemoraSnapshot = OrbisSnapshot
MemoraAgent = OrbisAgent
