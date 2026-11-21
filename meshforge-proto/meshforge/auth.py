"""MeshForge Authentication and Agent Wallet Service.
Supports Google OAuth2 / ID token verification, OpenAI API credentials, and in-game wallet transactions.
"""
from __future__ import annotations
import json, os, time, uuid, urllib.request, urllib.error
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Dict, Optional, Any
from fastapi import APIRouter, HTTPException, Header, Body

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

router = APIRouter(prefix="/api/auth", tags=["auth"])

@dataclass
class UserProfile:
    user_id: str
    email: str
    name: str
    picture: str
    provider: str  # "google", "openai", "guest"
    wallet_credits: int = 1000
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

class AuthManager:
    def __init__(self):
        self.users: Dict[str, UserProfile] = {}
        self.sessions: Dict[str, str] = {}  # session_token -> user_id
        self._load()
        self._load_sessions()
        if "guest" not in self.users:
            guest = UserProfile(
                user_id="guest",
                email="guest@meshforge.local",
                name="Guest Creator",
                picture="",
                provider="guest",
                wallet_credits=500
            )
            self.users["guest"] = guest
            self._save()

    def _load(self):
        if USERS_FILE.is_file():
            try:
                data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
                for uid, udata in data.items():
                    self.users[uid] = UserProfile(**udata)
            except Exception:
                pass

    def _save(self):
        try:
            raw = {uid: asdict(u) for uid, u in self.users.items()}
            USERS_FILE.write_text(json.dumps(raw, indent=2), encoding="utf-8")
        except Exception:
            pass

    def _load_sessions(self):
        if SESSIONS_FILE.is_file():
            try:
                data = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self.sessions = {k: v for k, v in data.items() if v in self.users}
            except Exception:
                pass

    def _save_sessions(self):
        try:
            SESSIONS_FILE.write_text(json.dumps(self.sessions), encoding="utf-8")
        except Exception:
            pass

    def create_session(self, user: UserProfile) -> str:
        token = f"mf_sess_{uuid.uuid4().hex}"
        self.sessions[token] = user.user_id
        user.last_active = time.time()
        self._save()
        self._save_sessions()
        return token

    def get_user_by_token(self, token: Optional[str]) -> UserProfile:
        if not token:
            return self.users["guest"]
        token = token.replace("Bearer ", "").strip()
        uid = self.sessions.get(token)
        if uid and uid in self.users:
            user = self.users[uid]
            user.last_active = time.time()
            return user
        return self.users["guest"]

auth_manager = AuthManager()

@router.get("/session")
def get_session(authorization: Optional[str] = Header(None)):
    user = auth_manager.get_user_by_token(authorization)
    return {"ok": True, "user": asdict(user)}

def probe_provider(provider: str, api_key: str, base_url: str = "") -> Dict[str, Any]:
    """Cheap authenticated read. The key is not logged or stored."""
    key = (api_key or "").strip()
    if not key:
        return {"ok": False, "provider": provider, "message": "Enter an API key first."}
    provider = (provider or "").lower()
    base = (base_url or "").strip().rstrip("/")
    try:
        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={urllib.request.quote(key)}"
            req = urllib.request.Request(url, headers={"User-Agent": "MeshForge"})
        elif provider == "anthropic":
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "User-Agent": "MeshForge"},
            )
        else:
            if provider == "openai":
                url = "https://api.openai.com/v1/models"
            elif provider == "xai":
                url = "https://api.x.ai/v1/models"
            elif provider == "custom":
                if not base:
                    return {"ok": False, "provider": provider, "message": "A custom provider needs a base URL, for example https://host/v1"}
                url = base + "/models"
            else:
                return {"ok": False, "provider": provider, "message": "Unknown provider. Use openai, anthropic, gemini, xai, or custom."}
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "User-Agent": "MeshForge"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            if 200 <= resp.status < 300:
                return {"ok": True, "provider": provider, "message": f"{provider} accepted this key."}
            return {"ok": False, "provider": provider, "message": f"{provider} returned HTTP {resp.status}."}
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return {"ok": False, "provider": provider, "message": f"{provider} rejected this key (HTTP {e.code})."}
        return {"ok": False, "provider": provider, "message": f"{provider} returned HTTP {e.code}."}
    except Exception as e:
        return {"ok": False, "provider": provider, "message": f"Could not reach {provider}: {e.__class__.__name__}. Check the network and the base URL."}


@router.post("/keys/test")
def test_provider_key(payload: Dict[str, Any] = Body(...)):
    """Validate a provider key. The key is not written to disk."""
    return probe_provider(payload.get("provider", ""), payload.get("api_key", ""), payload.get("base_url", ""))


@router.post("/google")
def login_google(payload: Dict[str, Any] = Body(...)):
    """Authenticate with a Google ID token from Google Identity Services."""
    credential = payload.get("credential") or payload.get("token")
    if not credential:
        raise HTTPException(400, "A Google ID token is required. Set an OAuth client ID, then use Sign in with Google. This does not create a Gemini API key.")
    try:
        url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.request.quote(credential)
        req = urllib.request.Request(url, headers={"User-Agent": "MeshForge"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            gdata = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise HTTPException(401, f"Google rejected that sign-in token (HTTP {e.code}).")
    except Exception as e:
        raise HTTPException(502, f"Could not reach Google to verify sign-in ({e.__class__.__name__}).")
    email = gdata.get("email")
    sub = gdata.get("sub")
    if not email or not sub:
        raise HTTPException(401, "Google did not return an email for that token.")
    aud = payload.get("client_id")
    if aud and gdata.get("aud") and gdata.get("aud") != aud:
        raise HTTPException(401, "That Google token was issued for a different OAuth client ID.")
    name = gdata.get("name") or email.split("@")[0]
    picture = gdata.get("picture", "")
    user_id = f"google_{sub}"
    if user_id not in auth_manager.users:
        user = UserProfile(
            user_id=user_id,
            email=email,
            name=name or "Google Creator",
            picture=picture,
            provider="google",
            wallet_credits=1000
        )
        auth_manager.users[user_id] = user
    else:
        user = auth_manager.users[user_id]
        user.name = name or user.name
        user.picture = picture or user.picture

    token = auth_manager.create_session(user)
    return {"ok": True, "token": token, "user": asdict(user)}

@router.post("/openai")
def login_openai(payload: Dict[str, Any] = Body(...)):
    """Validate OpenAI API key / account and establish session."""
    api_key = payload.get("api_key", "").strip()
    nickname = payload.get("nickname", "OpenAI Pilot").strip()
    
    if not api_key:
        raise HTTPException(400, "API key required")
    checked = probe_provider("openai", api_key)
    if not checked["ok"]:
        raise HTTPException(401, checked["message"])
    verified = True

    masked = f"sk-...{api_key[-4:]}" if len(api_key) > 8 else "sk-key"
    user_id = f"openai_{abs(hash(api_key))}"
    
    if user_id not in auth_manager.users:
        user = UserProfile(
            user_id=user_id,
            email=f"{masked}@openai.agent",
            name=nickname or f"OpenAI ({masked})",
            picture="",
            provider="openai",
            wallet_credits=1000,
            metadata={"masked_key": masked}
        )
        auth_manager.users[user_id] = user
    else:
        user = auth_manager.users[user_id]
        user.name = nickname or user.name
        user.metadata["masked_key"] = masked

    token = auth_manager.create_session(user)
    return {"ok": True, "token": token, "user": asdict(user), "verified": verified}

@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        auth_manager.sessions.pop(token, None)
    return {"ok": True}

@router.get("/wallet")
def get_wallet(authorization: Optional[str] = Header(None)):
    user = auth_manager.get_user_by_token(authorization)
    return {"ok": True, "user_id": user.user_id, "wallet_credits": user.wallet_credits}

@router.post("/wallet/transaction")
def wallet_transaction(payload: Dict[str, Any] = Body(...), authorization: Optional[str] = Header(None)):
    """Handle in-game kiosk purchases, generation costs, or agent transfers."""
    user = auth_manager.get_user_by_token(authorization)
    action = payload.get("action", "credit")  # "credit", "debit", "transfer"
    amount = int(payload.get("amount", 0))
    reason = payload.get("reason", "Metaverse exchange")
    target_agent = payload.get("target_agent", "Google Assistant / Agent")

    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    if action == "debit" or action == "transfer":
        if user.wallet_credits < amount:
            raise HTTPException(400, f"Insufficient credits (balance: {user.wallet_credits})")
        user.wallet_credits -= amount
    elif action == "credit":
        user.wallet_credits += amount

    auth_manager._save()
    return {
        "ok": True,
        "action": action,
        "amount": amount,
        "new_balance": user.wallet_credits,
        "reason": reason,
        "target_agent": target_agent,
        "timestamp": time.time()
    }
