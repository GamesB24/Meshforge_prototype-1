"""MeshForge local plugin support (original MIT code).

Plugins are trusted local Python/JavaScript, not sandboxed extensions.
"""
from .jobs import start

__all__ = ["start"]
