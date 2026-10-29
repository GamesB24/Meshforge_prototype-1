"""Modal serverless GPU worker for MeshForge.  *** UNTESTED: written against Modal's public docs, never deployed. ***

Deploy (needs a Modal account; costs money per GPU-second after free credit):
    pip install modal && modal token new
    modal deploy cloud/modal_app.py
Then run the app with:  MESHFORGE_CLOUD=modal ./run.sh
"""
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.4.0", "torchvision==0.19.0", "trimesh", "omegaconf", "einops", "transformers==4.44.2",
                 "huggingface-hub", "Pillow", "numpy", "scikit-image", "xatlas", "imageio")
    .run_commands("git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git /opt/TripoSR",
                  "pip install git+https://github.com/tatsy/torchmcubes.git || true")
)
app = modal.App("meshforge", image=image)
weights = modal.Volume.from_name("meshforge-hf-cache", create_if_missing=True)


@app.cls(gpu="L4", volumes={"/root/.cache/huggingface": weights}, scaledown_window=60, timeout=600)
class TripoSR:
    @modal.enter()
    def load(self):
        import sys
        sys.path.insert(0, "/opt/TripoSR")
        from tsr.system import TSR
        self.model = TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt").to("cuda")
        self.model.renderer.set_chunk_size(8192)

    @modal.method()
    def run(self, png: bytes, params: dict) -> bytes:
        import io, torch
        from PIL import Image
        img = Image.open(io.BytesIO(png)).convert("RGB")
        with torch.no_grad():
            codes = self.model([img], device="cuda")
        mesh = self.model.extract_mesh(codes, True, resolution=int(params.get("resolution", 256)))[0]
        return mesh.export(file_type="glb")


@app.function()
def generate(engine_id: str, png: bytes, params: dict) -> bytes:
    if engine_id != "triposr":
        raise ValueError(f"engine {engine_id} not deployed on Modal yet")
    return TripoSR().run.remote(png, params)
