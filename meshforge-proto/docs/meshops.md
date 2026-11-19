# Mesh operations (v7.2)

`meshforge.meshops` is an original MIT Python integration library, available to plugin
backends. Existing NumPy, trimesh, scikit-image and the optional bundled Instant
Meshes executable supply geometry primitives. No GPU, network, or new dependency is
needed for carving, placement, or triangle decimation. The browser has no third-party
runtime addition; its march table is decoded from scikit-image's BSD data (see
`frontend/MESHOPS-THIRD-PARTY.md`).

## Python API

```python
from meshforge import meshops
carved = meshops.voxel_carve(masks, cameras, resolution=64,
                             bounds=None, normalize=True, smooth=0)
boolean = meshops.mesh_boolean(a, b, operation='union', resolution=64, padding=0.04)
reduced = meshops.decimate(mesh, target_tris, preserve_watertight=True)
result = meshops.retopo(mesh, target_faces=8000, sharp_angle=40, method='quad')
plane = meshops.detect_floor(mesh_or_vertices, tolerance=0.04, axis=1)
changed = meshops.snap_to_floor(objects, plane=None)
scale_factor = meshops.metric_scale(mesh_or_measurement, known_dimension,
                                   measured_dimension=None, axis=1)
new_manifest = meshops.fit_manifest_metres(manifest, known_dimension,
                                       measured_dimension, apply_rotation=False,
                                       floor=False)
new_manifest = meshops.snap_manifest_to_floor(manifest, floor_y=0)
report = meshops.watertightness(mesh)
```

`masks` is N equally sized 2-D arrays with nonzero foreground. A camera has `position`,
`target`, `focal`, optionally `up`; focal is pixels (world units and pixels share mask
width). If `cameras` is omitted, provide explicit mask slices at the matching grid resolution. Calibrated masks and
cameras should be supplied for metric reconstruction. `bounds=((xmin,ymin,zmin),
(xmax,ymax,zmax))` fixes carved world coordinates. `normalize=True` centers the result
in a unit cube. `smooth` is voxels and zero disables smoothing. Python carve resolution is 8..256; Boolean is 8..192. JS carve is 8..128 and Boolean is 8..96. The result is a trimesh.Trimesh. An empty hull raises ValueError.
Faces are assembled using scikit-image marching cubes; inspect `watertightness()` and
component count for each dataset. A camera looking away from the target does not make
an invisible object count as foreground.

`method='quad'` uses the existing local Instant Meshes adapter. Failure and missing
executables are returned as a decimation fallback, not hidden:
`{mesh, quads, method, fallback, watertightness, input_watertight}`.The watertightness dictionary is:
 watertight, winding_consistent, boundary_edges,
nonmanifold_edges, euler, components, vertices, triangles and volume. Python decimate
uses unstrained target faces and preserves a closed input by rejecting opening edge
collapses. Generic arbitrary-input watertight guarantees are not implied.

Floor is +Y-up. `plane` is numeric floor Y, `[a,b,c,d]`, `(normal,point)`, or a `detect_floor` report; automatic floor detection uses low,
Y-up quantiles (not a general RANSAC arbitrary-plane detector). Python snap accepts one
mesh or an iterable; it mutates mesh transforms and returns `(chosen_plane, shift)` for
one input, or a result map for a collection. `metric_scale(mesh_or_measurement, ...)`
returns a scale factor for numeric inputs and scales meshes in place when a mesh is
passed. `fit_manifest_metres` returns a deep copy, scales object/camera translations
and scalar/vector scale, and does not rewrite source GLBs. Python `apply_rotation=True`
applies manifest `xAxisYawOffset` radians around Y (or supply the angle as the argument);
JS uses `opts.applyRotation` and the same optional manifest offset.
`snap_manifest_to_floor` uses optional object `bounds`/`localBounds`, Euler/quaternion
rotation and scale. Without bounds it sets Y to the requested floor and cannot infer mesh
contact points. JS manifest floor similarly requires already-grounded or separately computed
contact positions. For production calibrated scenes, inspect transformed bounds before
exporting.

## JavaScript API

`window.MeshForge.meshOps` holds the same core geometry functions and these shortcuts:

```js
MeshForge.voxelCarve(masks, cameras, {resolution:64, bounds, normalize:true, smooth:0})
MeshForge.meshBoolean(a, b, 'union', {resolution:64, padding:0.04})
MeshForge.decimate(src, targetTris, {preserveWatertight:true})
await MeshForge.retopo(src, {targetFaces:8000, sharpAngle:40, method:'quad'})
MeshForge.detectFloor(src, {tolerance:0.04, axis:1})
MeshForge.snapToFloor(id='all', floorY=0)
MeshForge.setMetricScale(referenceMetres, measuredUnits, {id:'all'})
MeshForge.fitManifestMetres(manifest, knownDimension, measuredDimension,
                            {applyRotation:false, floor:false})
MeshForge.watertightness(input)
```

`src` accepts `{vertices,faces}` or a THREE.Mesh/BufferGeometry. Results from low-level
operations are `{vertices: Float32Array, faces: Uint32Array, report}`. Masks may be
2-D numeric arrays, typed arrays with `{data,width,height}`, canvas/ImageData-like objects,
or ImageBitmap/Image in the browser. JS carve and Boolean have maximum resolutions
128 and 96 respectively. `retopo` currently uses browser triangle decimation; Python is
required for Instant Meshes quad remeshing. No server quad-remesh endpoint is included.

`setMetricScale` multiplies scene transforms by the ratio and returns a report. It does
not regenerate geometry or clear the scene; dimensions remain caller-calibrated. To set
an exact object width, combine measured width and known width using the API's scale
report. `snapToFloor(id)` acts on a recursive object's descendants, uses current world
transforms, and makes minimum world Y equal floorY.

## Approximation and production cautions

* Voxel **union/intersect/difference are approximate**. Coordinates are sampled on a
  shared finite grid and marching cubes generates a newly discretised surface. Boolean
  operation assumes consistently oriented, closed input surfaces. Shared coplanar faces,
  thin features, offsets smaller than a voxel and very nonuniform bounds can produce
  wrong volume, disconnected parts, or poor topology. Check volume and watertightness.
  Use a native CAD kernel where exact Boolean results matter.
* The JavaScript decimator rejects unsafe local collapses by default when input is closed;
  `preserveWatertight:false` allows destructive simplification. When a closed input cannot be
  simplified safely, the original indexed mesh is returned with `reachedTarget:false` and
  `topologyPreservedFallback:true`; any returned geometry still needs a topology report check.
  Targets may not be reachable. Imported seams, normals/colors and materials are not preserved
  by this helper. For robust quad meshes use the Python/Instant Meshes path.
* A grid over a combined empty region returns an error. Extremely thin intersections
  may entirely miss the grid. No voxel result should be assumed valid at real tolerances
  without a visual/dimensional inspection.
* JS computation is synchronous except async retopo; large resolutions can block a UI. An async keyword alone does not move retopo to another thread.
  Use modest grids or move a production request to a worker/backend. Python is CPU only.
* Four-view visual hull is only silhouette-consistent, not an exact concave reconstruction.
  Holes invisible to all cameras can disappear. Calibrated intrinsics/extrinsics, linear mask
  transparency, real masks, and real Scene From Photo round trips remain untested.
