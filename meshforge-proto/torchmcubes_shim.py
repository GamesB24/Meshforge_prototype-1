# Drop-in replacement for torchmcubes (a C++/CUDA extension that must be compiled: fails on Py3.13
# and on Windows without MSVC Build Tools + CUDA toolkit). Same API, uses scikit-image on CPU;
# marching cubes is a small part of a TripoSR run, so the speed cost is ~1 s.
import torch, numpy as np
from skimage import measure
def marching_cubes(vol, thresh):
    v, f, _, _ = measure.marching_cubes(vol.detach().cpu().numpy(), thresh)
    v = v[:, [2, 1, 0]].copy()  # match torchmcubes (x,y,z) order
    f = f[:, [0, 2, 1]].copy()  # match winding
    return torch.from_numpy(v).float(), torch.from_numpy(f.astype(np.int64))
