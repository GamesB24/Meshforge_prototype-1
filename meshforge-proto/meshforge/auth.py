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

    def create_session(self, user: UserProfile) -> str:
        token = f"mf_sess_{uuid.uuid4().hex}"
        self.sessions[token] = user.user_id
        user.last_active = time.time()
        self._save()
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

@router.post("/google")
def login_google(payload: Dict[str, Any] = Body(...)):
    """Authenticate with Google token (ID token or credential string)."""
    credential = payload.get("credential") or payload.get("token")
    client_profile = payload.get("profile") or {}
    
    email = client_profile.get("email")
    name = client_profile.get("name")
    picture = client_profile.get("picture", "")
    sub = client_profile.get("sub") or str(uuid.uuid4())

    # If an ID token was passed, attempt verification with Google tokeninfo endpoint
    if credential and not email:
        try:
            url = f"https://oauth2.googleapis.com/tokeninfo?id_token={credential}"
            req = urllib.request.Request(url, headers={"User-Agent": "MeshForge-Server"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                gdata = json.loads(resp.read().decode("utf-8"))
                email = gdata.get("email")
                name = gdata.get("name", email.split("@")[0] if email else "Google User")
                picture = gdata.get("picture", "")
                sub = gdata.get("sub", sub)
        except Exception:
            pass

    if not email:
        email = f"google_user_{sub[:8]}@gmail.com"
        name = name or "Google Creator"

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
    
    verified = False
    try:
        req = urllib.request.Request(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}", "User-Agent": "MeshForge-Server"}
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                verified = True
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise HTTPException(401, "Invalid OpenAI API Key")
        verified = True
    except Exception:
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
