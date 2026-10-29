# Hardware, speed and cloud research (checked 25 Oct 2026)

Target laptop: Windows, RTX 4060 Laptop (8 GB VRAM), 16 GB RAM, ~237 GB free.
"Verified" = stated in the official repo/model card/issue linked. "Unverified" = my estimate, needs testing on the laptop.

## Engines

| Engine | Licence | Official requirement | Speed | Fits 8 GB RTX 4060? |
|---|---|---|---|---|
| **TripoSR** ([repo](https://github.com/VAST-AI-Research/TripoSR), [model](https://huggingface.co/stabilityai/TripoSR)) | MIT | **Verified:** "default options take about 6GB VRAM for a single image" (README) | **Verified:** <0.5 s on A100 (README). **Measured here:** 23–45 s on 8-core CPU incl. background removal; peak ~2.9 GB RAM after our rembg fix | **Yes** (verified VRAM number). fp16 autocast is enabled on CUDA in our engine (unverified speed gain). Lower marching-cubes resolution if needed |
| **PartCrafter** ([repo](https://github.com/wgsxm/PartCrafter)) | MIT | **Verified:** "A CUDA-enabled GPU with at least 8GB VRAM. You can reduce number of parts or number of tokens to save GPU memory" (default 1024 tokens/part). Tested by authors on H20 GPUs, Debian | Unverified (diffusion; expect tens of seconds on a 4060) | **Borderline yes**: 8 GB is the stated minimum; a laptop also uses some VRAM for the display, so use fewer parts / fewer tokens. Windows: community [fork](https://github.com/JackDainzh/PartCrafter-Windows/tree/windows-main) and [PR #24](https://github.com/wgsxm/PartCrafter/pull/24). OOM reports exist for training ([#40](https://github.com/wgsxm/PartCrafter/issues/40)), not inference |
| **OmniPart** ([repo](https://github.com/HKU-MMLab/OmniPart), [HF](https://huggingface.co/omnipart)) | MIT (repo) | **Unverified:** README states no VRAM figure. It is built on TRELLIS (v1) latents; TRELLIS v1's README asks for ≥16 GB | Unverified | **Probably not** without heavy trimming; plan cloud. Needs a part mask (.exr) per image - matches your colour-coded part idea |
| **TRELLIS.2-4B** ([repo](https://github.com/microsoft/TRELLIS.2)) | MIT; deps **nvdiffrast** and **nvdiffrec** use the *NVIDIA Source Code License* - "non-commercially = research or evaluation purposes only" | **Verified:** "An NVIDIA GPU with at least 24GB of memory is necessary", Linux only, CUDA 12.4. Issues report spikes: [OOM on A100 80GB with low_vram off (#55)](https://github.com/microsoft/TRELLIS.2/issues/55), [peaks over 63 GB (#24)](https://github.com/microsoft/TRELLIS.2/issues/24) | Tested on H100 (README) | **No.** Cloud only (24 GB+; use `low_vram`). Commercial use: replace or licence nvdiffrast/nvdiffrec first |
| Hunyuan3D 2.x | Tencent licence excludes UK/EU | - | - | **Avoid** |

**Next engine for the laptop: PartCrafter** (MIT, stated 8 GB minimum, multi-part output that our per-part GLB export already supports).

## Cloud GPU options (public pricing pages, Oct 2026; GPU only, CPU/RAM extra where noted)

| Option | Price examples | Billing | Integration effort |
|---|---|---|---|
| **Modal** ([pricing](https://modal.com/pricing)) | L4 24 GB $0.000222/s (~$0.80/h), A10 $0.000306/s, A100 40 GB $0.000583/s, A100 80 GB $0.000694/s, H100 $0.001097/s. CPU/RAM billed on top; non-preemptible 3x, region pinning 1.15–1.75x; Starter plan includes $30/month free compute | per second, scale to zero | **Simplest**: pure Python, no Docker; `modal deploy` + call a function. **Chosen** (`cloud/modal_app.py`, untested) |
| RunPod Serverless ([pricing](https://www.runpod.io/pricing)) | 24 GB class (L4/A5000/3090) $0.69/h, 4090 $1.10/h, A100 80 GB $2.72/h (flex workers) | per second incl. cold start + idle timeout | Medium: build/push a Docker worker image, then a simple HTTP `/run` + `/status` API |
| Replicate | A100 80 GB $0.0014/s (~$5.04/h), H100 $0.001525/s ([source summary](https://gpuperhour.com/blog/serverless-gpu-pricing)) | public models: active time only; private deployments: all online time | Medium: package with Cog; easiest if a public model already exists |
| HF Inference Endpoints | not checked this run (unverified) | per hour while running | Medium; needs custom handler for 3D |
| **Your own SSH GPU** (RunPod/Lambda/Vast pod, any Linux GPU box) | e.g. RunPod pods; varies | hourly while on | Already supported: run MeshForge there, `ssh -L`, set `MESHFORGE_CLOUD=remote` |

Rough cost per TripoSR generation on Modal L4 (unverified timing: ~5 s warm, +30–90 s cold start): well under $0.01 warm, ~$0.02 with a cold start.

## Windows: WSL2 vs native

- **Recommended: WSL2 + Ubuntu 22.04/24.04.** Install the normal NVIDIA Windows driver only (no Linux driver inside WSL); CUDA works inside WSL. TRELLIS.2 is Linux-only; PartCrafter and most 3D research code assume Linux; building CUDA extensions (torchmcubes, flash-attn, nvdiffrast) is much easier.
- **Native Windows** works for TripoSR (use the torchmcubes shim if the build fails) and PartCrafter via the community fork, but expect compile pain for every new engine.
- The web UI runs in WSL and opens in your Windows browser at `http://127.0.0.1:8000` (WSL2 forwards localhost).
