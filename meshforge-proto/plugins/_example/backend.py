"""Bundled example backend: trusted local code, original MIT."""
import time
from fastapi import APIRouter, Request
from meshforge.plugins import jobs

router = APIRouter()


@router.post("/work")
def work(request: Request):
    # Deliberately never read/log the secret: the endpoint works without it too.
    return {"job_id": jobs.start(_work)}


def _work(progress):
    for i in range(5):
        time.sleep(0.06)
        progress((i + 1) * 20, f"Example step {i + 1}/5")
    return {"message": "Example backend job complete"}


@router.get("/scene")
def scene():
    return {"message": "Use mf.api.getObjects() in the browser for the live scene."}
