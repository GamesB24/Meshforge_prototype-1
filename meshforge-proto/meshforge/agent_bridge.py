"""MeshForge AI Agent Bridge: WebSocket & REST API.
Enables AI agents (Google Antigravity, local Python agents, LLM pipelines)
to receive engine events, send commands, and interact with the 3D runtime.
"""
from __future__ import annotations
import json, asyncio, time
from typing import Dict, Set, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Body, HTTPException, Header
from .auth import auth_manager

router = APIRouter(prefix="/api/agent", tags=["agent"])

class AgentBridgeManager:
    def __init__(self):
        # Active websocket connections: web client(s) and external agent(s)
        self.active_connections: Set[WebSocket] = set()
        self.agent_metadata: Dict[WebSocket, Dict[str, Any]] = {}
        self.event_history: list = []

    async def connect(self, websocket: WebSocket, client_type: str = "agent", token: Optional[str] = None):
        await websocket.accept()
        self.active_connections.add(websocket)
        user = auth_manager.get_user_by_token(token)
        self.agent_metadata[websocket] = {
            "type": client_type,
            "connected_at": time.time(),
            "user_id": user.user_id,
            "user_name": user.name
        }
        # Send welcome handshake
        await websocket.send_json({
            "type": "handshake",
            "status": "connected",
            "server_time": time.time(),
            "user": {"id": user.user_id, "name": user.name, "provider": user.provider}
        })

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.agent_metadata.pop(websocket, None)

    async def broadcast(self, message: Dict[str, Any], sender: Optional[WebSocket] = None):
        """Broadcast an event or command to all connected peers except sender."""
        dead = []
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead.append(connection)
        for d in dead:
            self.disconnect(d)

    async def dispatch_command(self, action: str, params: Dict[str, Any], user_id: str = "guest") -> Dict[str, Any]:
        """Send an action command to the active browser frontend session."""
        msg = {
            "type": "agent_action",
            "action": action,
            "params": params,
            "user_id": user_id,
            "timestamp": time.time()
        }
        await self.broadcast(msg)
        return {"ok": True, "dispatched": action, "timestamp": time.time()}

bridge_manager = AgentBridgeManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, client_type: str = "agent", token: Optional[str] = None):
    await bridge_manager.connect(websocket, client_type=client_type, token=token)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
            except Exception:
                continue

            msg_type = payload.get("type", "message")
            
            # If a client sends an action or speech transcription, broadcast to peers
            if msg_type in ("agent_action", "voice_transcript", "companion_dialogue", "scene_update", "player_state"):
                # Tag sender identity
                meta = bridge_manager.agent_metadata.get(websocket, {})
                payload["user_id"] = meta.get("user_id", "guest")
                await bridge_manager.broadcast(payload, sender=websocket)
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong", "time": time.time()})
    except WebSocketDisconnect:
        bridge_manager.disconnect(websocket)
    except Exception:
        bridge_manager.disconnect(websocket)

@router.get("/status")
def bridge_status():
    return {
        "ok": True,
        "connections_count": len(bridge_manager.active_connections),
        "clients": list(bridge_manager.agent_metadata.values()),
        "supported_tools": [
            "list_tools", "get_scene_summary", "list_objects",
            "spawn_primitive", "delete_object", "transform_object",
            "set_behaviour", "attach_script", "build_level", "generate_level",
            "set_material", "set_shading", "set_environment",
            "companion_speak", "transfer_credits",
        ],
        "note": "This process only relays commands to the open browser. The page executes the tools.",
    }

@router.post("/command")
async def post_command(payload: Dict[str, Any] = Body(...), authorization: Optional[str] = Header(None)):
    user = auth_manager.get_user_by_token(authorization)
    action = payload.get("action")
    params = payload.get("params", {})
    if not action:
        raise HTTPException(400, "Missing 'action' parameter")
    result = await bridge_manager.dispatch_command(action, params, user_id=user.user_id)
    return result
