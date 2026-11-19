"""CPU mesh reconstruction, topology and room-placement helpers (original MIT code).

No network, torch or GPU dependencies. Uses numpy; trimesh/scikit-image are already
MeshForge dependencies and are imported only when needed. Voxel operations are approximate:
fine details below the voxel size are lost and exact CAD intersection is not claimed.
"""
from __future__ import annotations
import numpy as np
import trimesh
import copy


def _mesh(vertices, faces):
    import trimesh
    return trimesh.Trimesh(np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int64), process=True)


def watertightness(mesh) -> dict:
    """Counts boundary edges, singular edges, Euler characteristic and connected components."""
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces()); mesh.update_faces(mesh.unique_faces())
    _, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return {"watertight": bool(mesh.is_watertight), "winding_consistent": bool(mesh.is_winding_consistent),
            "boundary_edges": int(np.count_nonzero(counts == 1)), "nonmanifold_edges": int(np.count_nonzero(counts != 2)),
            "euler": int(mesh.euler_number), "components": int(len(mesh.split(only_watertight=False))),
            "vertices": int(len(mesh.vertices)), "triangles": int(len(mesh.faces)), "volume": float(abs(mesh.volume)) if mesh.is_volume else None}


def _surface(grid, bounds):
    from skimage.measure import marching_cubes
    pad = np.pad(grid.astype(bool), 1, constant_values=False)
    if not pad.any():
        raise ValueError("voxel result is empty")
    v, f, _, _ = marching_cubes(pad.astype(np.float32), level=0.5)
    v -= 1
    lo, hi = np.asarray(bounds[0], float), np.asarray(bounds[1], float)
    shape = np.maximum(np.asarray(grid.shape, float) - 1, 1)
    v = lo + v / shape * (hi - lo)
    m = _mesh(v, f)
    if m.volume < 0:
        m.invert()
    m.remove_unreferenced_vertices()
    return m


def _bounds(voxels, bounds):
    if bounds is not None:return bounds
    pts=np.argwhere(voxels)
    lo,hi=pts.min(0),pts.max(0)+1
    return lo.tolist(),hi.tolist()


def voxel_carve(masks, cameras=None, resolution=64, bounds=None, normalize=True, smooth=0):
    """Carve a visual hull from aligned 2D silhouette masks and pinhole cameras.

    masks: iterable of HxW foreground masks. cameras: matching dictionaries with
    `position`/`C` (world camera centre), `target` (look-at) or `R` (3x3 world-to-camera
    rotation), `K` or `focal`/`fx,fy`, `cx,cy` (default mask centre), optional `up`.
    Image projection is x right, image row down; camera looks along local +Z.
    If cameras is None, masks are treated as orthographic elevation projections in the
    provided grid and a true 3D hull requires at least two different masks.
    normalize=True centers the camera-space hull and fits the longest dimension to 2.
    Returns trimesh.Trimesh; use watertightness(result) for a report.
    """
    masks=[np.asarray(m) for m in masks]
    if not masks:
        raise ValueError("at least one silhouette is required")
    n=int(resolution)
    if not 8<=n<=256:raise ValueError("resolution must be between 8 and 256")
    if bounds is None:bounds=([[-1,-1,-1],[1,1,1]] if cameras is not None else None)
    if bounds is not None:
        lo,hi=np.asarray(bounds[0],float),np.asarray(bounds[1],float)
        points=np.array(np.meshgrid(*[np.linspace(lo[i],hi[i],n) for i in range(3)],indexing="ij")).reshape(3,-1).T
        grid=points
    else:points=np.indices((n,n,n),dtype=np.float32).reshape(3,-1).T+.5
    active=np.ones(len(grid),dtype=bool)
    if cameras is None:
        # Interpret masks as slices only when their resolution matches the voxel grid.
        for m in masks:
            if m.ndim!=2 or n not in m.shape:raise ValueError("camera-free masks must be voxel slices at grid resolution")
            active &= m.reshape(-1).astype(bool)
    else:
        if len(cameras)!=len(masks):raise ValueError("masks and cameras must have equal lengths")
        for mask,cam in zip(masks,cameras):
            fg=mask>127 if np.issubdtype(mask.dtype,np.integer) else mask>0.5
            if fg.ndim!=2 or not fg.any():raise ValueError("every mask must contain foreground")
            h,w=fg.shape; C=np.asarray(cam.get("position",cam.get("C")),float)
            K=cam.get("K")
            if "R" in cam:R=np.asarray(cam["R"],float)
            else:
                forward=np.asarray(cam["target"],float)-C;forward/=np.linalg.norm(forward)
                up=np.asarray(cam.get("up",[0,1,0]),float);right=np.cross(up,forward);right/=np.linalg.norm(right)
                upward=np.cross(forward,right);down=-upward
                R=np.stack([right,down,forward])
            if K is not None:fx,fy,cx,cy=K[0,0],K[1,1],K[0,2],K[1,2]
            else:
                focal=float(cam.get("focal",max(w,h)));fx=float(cam.get("fx",focal));fy=float(cam.get("fy",focal))
                cx=float(cam.get("cx",(w-1)/2));cy=float(cam.get("cy",(h-1)/2))
            local=(points-C)@R.T
            z=local[:,2];valid=z>1e-6
            uv=np.column_stack((local[:,0]*fx/z+cx,(h-1-cy)-local[:,1]*fy/z))
            # Y-up world points naturally place image row zero above camera; invert row if upward-facing image convention used.
            ix=np.rint(uv[:,0]).astype(int);iy=np.rint(uv[:,1]).astype(int)
            inb=valid&(ix>=0)&(ix<w)&(iy>=0)&(iy<h);inside=np.zeros(len(points),bool)
            inside[inb]=fg[iy[inb],ix[inb]]
            active &= inside
            if not active.any():break
    vox=active.reshape(n,n,n)
    if smooth:
        from scipy.ndimage import gaussian_filter
        vox=gaussian_filter(vox.astype(float),float(smooth))>.35
    bounds=_bounds(vox,bounds)
    m=_surface(vox,bounds)
    if normalize:
        c=(m.bounds[0]+m.bounds[1])/2;scale=2/max(np.ptp(m.vertices,axis=0).max(),1e-9)
        m.apply_translation(-c);m.apply_scale(scale);m.metadata["meshforge_normalized"]=True
    return m


def _solid(mesh, points, shape):
    # Exact +X slab culling then Moller–Trumbore only over surviving triangles.
    tri=mesh.triangles
    mins=tri.min(axis=1);maxs=tri.max(axis=1)
    result=np.zeros(len(points),int)
    for k,p in enumerate(points):
        candidates=np.flatnonzero((p[1]>=mins[:,1])&(p[1]<maxs[:,1])&(p[2]>=mins[:,2])&(p[2]<maxs[:,2])&(maxs[:,0]>=p[0]+1e-9))
        if not len(candidates):continue
        v=tri[candidates];a=v[:,0];e1=v[:,1]-a;e2=v[:,2]-a
        h=np.cross(np.broadcast_to([1.,0.,0.],e1.shape),e2);det=(e1*h).sum(1)
        good=np.abs(det)>1e-12;a=a[good];e1=e1[good];e2=e2[good];h=h[good];det=det[good]
        o=p-a;u=(o*h).sum(1)/det;q=np.cross(o,e1);vv=q[:,0]/det;t=(q*e2).sum(1)/det
        ts=np.sort(t[(u>=0)&(vv>=0)&(u+vv<=1)&(t>1e-9)])
        result[k]=np.count_nonzero(np.r_[True,np.diff(ts)>1e-8])
    return (result%2==1).reshape(shape)


def mesh_boolean(a,b,operation="union",resolution=64,padding=.04):
    """Approximate voxel union/intersect/difference of watertight meshes; returns Trimesh."""
    if operation not in ("union","intersect","difference"):raise ValueError("operation must be union, intersect or difference")
    n=int(resolution)
    if not 8<=n<=192:raise ValueError("resolution must be 8..192")
    lo=np.minimum(a.bounds[0],b.bounds[0]).astype(float);hi=np.maximum(a.bounds[1],b.bounds[1]).astype(float)
    pad=max(float(padding),1e-5)*max(float((hi-lo).max()),1e-7);lo-=pad;hi+=pad
    points=np.array(np.meshgrid(*[np.linspace(lo[i],hi[i],n) for i in range(3)],indexing='ij')).reshape(3,-1).T
    va,vb=_solid(a,points,(n,n,n)),_solid(b,points,(n,n,n))
    occ={"union":va|vb,"intersect":va&vb,"difference":va&~vb}[operation]
    return _surface(occ,(lo,hi))

def decimate(mesh,target_tris, preserve_watertight=True):
    """Quadric triangle decimation using the existing fast-simplification dependency.
    Returns a Trimesh. Set preserve_watertight=False to permit boundary simplification.
    """
    from .postprocess import decimate as simplify
    target_tris=int(target_tris)
    if target_tris<4:raise ValueError("target_tris must be >=4")
    out=simplify(mesh,target_tris)
    if preserve_watertight and mesh.is_watertight and not out.is_watertight:
        raise ValueError("decimator could not preserve watertight topology; lower the reduction or use approximate voxel remeshing")
    return out


def retopo(mesh,target_faces=8000,sharp_angle=40,method="quad"):
    """Instant Meshes quad-dominant result if available, otherwise triangle decimate.
    Returns {mesh, quads, method, fallback, watertightness}; GLB mesh remains triangulated.
    """
    target_faces=int(target_faces);original=len(mesh.faces);quads=None;used="decimate";fallback=False
    before=watertightness(mesh)
    if method=="quad" and original>target_faces:
        try:
            from .postprocess import quad_remesh
            result,quads=quad_remesh(mesh,target_faces,sharp_angle);used="quad"
        except (ImportError,ModuleNotFoundError,RuntimeError):
            result=decimate(mesh,target_faces,preserve_watertight=False);fallback=True
    elif original>target_faces:result=decimate(mesh,target_faces)
    else:result=mesh.copy();used="none"
    return {"mesh":result,"quads":quads,"method":used,"fallback":fallback,"watertightness":watertightness(result),"input_watertight":before["watertight"]}


def detect_floor(mesh_or_vertices, tolerance=.04, axis=1):
    """Estimate horizontal Y floor as a dense low quantile of vertices (RANSAC-free, CPU).
    Returns {point,normal,offset,inliers,tolerance,axis}. Give explicit plane=[a,b,c,d]
    to snap when the lowest broad surface is not the desired floor.
    """
    verts=np.asarray(getattr(mesh_or_vertices,"vertices",mesh_or_vertices),float)
    y=verts[:,axis];lo=float(np.quantile(y,.01));hi=float(np.quantile(y,.15));threshold=np.maximum(tolerance,(hi-lo)*.25+tolerance*.1)
    base=lo+threshold;weights=np.exp(-np.square((y-lo)/threshold));offset=float(np.sum(y*weights)/weights.sum())
    return {"point":[0,offset,0],"normal":[0,1,0],"offset":offset,"a":0,"b":1,"c":0,"d":-offset,
            "inliers":int(np.count_nonzero(y<=base)),"tolerance":threshold,"axis":axis}


def snap_to_floor(objects,plane=None):
    """Translate object bounds so min Y equals floor height; supports nested local bounds.
    objects: triangular mesh or iterable of {vertices,position} dictionaries. A Trimesh
    is translated in-place and returns (floor plane, delta). Collection input returns
    {objects, deltas, floor_y}. `plane` is [a,b,c,d] or a detect_floor dictionary.
    """
    single=hasattr(objects,"vertices") and hasattr(objects,"bounds")
    items=[objects] if single else list(objects);moved=[]
    if plane is None:offset=0
    elif isinstance(plane,(int,float)):offset=float(plane)
    elif isinstance(plane,dict):offset=float(plane.get("offset",-plane.get("d",0)/plane.get("b",1)))
    elif len(plane)==4:
        if abs(plane[1])<1e-12:raise ValueError("floor plane normal Y must be nonzero")
        offset=-plane[3]/plane[1]
    elif len(plane)==2:
        normal,point=plane
        if abs(normal[1])<1e-12:raise ValueError("floor plane normal Y must be nonzero")
        offset=-sum(float(v)*float(p) for v,p in zip(normal,point))/normal[1]
    else:raise ValueError("plane must be [a,b,c,d], (normal,point), floor report or floor Y")
    for obj in items:
        miny=float(np.min(obj.vertices[:,1]) if single else np.min(np.asarray(obj["vertices"])[:,1]))
        delta=offset-miny
        if single:obj.apply_translation([0,delta,0])
        else:obj["position"]=(np.asarray(obj.get("position",[0,0,0]),float)+[0,delta,0]).tolist()
        moved.append(delta)
    return (plane if plane is not None else detect_floor(objects), delta) if single else {"objects":items,"deltas":moved,"floor_y":offset}


def metric_scale(mesh_or_measurement,known_dimension,measured_dimension=None,axis=1):
    """Scale uniformly from known reference metres (or another chosen unit).
    metric_scale(mesh, 1.2) uses mesh height. With measured_dimension supplied, returns
    the dimensionless numeric scale factor and does not modify a mesh.
    """
    if measured_dimension is not None:
        if measured_dimension<=0:raise ValueError("measured_dimension must be >0")
        return float(known_dimension)/float(measured_dimension)
    measure=float(np.ptp(mesh_or_measurement.vertices[:,axis]));factor=metric_scale(None,known_dimension,measure)
    mesh_or_measurement.apply_scale(factor)
    mesh_or_measurement.metadata["metric_scale_factor"]=factor
    return mesh_or_measurement


def fit_manifest_metres(manifest, known_dimension, measured_dimension, apply_rotation=False, floor=False):
    """Return a deep-copied scene manifest with metre-scaled positions/Object3D scales and room.camera.
    known_dimension / measured_dimension sets one global factor; relative layout stays intact.
    scale and camera positions are multiplied, rotations are intentionally unchanged.
    """
    factor=metric_scale(None,known_dimension,measured_dimension);out=copy.deepcopy(manifest)
    def vec_scale(v):
        if isinstance(v,(int,float)):return float(v)*factor
        if isinstance(v,list):return [float(x)*factor for x in v]
        return v
    angle=float(apply_rotation) if isinstance(apply_rotation,(int,float)) and not isinstance(apply_rotation,bool) else float(out.get("xAxisYawOffset",out.get("room",{}).get("xAxisYawOffset",0))) if apply_rotation else 0.0
    def rotate(v):
        c,sn=np.cos(angle),np.sin(angle)
        return [float(c*v[0]+sn*v[2]),float(v[1]),float(-sn*v[0]+c*v[2])]
    for o in out.get("objects",[]):
        position=vec_scale(o.get("position",[0,0,0]));o["position"]=rotate(position) if apply_rotation else position;o["scale"]=vec_scale(o.get("scale",1))
    room=out.setdefault("room",{})
    for k in ("position","target"):
        if k in room.get("camera",{}):
            val=vec_scale(room["camera"][k]);room["camera"][k]=rotate(val) if apply_rotation else val
    out["units"]="m";out["metricScaleFactor"]=factor
    if floor:out= snap_manifest_to_floor(out)
    return out


def snap_manifest_to_floor(manifest, floor_y=0):
    """Snap positions; optional local bounds/rotation/scale calculate minimum world Y."""
    out=copy.deepcopy(manifest)
    for o in out.get("objects",[]):
        p=list(o.get("position",[0,0,0]));bounds=o.get("bounds") or o.get("localBounds")
        if bounds is not None:
            lo,hi=np.asarray(bounds,float)
            corners=np.array([[x,y,z] for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])])
            scale=np.broadcast_to(np.asarray(o.get("scale",1),float),(3,))
            if "quaternion" in o:
                x,y,z,w=np.asarray(o["quaternion"],float)
                R=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
            else:
                rx,ry,rz=np.asarray(o.get("rotation",[0,0,0]),float);cx,sx=np.cos(rx),np.sin(rx);cy,sy=np.cos(ry),np.sin(ry);cz,sz=np.cos(rz),np.sin(rz)
                Rx=np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]]);Ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]);Rz=np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
                R=Rz@Ry@Rx
            p[1]=float(floor_y)-float(((corners*scale)@R.T)[:,1].min())
        else:p[1]=float(floor_y)
        o["position"]=p
    out.setdefault("room",{})["floorY"]=float(floor_y)
    return out
