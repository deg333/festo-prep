"""Convert the Festo 919111 STEP assembly into assets/ms6-model.{bin,json} used by the 3D scene.

Usage (needs `pip install cadquery-ocp numpy`):
    python3 tools/step_to_mesh.py 919111.STEP assets/ms6-model

Step 1 tessellates each leaf part of the 919111 assembly (0.4 mm deflection) with its assembly transform.
Step 2 maps CAD axes to the scene (flow axis -z -> +x, mm -> cm) and packs vertices as uint16 (quantised
per part) plus uint16/uint32 triangle indices into one binary blob with a JSON index.
"""
# ---- step 1: tessellate (see conv2) ----
import sys, json, numpy as np
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_Label, TDF_ChildIterator
from OCP.TDataStd import TDataStd_Name
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRep import BRep_Tool
from OCP.TopLoc import TopLoc_Location
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
from OCP.TopoDS import TopoDS
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib

defl = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
app = XCAFApp_Application.GetApplication_s()
doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf")); app.InitDocument(doc)
rd = STEPCAFControl_Reader(); rd.SetColorMode(True); rd.SetNameMode(True)
assert rd.ReadFile(sys.argv[1]) == IFSelect_RetDone
rd.Transfer(doc)
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
def name_of(l):
    n = TDataStd_Name()
    return n.Get().ToExtString() if l.FindAttribute(TDataStd_Name.GetID_s(), n) else ''
leaves = []
def walk(label, loc, path):
    if st.IsAssembly_s(label):
        it = TDF_ChildIterator(label)
        while it.More():
            c = it.Value(); it.Next()
            if not st.IsComponent_s(c): continue
            ref = TDF_Label()
            if st.GetReferredShape_s(c, ref):
                walk(ref, loc.Multiplied(st.GetLocation_s(c)), path + '/' + (name_of(c) or name_of(ref)))
    else:
        leaves.append((path, st.GetShape_s(label), loc))
it = TDF_ChildIterator(st.Label())
while it.More():
    l = it.Value(); it.Next()
    if name_of(l) == '919111':
        walk(l, TopLoc_Location(), name_of(l))
print('leaves', len(leaves))
parts = []
for path, shp, loc in leaves:
    shp = shp.Moved(loc)
    bb = Bnd_Box(); BRepBndLib.Add_s(shp, bb)
    BRepMesh_IncrementalMesh(shp, defl, False, 0.5, True)
    verts=[]; tris=[]; off=0
    fe = TopExp_Explorer(shp, TopAbs_FACE)
    while fe.More():
        f = TopoDS.Face(fe.Current()); l2 = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, l2)
        if tri is not None:
            tr = l2.Transformation(); rev = f.Orientation() == TopAbs_REVERSED; n = tri.NbNodes()
            for k in range(1, n+1):
                p = tri.Node(k).Transformed(tr); verts.append((p.X(), p.Y(), p.Z()))
            for k in range(1, tri.NbTriangles()+1):
                a,b,c = tri.Triangle(k).Get(); a,b,c = a-1+off,b-1+off,c-1+off
                tris.append((a,c,b) if rev else (a,b,c))
            off += n
        fe.Next()
    mn, mx = bb.CornerMin(), bb.CornerMax()
    parts.append(dict(path=path, v=np.array(verts,dtype=np.float32), t=np.array(tris,dtype=np.uint32), bmin=[mn.X(),mn.Y(),mn.Z()], bmax=[mx.X(),mx.Y(),mx.Z()]))
    print('%-70s tris %7d  size %6.1f %6.1f %6.1f  c %7.1f %7.1f %7.1f' % (path[-70:], len(tris), mx.X()-mn.X(), mx.Y()-mn.Y(), mx.Z()-mn.Z(), (mx.X()+mn.X())/2,(mx.Y()+mn.Y())/2,(mx.Z()+mn.Z())/2))
import pickle; pickle.dump(parts, open('/tmp/_parts.pkl', 'wb'))

# ---- step 2: pack (see pack) ----
import pickle, numpy as np, json, struct, sys
parts = pickle.load(open('/tmp/_parts.pkl','rb'))
# mm -> cm, flow axis: new X = -z, new Y = y, new Z = x
def conv(v):
    v = v.astype(np.float64) / 10.0
    return np.stack([-v[:,2], v[:,1], v[:,0]], axis=1)
meta = []; blob = bytearray()
for i, p in enumerate(parts):
    v = conv(p['v']); t = p['t']
    t = t[:, [0, 2, 1]]  # mirror-free rotation keeps winding? mapping det=+1 so keep original winding
    t = p['t']
    mn = v.min(0); mx = v.max(0); sc = (mx - mn) / 65535.0; sc[sc == 0] = 1
    q = np.round((v - mn) / sc).astype(np.uint16)
    off = len(blob)
    blob += q.tobytes()
    use32 = len(v) > 65535
    blob += t.astype(np.uint32 if use32 else np.uint16).tobytes()
    if len(blob) % 4: blob += b'\0' * (4 - len(blob) % 4)
    meta.append(dict(i=i, name=p['path'], nv=len(v), nt=len(t), mn=mn.tolist(), sc=sc.tolist(), off=off, u32=use32))
json.dump(meta, open(sys.argv[2] + '.json','w'))
open(sys.argv[2] + '.bin','wb').write(blob)
print('parts', len(meta), 'bytes', len(blob))
allv = np.concatenate([conv(p['v']) for p in parts]); print('bbox cm', allv.min(0), allv.max(0))
