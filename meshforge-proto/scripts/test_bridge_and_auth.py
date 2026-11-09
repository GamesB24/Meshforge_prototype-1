"""Integration verification test for MeshForge Auth, Agent Bridge, and Sheet Generator."""
import json, sys
from pathlib import Path

# Add root to sys.path
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))

def test_sheet_generator():
    from PIL import Image
    from meshforge.sheet_generator import slice_model_sheet, process_4sided_sheet
    
    # Create test 2x2 grid image (512x512)
    img = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    views = slice_model_sheet(img, layout="2x2")
    assert len(views) == 4, f"Expected 4 views, got {len(views)}"
    assert set(views.keys()) == {"front", "right", "back", "left"}
    print("[OK] sheet_generator slice_model_sheet passed")

    processed = process_4sided_sheet(img)
    assert len(processed) == 4
    for k, v in processed.items():
        assert v.size == (512, 512)
    print("[OK] sheet_generator process_4sided_sheet passed")

def test_auth_and_wallet():
    from meshforge.auth import auth_manager, UserProfile
    
    # Test guest user
    guest = auth_manager.get_user_by_token(None)
    assert guest.user_id == "guest"
    assert guest.wallet_credits >= 500
    print(f"[OK] auth_manager guest session verified ({guest.name}, {guest.wallet_credits} credits)")

    # Test create session
    token = auth_manager.create_session(guest)
    user = auth_manager.get_user_by_token(token)
    assert user.user_id == "guest"
    print("[OK] auth_manager session token creation and retrieval passed")

def test_fastapi_routes():
    from fastapi.testclient import TestClient
    from meshforge.server import app

    client = TestClient(app)

    # 1. Config
    r_cfg = client.get("/api/config")
    assert r_cfg.status_code == 200, f"Config failed: {r_cfg.status_code}"
    print("[OK] GET /api/config returned 200")

    # 2. Auth Session
    r_sess = client.get("/api/auth/session")
    assert r_sess.status_code == 200
    assert r_sess.json()["ok"] is True
    print("[OK] GET /api/auth/session returned 200")

    # 3. Google Login test
    r_goog = client.post("/api/auth/google", json={"profile": {"name": "Test Pilot", "email": "pilot@meshforge.io"}})
    assert r_goog.status_code == 200
    g_tok = r_goog.json()["token"]
    print(f"[OK] POST /api/auth/google succeeded with token {g_tok[:10]}...")

    # 4. Wallet transaction test (debit/transfer for kiosk)
    r_tx = client.post(
        "/api/auth/wallet/transaction",
        headers={"Authorization": f"Bearer {g_tok}"},
        json={"action": "transfer", "amount": 100, "target_agent": "Google Agent Wallet", "reason": "Metaverse test"}
    )
    assert r_tx.status_code == 200
    assert r_tx.json()["new_balance"] == 900
    print(f"[OK] POST /api/auth/wallet/transaction succeeded (new balance: {r_tx.json()['new_balance']})")

    # 5. Agent status
    r_ag = client.get("/api/agent/status")
    assert r_ag.status_code == 200
    assert r_ag.json()["ok"] is True
    print(f"[OK] GET /api/agent/status returned 200 with {len(r_ag.json()['supported_tools'])} tools")

    # 6. Agent command dispatch
    r_cmd = client.post(
        "/api/agent/command",
        headers={"Authorization": f"Bearer {g_tok}"},
        json={"action": "spawn_primitive", "params": {"type": "cube", "color": "#e05555"}}
    )
    assert r_cmd.status_code == 200
    assert r_cmd.json()["ok"] is True
    print("[OK] POST /api/agent/command dispatched successfully")

if __name__ == "__main__":
    print("Running integration tests...")
    test_sheet_generator()
    test_auth_and_wallet()
    test_fastapi_routes()
    print("\nALL BACKEND & INTEGRATION TESTS PASSED SUCCESSFULLY!")
