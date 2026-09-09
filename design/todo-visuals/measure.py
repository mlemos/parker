"""Measures the to-do glyphs: the true ink bounds of each Lucide path (arcs
sampled, not endpoints) and where that ink lands after Parker's normalisation.
Writes glyph-bbox.json and glyph-measure.json, which gen.py reads.

    python3 design/todo-visuals/measure.py
"""
import json, math, os, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
tok = json.load(open(os.path.join(ROOT, "shared", "design-tokens.json"))); G = tok["todo"]["glyphs"]
PATHS = {
 "done": ["M20 6 9 17l-5-5"], "fail": ["M18 6 6 18", "m6 6 12 12"], "cancel": ["M5 12h14"],
 "attn": ["M12 6v12", "M17.196 9 6.804 15", "m6.804 9 10.392 6"],
 "doing": ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"],
 "wait": ["M5 22h14", "M5 2h14", "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",
          "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"]}
INK = {"doing": (5, 3.27, 20.01, 20.73), "pause": (5, 3, 19, 21), "wait": (5, 2, 19, 22), "attn": (6.8, 6, 17.2, 18),
       "done": (4, 6, 20, 17), "fail": (6, 6, 18, 18), "cancel": (5, 12, 19, 12)}   # todo-glyph.ts, hand-read

def nums(s): return [float(x) for x in re.findall(r'-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?', s)]
def arc_pts(p0, p1, rx, ry, phi, large, sweep, n=200):
    (x1, y1), (x2, y2) = p0, p1
    x1p, y1p = (x1 - x2) / 2, (y1 - y2) / 2
    lam = x1p**2 / rx**2 + y1p**2 / ry**2
    if lam > 1: rx *= math.sqrt(lam); ry *= math.sqrt(lam)
    sign = -1 if large == sweep else 1
    num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p; den = rx*rx*y1p*y1p + ry*ry*x1p*x1p
    coef = sign * math.sqrt(max(0, num / den))
    cxp, cyp = coef * rx * y1p / ry, coef * -(ry * x1p / rx)
    cx, cy = cxp + (x1 + x2) / 2, cyp + (y1 + y2) / 2
    def ang(ux, uy, vx, vy):
        a = math.acos(max(-1, min(1, (ux*vx + uy*vy) / math.sqrt((ux*ux + uy*uy) * (vx*vx + vy*vy)))))
        return -a if ux*vy - uy*vx < 0 else a
    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); d = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and d > 0: d -= 2 * math.pi
    if sweep and d < 0: d += 2 * math.pi
    return [(cx + rx * math.cos(t1 + d * i / n), cy + ry * math.sin(t1 + d * i / n)) for i in range(n + 1)]
def bbox(paths):
    pts = []
    for d in paths:
        cur = start = (0, 0)
        for m in re.finditer(r'([MmLlHhVvAaZz])([^MmLlHhVvAaZz]*)', d):
            c, args = m.group(1), nums(m.group(2)); rel, u, i = c.islower(), c.upper(), 0
            def pt(x, y): return (cur[0] + x, cur[1] + y) if rel else (x, y)
            if u == "M":
                cur = start = pt(args[0], args[1]); pts.append(cur); i = 2
                while i + 1 < len(args): cur = pt(args[i], args[i+1]); pts.append(cur); i += 2
            elif u == "L":
                while i + 1 < len(args): cur = pt(args[i], args[i+1]); pts.append(cur); i += 2
            elif u == "H":
                for x in args: cur = ((cur[0] + x) if rel else x, cur[1]); pts.append(cur)
            elif u == "V":
                for y in args: cur = (cur[0], (cur[1] + y) if rel else y); pts.append(cur)
            elif u == "A":
                while i + 6 < len(args):
                    rx, ry, rot, la, sw = args[i:i+5]; q = pt(args[i+5], args[i+6])
                    pts += arc_pts(cur, q, rx, ry, rot, la != 0, sw != 0); cur = q; i += 7
            elif u == "Z": cur = start
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))
out = {}
for k, ps in PATHS.items():
    b = bbox(ps); ink = INK[k]
    out[k] = {"actual": [round(v, 3) for v in b], "ink": list(ink), "actual_long": round(max(b[2]-b[0], b[3]-b[1]), 3), "ink_long": round(max(ink[2]-ink[0], ink[3]-ink[1]), 3)}
out["pause"] = {"actual": [5, 3, 19, 21], "ink": [5, 3, 19, 21], "actual_long": 18, "ink_long": 18}
json.dump(out, open(os.path.join(HERE, "glyph-bbox.json"), "w"), indent=1)
def transform(svg):
    m = re.search(r'translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)', svg); sw = re.search(r'stroke-width="([\d.]+)"', svg)
    return float(m.group(1)), float(m.group(2)), float(m.group(3)), float(sw.group(1))
rows = {}
def row(tx, ty, s, sw, x0, y0, x1, y1):
    X0, Y0, X1, Y1 = tx + s*x0, ty + s*y0, tx + s*x1, ty + s*y1
    return dict(tx=tx, ty=ty, s=s, sw=sw, box=[round(v, 3) for v in (X0, Y0, X1, Y1)],
                margins=dict(left=round(X0-4, 3), right=round(20-X1, 3), top=round(Y0-4, 3), bottom=round(20-Y1, 3)),
                center=[round((X0+X1)/2, 3), round((Y0+Y1)/2, 3)], longest=round(max(X1-X0, Y1-Y0), 3), ink_half=round(sw/2, 3))
for st in ["DOING", "PAUSE", "WAIT", "ATTN", "DONE", "FAIL", "CANCEL"]:
    tx, ty, s, sw = transform(G[st]); rows[st] = row(tx, ty, s, sw, *out[st.lower()]["actual"])
s = 16/18; rows["DOING_FIXED"] = row(round(12 - s*13, 3), round(12 - s*12, 3), round(s, 4), round(2.5/s, 3), *out["doing"]["actual"])
json.dump(rows, open(os.path.join(HERE, "glyph-measure.json"), "w"), indent=1)
print("wrote glyph-bbox.json and glyph-measure.json")
