"""Generates parker-todo-visuals.html — the living visual spec of Parker's to-dos
(states, the box, glyph normalisation, the pen sheet, priority, in context, all
eight themes). Reads shared/design-tokens.json and the measurements next to it.

    python3 design/todo-visuals/gen.py

Published as an Artifact: https://claude.ai/code/artifact/693fb5fc-f1ae-4392-853c-59493c668eb4
"""
import json, re, html
import os
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.abspath(os.path.join(HERE, "..", ".."))
tok=json.load(open(os.path.join(ROOT, 'shared', 'design-tokens.json'))); G=tok['todo']['glyphs']
bb=json.load(open(os.path.join(HERE, 'glyph-bbox.json'))); M=json.load(open(os.path.join(HERE, 'glyph-measure.json')))
ORDER=["TODO","DOING","PAUSE","WAIT","ATTN","DONE","FAIL","CANCEL"]
GLY=["DOING","PAUSE","WAIT","ATTN","DONE","FAIL","CANCEL"]
RAW={
 "DOING":('<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',"play"),
 "PAUSE":('<rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/>',"pause"),
 "WAIT":('<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',"hourglass"),
 "ATTN":('<path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/>',"asterisk"),
 "DONE":('<path d="M20 6 9 17l-5-5"/>',"check"),
 "FAIL":('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',"x"),
 "CANCEL":('<path d="M5 12h14"/>',"minus"),
}
ALIASES=tok['todo']['aliases']
MEANING={"TODO":"aberto, ainda não começou","DOING":"em andamento","PAUSE":"você parou; nada externo falta","WAIT":"está com outra pessoa","ATTN":"precisa de você; o próximo passo é seu","DONE":"feito","FAIL":"não deu","CANCEL":"desistiu / não se aplica"}

STROKE_LINE, STROKE_FILL, STROKE_HEAVY = 2.5, 1.2, 3.25
def restyle(g):
    m = re.match(r'<g transform="([^"]+)" stroke-width="([\d.]+)">', g)
    sc = float(re.search(r'scale\(([\d.]+)\)', m.group(1)).group(1))
    vars_ = f'--inv:{round(1/sc,4)}'
    return g.replace(m.group(0), f'<g transform="{m.group(1)}" style="{vars_}">', 1)
FILL_K = (16 + STROKE_LINE - STROKE_FILL) / 16   # 1.08125: outline extent 16+2.5, filled 16k+1.2 → equal
SOLID_SIZES = {"edge": FILL_K, "path": 1.0, "optical": 0.94}
def fill_variant(g, k):
    m = re.match(r'<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)"[^>]*>', g)
    tx, ty, sc = float(m.group(1)), float(m.group(2)), float(m.group(3))
    tx2, ty2, s2 = round(12*(1-k) + k*tx, 3), round(12*(1-k) + k*ty, 3), round(k*sc, 4)
    return restyle(f'<g transform="translate({tx2} {ty2}) scale({s2})" stroke-width="1">' + g[m.end():])
def both(g):
    """outline group + one fill-mode group per solid size, one shown at a time"""
    return f'<g class="ink-line">{g}</g>' + ''.join(f'<g class="ink-fill solids-{name}">{fill_variant(g, k)}</g>' for name, k in SOLID_SIZES.items())
def inner(svg): return restyle(re.search(r'(<g transform.*</g>)', svg, re.S).group(1))
def guide_layer(box):
    x0,y0,x1,y1=box
    return (f'<g class="guide"><rect class="band" x="4" y="4" width="16" height="16"/><line class="cross" x1="12" y1="1" x2="12" y2="23"/><line class="cross" x1="1" y1="12" x2="23" y2="12"/>'
            f'<rect class="bbox" x="{x0}" y="{y0}" width="{max(x1-x0,0.001)}" height="{max(y1-y0,0.001)}"/></g>')
def variant(ink):
    x0,y0,x1,y1=ink; sc=16/max(x1-x0,y1-y0); tx=round(12-sc*(x0+x1)/2,3); ty=round(12-sc*(y0+y1)/2,3); sw=round(2.5/sc,3)
    ax0,ay0,ax1,ay1=bb["doing"]["actual"]
    tb=[round(tx+sc*ax0,3),round(ty+sc*ay0,3),round(tx+sc*ax1,3),round(ty+sc*ay1,3)]
    return dict(g=restyle(f'<g transform="translate({tx} {ty}) scale({round(sc,4)})" stroke-width="{sw}">{RAW["DOING"][0]}</g>'), box=tb, center=round((tb[0]+tb[2])/2,3))
V_TODAY=dict(g=inner(G["DOING"]), box=M["DOING"]["box"], center=M["DOING"]["center"][0]); V_FIX=variant((3,3,21,21)); V_BBOX=variant((5,3,21,21))

def glyph_svg(state, guides=True):
    """normalised glyph; DOING carries both today's and the fixed transform, toggled by body.fix-play"""
    if state=="TODO": return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{guide_layer([12,12,12,12]) if guides else ""}</svg>'
    if state=="DOING":
        gl = (f'<g class="today">{guide_layer(V_TODAY["box"])}</g><g class="fixed">{guide_layer(V_FIX["box"])}</g>') if guides else ''
        return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{gl}<g class="today">{both(V_TODAY["g"])}</g><g class="fixed">{both(V_FIX["g"])}</g></svg>'
    g = both(inner(G[state])) if state == "PAUSE" else inner(G[state])
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{guide_layer(M[state]["box"]) if guides else ""}{g}</svg>'
def raw_svg(state):
    return f'<svg class="raw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{guide_layer(bb[state.lower()]["actual"])}{RAW[state][0]}</svg>'
def box(state, svg=None, cls=""):
    return f'<span class="box b-{state.lower()} {cls}"><span class="glyph">{svg if svg is not None else glyph_svg(state)}</span></span>'

# ---- sections -------------------------------------------------------------------------
def states_row():
    out=''
    for st in ORDER:
        al=[a for a,c in ALIASES.items() if c==st]
        out+=(f'<figure class="st st-{st.lower()}">{box(st)}<figcaption><b>/{st}</b><span>{MEANING[st]}</span>'
              f'<span class="al">{"aliases: " + ", ".join("/"+a for a in al) if al else "&nbsp;"}</span></figcaption></figure>')
    return out
def strip_raw(): return ''.join(f'<figure>{box(k, raw_svg(k))}<figcaption><b>/{k}</b><span>{RAW[k][1]}</span><span>tinta {bb[k.lower()]["actual_long"]:g} de 24</span></figcaption></figure>' for k in GLY)
def strip_norm():
    out=''
    for k in GLY:
        m=M[k]; dx=m["center"][0]-12
        cap = (f'<span class="today">16.49 de 24 · Δx <em class="bad">{dx:+.2f}</em></span><span class="fixed">16.00 de 24 · Δx +0.89 <em class="ok">Lucide</em></span>' if k=="DOING" else f'<span>{m["longest"]:g} de 24 · Δx {dx:+.3f}</span>')
        out+=f'<figure>{box(k)}<figcaption><b>/{k}</b>{cap}</figcaption></figure>'
    return out
def table():
    rows=''
    for k in GLY:
        m=M[k]; mg=m["margins"]; dx=m["center"][0]-12; dy=m["center"][1]-12
        cls=' class="today bad"' if k=="DOING" else ''
        rows+=(f'<tr{cls}><th>/{k}</th><td>{m["box"][0]:.3f} … {m["box"][2]:.3f}</td><td>{m["box"][1]:.3f} … {m["box"][3]:.3f}</td><td>{mg["left"]:+.3f} / {mg["right"]:+.3f}</td><td>{mg["top"]:+.3f} / {mg["bottom"]:+.3f}</td><td>{dx:+.3f}</td><td>{dy:+.3f}</td><td>{m["sw"]/2:.2f}</td></tr>')
        if k=="DOING":
            f=M["DOING_FIXED"]; b=V_FIX["box"]; mg2=dict(left=b[0]-4,right=20-b[2],top=b[1]-4,bottom=20-b[3])
            rows+=(f'<tr class="fixed"><th>/DOING <small>corrigido</small></th><td>{b[0]:.3f} … {b[2]:.3f}</td><td>{b[1]:.3f} … {b[3]:.3f}</td><td>{mg2["left"]:+.3f} / {mg2["right"]:+.3f}</td><td>{mg2["top"]:+.3f} / {mg2["bottom"]:+.3f}</td><td>{V_FIX["center"]-12:+.3f} <small>óptico</small></td><td>+0.000</td><td>{f["sw"]/2:.2f}</td></tr>')
    return rows
U=20
def grid_lines(): return ''.join(f'<line class="{"major" if i%6==0 else "minor"}" x1="{i*U}" y1="0" x2="{i*U}" y2="{24*U}"/><line class="{"major" if i%6==0 else "minor"}" x1="0" y1="{i*U}" x2="{24*U}" y2="{i*U}"/>' for i in range(25))
ink=(5,3.27,20.01,20.73); act=bb["doing"]["actual"]
def rect(b,cls): return f'<rect class="{cls}" x="{b[0]*U}" y="{b[1]*U}" width="{(b[2]-b[0])*U}" height="{(b[3]-b[1])*U}"/>'
dots=''.join(f'<circle class="ep" cx="{x*U}" cy="{y*U}" r="4"/>' for x,y in [(5,5),(8.008,3.272),(20.005,10.27),(20.008,13.728),(8.008,20.728),(5,19)])
anatomy=f'''<svg class="anatomy" viewBox="-40 -30 {24*U+80} {24*U+60}" role="img" aria-label="O path do play na grade de 24 unidades">
  <g class="grid">{grid_lines()}</g>
  <g class="axis"><text x="0" y="-12">0</text><text x="{12*U}" y="-12">12</text><text x="{24*U}" y="-12">24</text><text x="-14" y="{3*U+4}">3</text><text x="-14" y="{12*U+4}">12</text><text x="-14" y="{21*U+4}">21</text></g>
  <g transform="scale({U})" fill="none" stroke-linecap="round" stroke-linejoin="round"><path class="ink" d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></g>
  {rect(ink,"inkrect")}{rect(act,"truerect")}{dots}
  <g class="lbl"><text x="{ink[2]*U+8}" y="{ink[1]*U+14}">INK lido à mão<tspan x="{ink[2]*U+8}" dy="16">[5, 3.27, 20.01, 20.73]</tspan><tspan x="{ink[2]*U+8}" dy="16">lado 17.46 · centro x 12.5</tspan></text>
  <text class="true" x="{act[2]*U+8}" y="{act[3]*U-22}">tinta real<tspan x="{act[2]*U+8}" dy="16">[5, 3, 21, 21]</tspan><tspan x="{act[2]*U+8}" dy="16">lado 18 · centro x 13</tspan></text></g>
</svg>'''

# the in-context editor: states, nesting, priorities, all in one note
NOTE=[  # (indent, state|None, priority, text)
 (0,None,0,'<span class="md-h"># Launch checklist</span>'),(0,None,0,''),
 (0,None,0,'Ship v0.1 by <span class="md-b">**Friday**</span>. Remaining:'),(0,None,0,''),
 (0,"TODO",3,"Reply to App Review"),(0,"DOING",2,"Write the release notes"),(2,"DONE",0,"Draft the highlights"),(2,"TODO",1,"Link the changelog"),
 (2,None,0,'<span class="md-l">-</span> keep it under ten lines'),(0,"ATTN",2,"Ask Ana about the icon"),(0,"WAIT",0,"App review"),(0,"TODO",0,"Record the demo video"),
 (0,"PAUSE",1,"Refactor the sync layer"),(0,"DONE",3,"Set up TestFlight"),(0,"FAIL",0,"Ship on Friday"),(0,"CANCEL",1,"Print a launch poster"),
]
SRC="\n".join((" "*i)+(f"/{st}{'!'*p} " if st else "")+re.sub(r'<[^>]+>','',t) for i,st,p,t in NOTE)
def editor(fs=14, lines=NOTE, cls=""):
    out=''
    for ind,st,p,text in lines:
        pri = f'<span class="slot"><i class="bar p{p}"></i></span>' if st else '<span class="slot"></span>'
        indent = f'<span class="ind" style="width:{ind*0.6:.1f}em"></span>'
        if st:
            closed = ' closed' if st in ("DONE","FAIL","CANCEL") else ''
            out+=f'<div class="ln c-{st.lower()}{closed} pl{p}">{pri}{indent}<span class="bx">{box(st, glyph_svg(st, guides=False))}</span><span>{text}</span></div>'
        else:
            owner = 'c-doing' if (ind and text and 'keep it' in text) else ''
            out+=f'<div class="ln {owner}">{pri}{indent}<span>{text if text else "&nbsp;"}</span></div>'
    return f'<div class="editor {cls}" style="font-size:{fs}px">{out}</div>'
def ladder():
    rows=''
    for n in range(5):
        rows+=(f'<div class="ln big pl{n}" data-row="{n}"><span class="slot"><i class="bar p{n}"></i></span><span class="bx">{box("TODO", glyph_svg("TODO", guides=False))}</span><span>Task</span>'
               f'<span class="bx c-doing" style="margin-left:.6em">{box("DOING", glyph_svg("DOING", guides=False))}</span><span class="c-doing">Task</span>'
               f'<span class="lab">{["/TODO","/TODO!","/TODO!!","/TODO!!!","/TODO!!!!"][n]}<em></em></span></div>')
    return f'<div class="editor" style="font-size:28px">{rows}</div>'
def swatches():
    names=[("heat3","Calor · 3","âmbar → laranja → vermelho"),("red3","Um matiz · 3","vermelho em três intensidades"),("traffic4","Semáforo · 4","verde → amarelo → laranja → vermelho"),("traffic3","Semáforo · 3","verde → âmbar → vermelho")]
    out=''
    for key,label,desc in names:
        out+=f'<button type="button" class="sw-ramp" data-ramp="{key}"><span class="swbars" data-ramp="{key}"></span><b>{label}</b><small>{desc}</small></button>'
    return f'<div class="swatchrow">{out}</div>'

def pen_cell(title, mode, line, heavy=None, fillw=1.2, solids="edge"):
    """mode 'om' (outline) or 'fm' (filled); strokes in grid units; solids: edge/path/optical"""
    cls = f"cell {mode} sz-{solids}" + (" pick" if "ESCOLHIDO" in title else "")
    style = f"--line:{line};--fillw:{fillw};--heavy:{heavy or line}"
    big = ''.join(box(k, glyph_svg(k, guides=False)) for k in GLY)
    small = ''.join(box(k, glyph_svg(k, guides=False)) for k in GLY)
    return (f'<div class="{cls}" style="{style}"><div class="celltitle">{title}</div>'
            f'<div class="cellbig">{big}</div><div class="cellsmall">{small}<span class="celltxt">Task at 14 px</span></div></div>')
def pen_sheet():
    cells = [
        pen_cell("Contorno · pena 2.0 (Lucide)", "om", 2.0),
        pen_cell("Contorno · pena 2.5 (Parker hoje)", "om", 2.5),
        pen_cell("Contorno · pena 3.0", "om", 3.0),
        pen_cell("Preenchido · linhas 2.5 · sólidos borda igual", "fm", 2.5, 2.5, 1.2, "edge"),
        pen_cell("Preenchido · linhas 3.25 · sólidos borda igual", "fm", 2.5, 3.25, 1.2, "edge"),
        pen_cell("Preenchido · linhas 4 · sólidos borda igual", "fm", 2.5, 4, 1.2, "edge"),
        pen_cell("Preenchido · linhas 3.25 · sólidos path igual", "fm", 2.5, 3.25, 1.2, "path"),
        pen_cell("Preenchido · linhas 4 · sólidos path igual · ESCOLHIDO", "fm", 2.5, 4, 1.2, "path"),
        pen_cell("Preenchido · linhas 4.75 · sólidos path igual", "fm", 2.5, 4.75, 1.2, "path"),
        pen_cell("Preenchido · linhas 3.25 · sólidos −6%", "fm", 2.5, 3.25, 1.2, "optical"),
        pen_cell("Preenchido · linhas 4 · sólidos −6%", "fm", 2.5, 4, 1.2, "optical"),
        pen_cell("Preenchido · linhas 4 · sólidos −6% · pena dos sólidos 2.0", "fm", 2.5, 4, 2.0, "optical"),
    ]
    return '<div class="pensheet">' + ''.join(cells) + '</div>'

def phone_list():
    items=[(3,"Reply to App Review","Launch checklist"),(1,"Link the changelog","Launch checklist › Write the release notes"),(0,"Record the demo video","Launch checklist"),(0,"Book the flights","Trip · Lisbon")]
    rows=''.join(f'<div class="prow pl{n} c-todo"><i class="pbar p{n}"></i><span class="pbx">{box("TODO", glyph_svg("TODO", guides=False))}</span><div class="ptxt"><div class="ppath">{path}</div><div class="pline">{text}</div></div></div>' for n,text,path in items)
    chips=''.join(f'<span class="chip {"on" if on else ""}">{l}</span>' for l,on in [("All notes",True),("Launch checklist",False),("!!! only",False),("!! and up",False)])
    return f'<div class="phone"><div class="chips">{chips}</div><div class="psec">To do <span>4</span></div><div class="pcard">{rows}</div><div class="pnote">Ordem: !!! · !! · ! · sem marca; dentro de cada uma, a ordem do documento.</div></div>'
def sheet():
    states=''.join(f'<div class="sst c-{s.lower()}"><span class="sbx">{box(s, glyph_svg(s, guides=False))}</span><span>{s}</span></div>' for s in ORDER)
    seg=''
    for i,l in enumerate(["none","!","!!","!!!"]):
        dot = '<i class="dot p%d"></i>' % i if i else ''
        seg += '<div class="seg %s">%s%s</div>' % ("sel" if i==2 else "", dot, l)
    return f'<div class="sheet"><div class="grab"></div><div class="stitle">Ask Ana about the icon</div><div class="slab">State</div><div class="states">{states}</div><div class="slab">Priority</div><div class="segs">{seg}</div></div>'

THEMES=json.dumps([{"id":t["id"],"label":t["label"],"mode":t["mode"],"ui":t["ui"],"syntax":t["syntax"],"todo":t["todo"]} for t in tok["themes"]])
theme_btns=''.join(f'<button type="button" data-theme-id="{t["id"]}">{t["label"]}</button>' for t in tok["themes"])

page=f'''<title>Parker to-do visuals</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap">
<style>
:root{{--bg:#ffffff;--fg:#18181b;--chrome:#f4f4f5;--text:#18181b;--secondary:#52525b;--muted:#a1a1aa;--border:#e4e4e7;--accent:#059669;--on-accent:#ffffff;--danger:#dc2626;--heading:#7c3aed;--bold:#d97706;--list:#0891b2;
--todo-doing:#0891b2;--todo-pause:#2563eb;--todo-wait:#9333ea;--todo-attn:#d97706;--todo-done:#16a34a;--todo-fail:#dc2626;--p1:#a1a1aa;--p2:#d97706;--p3:#dc2626;--guide:#0284c7;--inkrect:#d97706;--truerect:#059669}}
:root[data-mode="dark"]{{--guide:#38bdf8;--inkrect:#fbbf24;--truerect:#34d399}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--text);font-family:Geist,-apple-system,"Helvetica Neue",system-ui,sans-serif;font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;transition:background .15s}}
main{{max-width:820px;margin:0 auto;padding:40px 24px 96px;display:flex;flex-direction:column;gap:56px}}
h1{{font-size:34px;line-height:1.15;font-weight:700;letter-spacing:-0.4px;margin:0 0 10px;text-wrap:balance}}
h2{{font-size:20px;font-weight:600;letter-spacing:-0.2px;margin:0 0 6px;text-wrap:balance}}
h3{{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--secondary);letter-spacing:.4px;text-transform:uppercase}}
p{{margin:0;max-width:64ch;color:var(--secondary)}} p b{{color:var(--text);font-weight:600}}
code{{font-family:"Geist Mono",ui-monospace,Menlo,monospace;font-size:.92em;color:var(--heading)}}
.eyebrow{{font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:8px}}
section{{display:flex;flex-direction:column;gap:18px}}
/* controls: sticky bar */
.controls{{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--border);margin:0 -24px;padding:10px 24px;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;font-size:13px;color:var(--secondary)}}
.controls .group{{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}} .controls .group > span{{font-size:11px;letter-spacing:.5px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-right:2px}}
.controls button{{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--chrome);color:var(--text);cursor:pointer}}
.controls button.on{{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}}
.toggle{{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:4px 10px;border:1px solid var(--border);border-radius:999px;background:var(--chrome);color:var(--text);font-size:12px}}
.toggle input{{appearance:none;width:30px;height:18px;border-radius:9px;background:var(--border);position:relative;margin:0;cursor:pointer}}
.toggle input::after{{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:7px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .15s}}
.toggle input:checked{{background:var(--accent)}} .toggle input:checked::after{{left:14px}}
.toggle input:focus-visible,.controls button:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
.fillonly{{opacity:.35;pointer-events:none}} body.fill-shapes .fillonly{{opacity:1;pointer-events:auto}}
/* the box, exactly as App.css draws it, in ems of the current font-size */
.box{{display:inline-block;box-sizing:border-box;width:.95em;height:.95em;overflow:hidden;vertical-align:-0.07em;flex:0 0 auto}}
.glyph{{box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:1.5px solid var(--muted);border-radius:4px;font-size:.7em;line-height:1;color:var(--bg)}}
.glyph svg{{width:.85em;height:.85em;display:block;overflow:visible}}
.b-doing .glyph{{background:var(--todo-doing);border-color:var(--todo-doing)}} .b-pause .glyph{{background:var(--todo-pause);border-color:var(--todo-pause)}} .b-wait .glyph{{background:var(--todo-wait);border-color:var(--todo-wait)}} .b-attn .glyph{{background:var(--todo-attn);border-color:var(--todo-attn)}} .b-done .glyph{{background:var(--todo-done);border-color:var(--todo-done)}} .b-fail .glyph{{background:var(--todo-fail);border-color:var(--todo-fail)}} .b-cancel .glyph{{background:var(--muted);border-color:var(--muted)}}
/* big boxes: whole pixels (3px/unit). */
.strip{{background:var(--chrome);border:1px solid var(--border);border-radius:12px;padding:22px 12px 16px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}}
.strip.eight{{grid-template-columns:repeat(8,minmax(0,1fr))}}
.strip figure{{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}}
.strip figcaption{{display:flex;flex-direction:column;align-items:center;gap:1px;font-size:11px;line-height:15px;color:var(--muted);text-align:center;font-variant-numeric:tabular-nums}}
.strip figcaption b{{font-family:"Geist Mono",ui-monospace,monospace;font-weight:600;color:var(--secondary)}} .strip figcaption .al{{font-family:"Geist Mono",monospace;font-size:10px}}
.strip figcaption em{{font-style:normal;font-weight:600}} .strip .bad{{color:var(--danger)}} .strip .ok{{color:var(--accent)}}
.strip .box{{width:88px;height:88px;font-size:0}} .strip .glyph{{border-width:3px;border-radius:9px}} .strip .glyph svg{{width:72px;height:72px}}
.states .strip .box{{width:64px;height:64px}} .states .strip .glyph{{border-width:2.5px;border-radius:7px}} .states .strip .glyph svg{{width:52px;height:52px}}
.st-todo figcaption b{{color:var(--text)}} .st-doing figcaption b{{color:var(--todo-doing)}} .st-pause figcaption b{{color:var(--todo-pause)}} .st-wait figcaption b{{color:var(--todo-wait)}} .st-attn figcaption b{{color:var(--todo-attn)}} .st-done figcaption b{{color:var(--todo-done)}} .st-fail figcaption b{{color:var(--todo-fail)}}
/* guides inside each svg */
.guide{{display:none}} body.show-guides .guide{{display:block}}
.guide .band{{fill:none;stroke:var(--guide);stroke-width:.25}} .guide .cross{{stroke:var(--guide);stroke-width:.18;stroke-dasharray:.6 .6}} .guide .bbox{{fill:none;stroke:#fff;stroke-width:.22;stroke-dasharray:.5 .35}}
/* filled shapes: the three glyphs that enclose an area, painted solid in the knockout color. The stroke stays, so the outer extent — and the normalisation — do not change. */
body.fill-shapes .b-doing .glyph svg g[style] path,body.fill-shapes .b-pause .glyph svg g[style] rect,body.fill-shapes .b-wait .glyph svg g[style] path,
body.fill-shapes .b-doing svg.raw > path,body.fill-shapes .b-pause svg.raw > rect,body.fill-shapes .b-wait svg.raw > path{{fill:currentColor}}
.guide rect,.guide line{{fill:none}}
/* pen sheet: each cell is its own world — outline or filled, its own strokes, its own solid size — whatever the page toggles say */
.pensheet{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}}
.cell{{background:var(--chrome);border:1px solid var(--border);border-radius:12px;padding:12px 12px 10px;display:flex;flex-direction:column;gap:10px}}
.celltitle{{font-size:11px;line-height:14px;font-weight:600;color:var(--secondary);letter-spacing:.2px;min-height:28px}}
.cell:has(.celltitle:is(:last-child)),.cell.pick{{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}}
.cellbig{{display:flex;gap:4px;font-size:30px;justify-content:space-between}} .cellbig .box{{width:.95em;height:.95em;font-size:30px}} .cellbig .glyph{{border-width:1.5px;border-radius:4px}}
.cellsmall{{display:flex;gap:3px;align-items:center;font-size:14px}} .cellsmall .box{{width:.95em;height:.95em;font-size:14px}} .celltxt{{font-family:"Geist Mono",monospace;font-size:14px;color:var(--fg);margin-left:6px;white-space:nowrap}}
.cell .glyph svg g[style]{{stroke-width:calc(var(--line) * var(--inv)) !important}}
.cell.om .ink-fill{{display:none !important}} .cell.om .ink-line{{display:revert !important}}
.cell.om .glyph svg path,.cell.om .glyph svg rect{{fill:none !important}}
.cell.fm .ink-line{{display:none !important}} .cell.fm .ink-fill{{display:none !important}}
.cell.fm.sz-edge .ink-fill.solids-edge,.cell.fm.sz-path .ink-fill.solids-path,.cell.fm.sz-optical .ink-fill.solids-optical{{display:revert !important}}
.cell.fm .b-doing .glyph svg g[style] path,.cell.fm .b-pause .glyph svg g[style] rect,.cell.fm .b-wait .glyph svg g[style] path{{fill:currentColor !important}}
.cell.fm .b-doing .glyph svg g[style],.cell.fm .b-pause .glyph svg g[style],.cell.fm .b-wait .glyph svg g[style]{{stroke-width:calc(var(--fillw) * var(--inv)) !important}}
.cell.fm .b-done .glyph svg g[style],.cell.fm .b-fail .glyph svg g[style],.cell.fm .b-attn .glyph svg g[style],.cell.fm .b-cancel .glyph svg g[style]{{stroke-width:calc(var(--heavy) * var(--inv)) !important}}
.cell.fm .b-wait .glyph svg g[style] path:nth-of-type(-n+2){{stroke-width:calc(var(--line) * var(--inv)) !important}}
@media (max-width:680px){{.pensheet{{grid-template-columns:1fr}}}}
.ink-fill{{display:none}} body.fill-shapes .ink-line{{display:none}}
body.fill-shapes.solids-edge .ink-fill.solids-edge,body.fill-shapes.solids-path .ink-fill.solids-path,body.fill-shapes.solids-optical .ink-fill.solids-optical{{display:revert}}
:root{{--line:2.5;--fillw:1.2;--heavy:4}}
.glyph svg g[style]{{stroke-width:calc(var(--line) * var(--inv))}}
body.fill-shapes .b-doing .glyph svg g[style],body.fill-shapes .b-pause .glyph svg g[style],body.fill-shapes .b-wait .glyph svg g[style]{{stroke-width:calc(var(--fillw) * var(--inv))}}
body.fill-shapes .b-done .glyph svg g[style],body.fill-shapes .b-fail .glyph svg g[style],body.fill-shapes .b-attn .glyph svg g[style],body.fill-shapes .b-cancel .glyph svg g[style]{{stroke-width:calc(var(--heavy) * var(--inv))}}
/* the hourglass is mixed: two filled bulbs and two cap LINES (the first two paths). The caps sit on the very top and bottom edges, so half of any stroke grows outward — the heavy stroke made the glyph taller than its neighbours. They keep the normal line weight: the same outer extent as the outline version. */
body.fill-shapes .b-wait .glyph svg g[style] path:nth-of-type(-n+2){{stroke-width:calc(var(--line) * var(--inv))}}
body.fill-shapes .b-wait svg.raw > path:nth-of-type(-n+2){{stroke-width:2}}
svg.raw{{stroke-width:2}} body.fill-shapes .b-doing svg.raw,body.fill-shapes .b-pause svg.raw,body.fill-shapes .b-wait svg.raw{{stroke-width:1}}
body.fill-shapes .b-done svg.raw,body.fill-shapes .b-fail svg.raw,body.fill-shapes .b-attn svg.raw,body.fill-shapes .b-cancel svg.raw{{stroke-width:2.6}}
/* the play fix toggle */
.fixed{{display:none}} body.fix-play .fixed{{display:revert}} body.fix-play .today{{display:none}}
/* editor lines */
.editor{{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 12px 12px 4px;font-family:"Geist Mono",ui-monospace,Menlo,monospace;line-height:1.6;display:flex;flex-direction:column;color:var(--fg)}}
.ln{{display:flex;align-items:center;white-space:pre;min-height:1.6em}} .ln .bx{{display:inline-flex;align-items:center;height:1.6em;margin:0 5px 0 3px}}
.ln .slot{{display:inline-flex;align-items:center;justify-content:flex-start;width:.6em;height:1.6em;flex:0 0 auto}}
.ln .bar{{display:block;width:2.5px;border-radius:2px}} .ln.big .bar{{width:4px}}
.bar.p0,.pbar.p0{{height:var(--h0);background:var(--p0)}} .bar.p1,.pbar.p1{{height:var(--h1);background:var(--p1)}} .bar.p2,.pbar.p2{{height:var(--h2);background:var(--p2)}} .bar.p3,.pbar.p3{{height:var(--h3);background:var(--p3)}} .bar.p4,.pbar.p4{{height:var(--h4);background:var(--p4)}}
body:not(.no-grey) .bar.p0,body:not(.no-grey) .pbar.p0{{display:none}}
body.len-fixed .bar,body.len-fixed .pbar{{height:1.15em}}
.ln.big .lab em{{font-style:normal;color:var(--accent);margin-left:8px}}
body.dim-closed .ln.closed .bar{{opacity:.35}}
/* the level of a line, as a color the box can borrow */
.pl1{{--pc:var(--p1)}} .pl2{{--pc:var(--p2)}} .pl3{{--pc:var(--p3)}} .pl4{{--pc:var(--p4)}} body.no-grey .pl0{{--pc:var(--p0)}}
/* marker modes: bar (default) · border · both */
body.mark-border .bar,body.mark-border .pbar{{visibility:hidden}}
/* filled boxes in border mode, "barra na margem": the state owns the border, so the priority goes back to the margin */
body.mark-border.filled-bar .ln:not(.c-todo) .bar,body.mark-border.filled-bar .prow:not(.c-todo) .pbar{{visibility:visible}}
body.mark-border .pl1 .b-todo .glyph,body.mark-border .pl2 .b-todo .glyph,body.mark-border .pl3 .b-todo .glyph,body.mark-border .pl4 .b-todo .glyph,
body.mark-both .pl1 .b-todo .glyph,body.mark-both .pl2 .b-todo .glyph,body.mark-both .pl3 .b-todo .glyph,body.mark-both .pl4 .b-todo .glyph,
body.no-grey.mark-border .pl0 .b-todo .glyph,body.no-grey.mark-both .pl0 .b-todo .glyph{{border-color:var(--pc)}}
/* filled boxes in border mode: the box's OWN border takes the priority color — same size, same fill, same glyph. Or nothing. */
body.filled-inset.mark-border .pl1 .box:not(.b-todo) .glyph,body.filled-inset.mark-border .pl2 .box:not(.b-todo) .glyph,body.filled-inset.mark-border .pl3 .box:not(.b-todo) .glyph,body.filled-inset.mark-border .pl4 .box:not(.b-todo) .glyph,
body.filled-inset.mark-both .pl1 .box:not(.b-todo) .glyph,body.filled-inset.mark-both .pl2 .box:not(.b-todo) .glyph,body.filled-inset.mark-both .pl3 .box:not(.b-todo) .glyph,body.filled-inset.mark-both .pl4 .box:not(.b-todo) .glyph,
body.no-grey.filled-inset.mark-border .pl0 .box:not(.b-todo) .glyph,body.no-grey.filled-inset.mark-both .pl0 .box:not(.b-todo) .glyph{{border-color:var(--pc)}}
.swatchrow{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}}
.sw-ramp{{font:inherit;text-align:left;display:flex;flex-direction:column;gap:6px;padding:12px 12px 10px;border:1px solid var(--border);border-radius:10px;background:var(--chrome);color:var(--text);cursor:pointer}}
.sw-ramp.on{{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}} .sw-ramp b{{font-size:13px}} .sw-ramp small{{font-size:11px;color:var(--muted);line-height:14px}}
.swbars{{display:flex;gap:6px;align-items:flex-end;height:22px}} .swbars i{{display:block;width:6px;border-radius:2px}}
.sw-ramp:focus-visible{{outline:2px solid var(--accent);outline-offset:2px}}
@media (max-width:680px){{.swatchrow{{grid-template-columns:1fr 1fr}}}}
.bar.p1,.pbar.p1,.dot.p1{{background:var(--p1)}} .bar.p2,.pbar.p2,.dot.p2{{background:var(--p2)}} .bar.p3,.pbar.p3,.dot.p3{{background:var(--p3)}}
.ln .lab{{font-family:Geist,system-ui,sans-serif;font-size:12px;color:var(--muted);margin-left:auto;padding-left:16px}}
.c-todo{{color:var(--fg)}} .c-doing{{color:var(--todo-doing)}} .c-pause{{color:var(--todo-pause)}} .c-wait{{color:var(--todo-wait)}} .c-attn{{color:var(--todo-attn)}} .c-done{{color:var(--todo-done)}} .c-fail{{color:var(--todo-fail)}} .c-cancel{{color:var(--muted)}}
.ln.c-doing:not(:has(.bx)){{color:color-mix(in srgb,var(--todo-doing) 82%,black)}}
.md-h{{color:var(--heading);font-weight:700}} .md-b{{color:var(--bold);font-weight:700}} .md-l{{color:var(--list)}}
pre.src{{margin:0;font-family:"Geist Mono",ui-monospace,Menlo,monospace;font-size:13px;line-height:1.7;background:var(--chrome);border:1px solid var(--border);border-radius:12px;padding:16px 18px;color:var(--text);overflow-x:auto}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
/* anatomy of the box */
.boxanat{{display:grid;grid-template-columns:auto 1fr;gap:24px;align-items:center;background:var(--chrome);border:1px solid var(--border);border-radius:12px;padding:20px}}
.boxanat .demo{{font-size:120px;display:flex;align-items:center;gap:0;white-space:pre;font-family:"Geist Mono",monospace;color:var(--fg)}}
.boxanat dl{{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;color:var(--secondary)}} .boxanat dt{{font-family:"Geist Mono",monospace;color:var(--text)}} .boxanat dd{{margin:0}}
/* table */
table{{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums;font-family:"Geist Mono",ui-monospace,monospace}}
th,td{{text-align:right;padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap}} thead th{{font-family:Geist,system-ui,sans-serif;font-weight:600;color:var(--muted);font-size:11px;letter-spacing:.4px;text-transform:uppercase}}
tbody th{{text-align:left;font-weight:600;color:var(--secondary)}} tbody th small,tbody td small{{font-family:Geist,system-ui;font-size:10px;color:var(--muted);margin-left:4px}}
tbody tr.bad td:nth-child(6){{color:var(--danger);font-weight:600}} tbody tr.fixed td:nth-child(6){{color:var(--accent);font-weight:600}}
.tablewrap{{overflow-x:auto;border:1px solid var(--border);border-radius:12px;background:var(--chrome);padding:4px 6px}}
.anatomy{{width:100%;height:auto;display:block;background:var(--chrome);border:1px solid var(--border);border-radius:12px;padding:16px}}
.anatomy .grid line.minor{{stroke:var(--border);stroke-width:1;opacity:.6}} .anatomy .grid line.major{{stroke:var(--muted);stroke-width:1;opacity:.6}}
.anatomy .axis text{{font-family:"Geist Mono",monospace;font-size:12px;fill:var(--muted);text-anchor:middle}} .anatomy .ink{{stroke:var(--todo-doing);stroke-width:.1}}
.anatomy .inkrect{{fill:none;stroke:var(--inkrect);stroke-width:2;stroke-dasharray:6 5}} .anatomy .truerect{{fill:none;stroke:var(--truerect);stroke-width:2}} .anatomy .ep{{fill:var(--inkrect)}}
.anatomy .lbl text{{font-family:"Geist Mono",monospace;font-size:12px;fill:var(--inkrect)}} .anatomy .lbl text.true{{fill:var(--truerect)}}
.legend{{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--secondary)}} .legend span{{display:inline-flex;align-items:center;gap:8px}} .sw{{width:18px;height:0;border-top:2px solid}} .sw.dash{{border-top-style:dashed}} .dotl{{width:9px;height:9px;border-radius:5px;display:inline-block}}
/* phone */
.phone{{background:var(--chrome);border:1px solid var(--border);border-radius:14px;padding:14px 0 6px;font-family:Geist,system-ui,sans-serif}}
.chips{{display:flex;gap:8px;padding:0 14px 12px;overflow:hidden}} .chip{{height:30px;padding:0 12px;border-radius:15px;display:inline-flex;align-items:center;font-size:13px;font-weight:500;white-space:nowrap;color:var(--text);background:var(--bg);border:1px solid var(--border)}} .chip.on{{color:var(--on-accent);background:var(--accent);border-color:var(--accent)}}
.psec{{padding:0 16px 6px 30px;font-size:13px;font-weight:600;letter-spacing:.3px;text-transform:uppercase}} .psec span{{color:var(--muted);font-weight:400}}
.pcard{{margin:0 14px;background:var(--bg);border-radius:10px;overflow:hidden}} .prow{{position:relative;padding:9px 16px;display:flex;align-items:flex-start;gap:10px;border-top:1px solid var(--border)}} .prow:first-child{{border-top:0}}
.pbar{{position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;border-radius:0 2px 2px 0;font-size:24px}}
.pbx{{font-size:15px;line-height:24px;display:flex;align-items:center;height:24px;margin-top:18px}} .ptxt{{display:flex;flex-direction:column;flex:1;min-width:0}}
.ppath{{font-size:12px;line-height:16px;color:var(--muted);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}} .pline{{font-family:"Geist Mono",monospace;font-size:15px;line-height:24px;color:var(--fg);white-space:pre}}
.pnote{{padding:8px 30px 4px;font-size:12px;color:var(--muted)}}
.sheet{{background:var(--chrome);border:1px solid var(--border);border-radius:16px;padding:10px 16px 18px;font-family:Geist,system-ui,sans-serif;display:flex;flex-direction:column;gap:12px}}
.grab{{width:36px;height:5px;border-radius:3px;background:var(--border);margin:0 auto}} .stitle{{font-family:"Geist Mono",monospace;font-size:15px;color:var(--secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.slab{{font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}} .states{{display:flex;justify-content:space-between;gap:4px}}
.sst{{display:flex;flex-direction:column;align-items:center;gap:6px;font-family:"Geist Mono",monospace;font-size:10px}} .sbx{{font-size:22px;display:inline-flex}}
.segs{{height:34px;padding:2px;border-radius:9px;background:var(--border);display:flex;gap:2px}} .seg{{flex:1;height:30px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;font-family:"Geist Mono",monospace;color:var(--text)}} .seg.sel{{background:var(--bg);box-shadow:0 1px 3px rgba(0,0,0,.12)}}
.dot{{display:inline-block;width:8px;height:8px;border-radius:4px;margin-right:6px}}
.decisions{{display:grid;gap:10px}} .decisions div{{display:grid;grid-template-columns:150px 1fr;gap:14px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--chrome)}} .decisions b{{font-size:13px}} .decisions span{{font-size:14px;color:var(--secondary)}}
.decisions .tag{{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:1px 7px;border-radius:999px;margin-left:8px;vertical-align:middle;background:var(--accent);color:var(--on-accent)}} .decisions .tag.open{{background:var(--todo-attn)}}
@media (prefers-reduced-motion: reduce){{.toggle input::after,body{{transition:none}}}}
@media (max-width:680px){{.two{{grid-template-columns:1fr}} .strip,.strip.eight{{grid-template-columns:repeat(4,minmax(0,1fr))}} .strip .box{{width:64px;height:64px}} .strip .glyph svg{{width:48px;height:48px}} .boxanat{{grid-template-columns:1fr}} .decisions div{{grid-template-columns:1fr}}}}
</style>
<main>
<div class="controls">
  <div class="group"><span>Tema</span><button type="button" data-theme-id="system" class="on">System</button>{theme_btns}</div>
  <label class="toggle"><input type="checkbox" id="guides" checked><span>Guias</span></label>
  <label class="toggle"><input type="checkbox" id="fixplay" checked><span>Play corrigido</span></label>
  <label class="toggle"><input type="checkbox" id="fillshapes" checked><span>Preencher play, pausa, ampulheta</span></label>
  <div class="group fillonly"><span>Traço das linhas</span><button type="button" data-heavy="2.5">2.5</button><button type="button" data-heavy="3.25">3.25</button><button type="button" data-heavy="4" class="on">4</button><button type="button" data-heavy="4.75">4.75</button></div>
  <div class="group fillonly"><span>Tamanho dos sólidos</span><button type="button" data-solids="edge">Borda igual</button><button type="button" data-solids="path" class="on">Path igual</button><button type="button" data-solids="optical">−6%</button></div>
  <div class="group"><span>Marcador</span><button type="button" data-mark="bar">Barra</button><button type="button" data-mark="border" class="on">Borda da caixa</button><button type="button" data-mark="both">Ambos</button></div>
  <div class="group"><span>Caixa preenchida</span><button type="button" data-filled="inset">Borda interna</button><button type="button" data-filled="bar">Barra na margem</button><button type="button" data-filled="none" class="on">Sem sinal</button></div>
  <div class="group"><span>Tamanho</span><button type="button" data-len="vary" class="on">Varia</button><button type="button" data-len="fixed">Fixo</button></div>
  <label class="toggle"><input type="checkbox" id="nogrey" checked><span>Sem cinza: a base já tem cor</span></label>
  <div class="group"><span>Rampa</span><button type="button" data-ramp="heat3">Calor·3</button><button type="button" data-ramp="red3">Um matiz·3</button><button type="button" data-ramp="traffic4" class="on">Semáforo·4</button><button type="button" data-ramp="traffic3">Semáforo·3</button></div>
</div>

<header>
  <div class="eyebrow">Parker · especificação visual dos to-dos</div>
  <h1>Tudo que um to-do mostra, num lugar só</h1>
  <p>Os oito estados, a caixa, os glifos e sua normalização, as cores por tema e a prioridade. Desenhado a partir dos tokens reais do Parker, nos oito temas, para validar no olho antes de mexer no código. Mude o tema na barra acima e tudo abaixo acompanha.</p>
</header>

<section class="states">
  <div><h2>1 · Os oito estados</h2><p>Uma linha vira to-do quando começa com uma tag de barra. ⌘⏎ roda nesta ordem: os estados por que você passa, depois os desfechos. Toque simples na caixa conclui um aberto ou reabre um fechado. As cores são <b>roles do tema</b>, nomeadas pelo estado e não pelo matiz: TODO veste a cor do corpo, CANCEL veste <code>muted</code>.</p></div>
  <div class="strip eight">{states_row()}</div>
</section>

<section>
  <div><h2>2 · A caixa</h2><p>Um quadrado de <code>0.95em</code> do tamanho da fonte da linha. Dentro, a borda de <code>1.5px</code> com raio <code>4px</code> e fonte <code>0.7em</code>; o glifo ocupa <code>0.85em</code> dessa fonte, recortado na cor do fundo do editor. É o que o editor, o preview, o site e o iPhone desenham, todos a partir de <code>todo-glyph.ts</code>.</p></div>
  <div class="boxanat"><div class="demo">{box("DOING", glyph_svg("DOING", guides=False))} Ag</div>
    <dl><dt>caixa</dt><dd>0.95em × 0.95em, alinhada a −0.07em da baseline</dd><dt>borda</dt><dd>1.5px, raio 4px, na cor do estado (TODO: <code>muted</code>, vazia)</dd><dt>glifo</dt><dd>svg de 0.85em numa fonte de 0.7em → 0.595em; recorte em <code>editorBg</code></dd><dt>fonte</dt><dd>Geist Mono 14px / 1.6 no Mac; 15px / 1.6 no iPhone</dd></dl></div>
</section>

<section>
  <div><h2>3 · Lucide como vem</h2><p>Mesma grade de 24, mesmo traço de 2, e nenhum ícone preenche a grade igual: a ampulheta ocupa 20 unidades, o X ocupa 12. Numa caixa de 8 px isso lê como desleixo, não como variedade.</p></div>
  <div class="strip">{strip_raw()}</div>
  <div class="legend"><span><i class="sw" style="border-color:var(--guide)"></i>banda de 16 unidades onde o lado maior deve terminar</span><span><i class="sw dash" style="border-color:var(--guide)"></i>centro da caixa</span><span><i class="sw dash" style="border-color:#fff;filter:drop-shadow(0 0 1px #000)"></i>extensão real da tinta, medida</span></div>
</section>

<section>
  <div><h2>4 · Depois da normalização do Parker</h2><p>Cada glifo é escalado para o lado maior ter 16 das 24 unidades, centrado, com o traço dividido pela mesma escala. O interruptor "Preencher play, pausa, ampulheta" pinta as três formas que fecham área. O traço delas cai de 2.5 para 1.2, só o bastante para manter os cantos arredondados, senão ele come o vão de 4 unidades entre as barras da pausa e fecha a cintura da ampulheta. Como a tinta visível cresce meio traço para fora do path, o traço fino recuaria a borda externa em 0.65 por lado e o glifo pareceria 8% menor; por isso play e pausa podem ser escalados em 1.081 no modo preenchido ("borda igual"), mantidos no path ("path igual") ou reduzidos 6% ("−6%", a compensação óptica clássica: sólidos parecem maiores que contornos de mesma medida). O traço dos quatro glifos de linha também é ajustável. <b>Coesão</b> entre sólidos e linhas é justamente o equilíbrio desses dois números, e é melhor achá-lo no olho do que numa constante minha. Para a massa visual bater, os quatro glifos que são só traço, check, X, asterisco e menos, sobem de 2.5 para 3.25 no mesmo modo, As duas tampas da ampulheta, que são linhas e não bojos, ficam no traço normal de 2.5: elas estão na borda extrema do quadro e metade do traço cresce para fora, então o pesado a fazia mais alta que os vizinhos. A extensão externa muda meio traço para dentro nos preenchidos e meio traço para fora nos outros; a normalização em 16 continua valendo para o path. Seis acertam dentro de 0.006 unidade. O play não: <b>3% maior e deslocado para a direita</b>, porque a tabela de tinta foi lida pelos pontos finais dos arcos. Ligue "Play corrigido" na barra para ver a versão com <code>INK.doing = [3, 3, 21, 21]</code>, que mantém o deslocamento óptico do próprio Lucide.</p></div>
  <div class="strip">{strip_norm()}</div>
  <div class="tablewrap"><table><thead><tr><th>glifo</th><th>x</th><th>y</th><th>margem esq / dir</th><th>margem cima / baixo</th><th>Δx</th><th>Δy</th><th>meio traço</th></tr></thead><tbody>{table()}</tbody></table></div>
  <p>Só o lado maior é normalizado; no eixo menor o glifo fica centrado mas não encosta na banda, por isso a ampulheta tem 2.4 de cada lado. A tinta visível ainda cresce meio traço para fora, igual em todas as direções.</p>
</section>

<section>
  <div><h2>4b · A pena, lado a lado</h2><p>A decisão que segura as outras: com que pena os sete glifos ficam <b>bonitos e coesos</b>. Cada cartão é um conjunto fechado, imune aos controles da barra: contorno com três penas, e preenchido cruzando o peso das linhas (check, X, asterisco, menos) com o tamanho dos sólidos (play, pausa). Em cima a 30 px, para ver a forma; embaixo a 14 px, que é o que se usa. O último cartão testa uma pena mais grossa também nos sólidos, para os cantos arredondarem mais.</p></div>
  {pen_sheet()}
  <p>Como olhar: procure o cartão em que os sete parecem desenhados pela mesma mão, e em que a linha de 14 px continua legível. Contorno é uma família só e sempre coeso; preenchido tem duas e precisa do equilíbrio certo, ou o play e a pausa dominam.</p>
</section>

<section>
  <div><h2>5 · A anatomia do play</h2><p>Os três cantos são arcos de raio 2 que bojam além dos pontos finais; a tabela anotou os pontos finais. À direita e embaixo o erro é quase uma unidade, e é ele que empurra o centro para 12.5 e infla a escala.</p></div>
  {anatomy}
  <div class="legend"><span><i class="sw dash" style="border-color:var(--inkrect)"></i>INK lido à mão</span><span><i class="dotl" style="background:var(--inkrect)"></i>pontos finais dos arcos</span><span><i class="sw" style="border-color:var(--truerect)"></i>tinta real, medida</span></div>
</section>

<section>
  <div><h2>6 · Prioridade, variações</h2><p>No arquivo, bangs colados na tag: <code>/TODO!</code>, <code>/TODO!!</code>, <code>/TODO!!!</code>. Na tela, três eixos para explorar, na barra de controles: <b>onde</b> o marcador aparece (barra na margem, borda da caixa, ou ambos), <b>se o tamanho varia</b> com o nível, e <b>a rampa</b> de cores. Tudo abaixo obedece: a escada, a nota a 14 px e a lista do iPhone. Sempre presente, em qualquer estado.</p></div>
  {swatches()}
  {ladder()}
  <p>Na escada, cada linha tem uma caixa vazia (TODO) e uma preenchida (DOING). Na vazia, a borda assume a cor da prioridade. Na preenchida, a borda hoje tem a cor do estado; o seletor "Caixa preenchida" escolhe entre <b>borda interna</b> na cor da prioridade, com o tamanho exato de sempre; <b>barra na margem</b>, em que a borda fica com o estado e a prioridade volta para a margem só nessas linhas; e <b>sem sinal</b>, em que a caixa preenchida não mostra prioridade. A terceira quebra a regra de "sempre presente" nas tarefas em andamento e concluídas; está aqui para você ver o custo. Nada por fora da caixa: um anel engordava o quadrado, e o tamanho da caixa é intocável. <b>"Sem cinza"</b> desloca a rampa um degrau: um to-do sem bang já veste a primeira cor (verde, no semáforo), e os bangs sobem dali — todo to-do fica colorido, e o cinza sai da gradação. Com uma rampa de quatro cores isso dá três níveis de bang; com uma de três, dois. Repare que verde é a cor de DONE e âmbar a de ATTN, e veja se isso confunde na nota inteira, logo abaixo.</p>
</section>

<section>
  <div><h2>7 · Em contexto: a nota inteira</h2><p>Estados, aninhamento, cores herdadas e prioridade, a 14 px como no Mac. À direita, o texto exatamente como está no arquivo.</p></div>
  <div class="two">{editor()}<pre class="src">{html.escape(SRC)}</pre></div>
</section>

<section>
  <div><h2>8 · No iPhone</h2><p>A visão por estado ordena por prioridade dentro de cada estado, com a mesma barra na borda da linha; a visão por nota mantém a ordem do documento. A folha do toque longo escolhe estado e prioridade.</p></div>
  <div class="two">{phone_list()}{sheet()}</div>
</section>

<section>
  <div><h2>9 · Decisões</h2></div>
  <div class="decisions">
    <div><b>Glifos<span class="tag">decidido</span></b><span>Lucide literal, normalizado para 16/24 e centrado. Fonte única: <code>todo-glyph.ts</code>, exportado para o iPhone via <code>shared/design-tokens.json</code>.</span></div>
    <div><b>Pena<span class="tag">decidido</span></b><span>Preenchido: play, pausa e bojos da ampulheta sólidos com traço 1.2, no tamanho do path (sem escala); check, X, asterisco e menos com traço 4; tampas da ampulheta em 2.5. No Mac: <code>STROKE</code> e <code>fill</code> por glifo em <code>todo-glyph.ts</code>; no JSON, os mesmos por estado.</span></div>
    <div><b>Play<span class="tag">decidido</span></b><span><code>INK.doing = [3, 3, 21, 21]</code>: lado 16 exato e o deslocamento óptico do Lucide preservado. Uma linha no Mac; o iPhone herda pelo JSON.</span></div>
    <div><b>Prioridade · gramática<span class="tag">decidido</span></b><span>Bangs colados na tag, <code>!{{1,3}}</code>: três níveis acima da base. <code>/TODO !!</code> com espaço é texto. Alias normaliza (<code>/WIP!!</code> → <code>/DOING!!</code>); concluídos guardam a marca no arquivo. O Mac reconhece a gramática para <code>/TODO!!</code> continuar sendo um to-do com caixa.</span></div>
    <div><b>Prioridade · onde aparece<span class="tag">decidido · Mac e iPhone</span></b><span>Na <b>borda da caixa vazia</b> (TODO), na cor do nível. Caixas preenchidas <b>sem sinal</b>. Nada na linha se move. Implementado no Mac em 1.1.0 (editor e preview); o iPhone herda pelo JSON.</span></div>
    <div><b>Prioridade · cores<span class="tag">decidido</span></b><span><b>Semáforo de quatro, sem cinza</b>: a base (sem bang) é verde; <code>!</code> amarelo, <code>!!</code> laranja, <code>!!!</code> vermelho. Roles <code>priority0…3</code> por tema, claro e escuro, no JSON.</span></div>
    <div><b>Prioridade · ordem<span class="tag">decidido</span></b><span>Por prioridade só na visão por estado do iPhone. Editor e visão por nota: ordem do documento.</span></div>
    <div><b>Prioridade · gestos<span class="tag open">testar no uso</span></b><span>Proposta provisória: iPhone, fileira na folha do toque longo e chips "!!! only" / "!! and up". Mac, sem gesto por enquanto (sem visual, sem gesto). Decide-se com o app na mão.</span></div>
    <div><b>Concluídos<span class="tag">decidido</span></b><span>Sem sinal nas preenchidas, os concluídos não mostram prioridade; "Apagar em concluídos" sai da implementação.</span></div>
  </div>
</section>
</main>
<script>
(function(){{
  var THEMES = {THEMES};
  var root = document.documentElement, body = document.body;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function pick(id){{ return THEMES.find(function(t){{ return t.id === id; }}); }}
  function apply(t){{
    var u = t.ui, s = t.syntax, d = t.todo, st = root.style;
    st.setProperty('--bg', u.editorBg); st.setProperty('--fg', u.editorFg); st.setProperty('--chrome', u.headerBg);
    st.setProperty('--text', u.text); st.setProperty('--secondary', u.secondary); st.setProperty('--muted', u.muted);
    st.setProperty('--border', u.border); st.setProperty('--accent', u.accent); st.setProperty('--on-accent', u.onAccent); st.setProperty('--danger', u.danger);
    st.setProperty('--heading', s.heading); st.setProperty('--bold', s.bold); st.setProperty('--list', s.list);
    ['doing','pause','wait','attn','done','fail'].forEach(function(k){{ st.setProperty('--todo-' + k, d[k]); }});
    root.setAttribute('data-mode', t.mode);
    applyRamp();
  }}
  var RAMPS = {{
    heat3:    {{ levels: 3, light: ['#d97706','#ea580c','#dc2626'],           dark: ['#fbbf24','#fb923c','#ef4444'] }},
    red3:     {{ levels: 3, light: ['#fca5a5','#ef4444','#b91c1c'],           dark: ['rgba(239,68,68,.45)','#ef4444','#fca5a5'] }},
    traffic4: {{ levels: 4, light: ['#16a34a','#eab308','#ea580c','#dc2626'], dark: ['#4ade80','#facc15','#fb923c','#ef4444'] }},
    traffic3: {{ levels: 3, light: ['#16a34a','#d97706','#dc2626'],           dark: ['#4ade80','#fbbf24','#ef4444'] }}
  }};
  var ramp = 'traffic4', mark = 'border', len = 'vary', filled = 'none';
  function applyRamp(){{
    var dark = root.getAttribute('data-mode') === 'dark';
    var r = RAMPS[ramp], c = dark ? r.dark : r.light;
    var nogrey = document.getElementById('nogrey').checked;
    body.classList.toggle('no-grey', nogrey);
    // level → color: with grey, level 0 has none and level k takes c[k-1]; without, level k takes c[k]
    var rows = nogrey ? c.length : c.length + 1;         // ladder rows shown (levels incl. 0)
    var heights = rows === 5 ? ['.35em','.55em','.75em','.95em','1.15em'] : rows === 4 ? ['.35em','.62em','.9em','1.15em'] : ['.45em','.8em','1.15em'];
    for (var k = 0; k <= 4; k++) {{
      var col = nogrey ? c[Math.min(k, c.length - 1)] : (k === 0 ? 'transparent' : c[Math.min(k - 1, c.length - 1)]);
      root.style.setProperty('--p' + k, col);
      root.style.setProperty('--h' + k, heights[Math.min(k, heights.length - 1)]);
    }}
    document.querySelectorAll('.ln[data-row]').forEach(function(ln){{
      var k = +ln.getAttribute('data-row');
      ln.style.display = k < rows ? '' : 'none';
      var em = ln.querySelector('.lab em'); if (em) em.textContent = (k === 0 ? (nogrey ? 'base, já colorida' : 'sem prioridade') : (k === rows - 1 ? 'máximo' : ''));
    }});
    document.querySelectorAll('[data-ramp]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-ramp') === ramp); }});
    // swatch previews keep their own colors, in the right mode
    document.querySelectorAll('.swbars').forEach(function(sw){{
      var rr = RAMPS[sw.getAttribute('data-ramp')], cc = dark ? rr.dark : rr.light, h = [9, 14, 18, 22];
      sw.innerHTML = cc.map(function(col, i){{ return '<i style="background:' + col + ';height:' + (len === 'fixed' ? 22 : h[i + (4 - cc.length)]) + 'px"></i>'; }}).join('');
    }});
  }}
  function applyMark(){{
    body.classList.remove('mark-bar', 'mark-border', 'mark-both'); body.classList.add('mark-' + mark);
    body.classList.toggle('len-fixed', len === 'fixed');
    body.classList.toggle('filled-inset', filled === 'inset'); body.classList.toggle('filled-bar', filled === 'bar');
    document.querySelectorAll('.controls button[data-filled]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-filled') === filled); }});
    document.querySelectorAll('.controls button[data-mark]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-mark') === mark); }});
    document.querySelectorAll('.controls button[data-len]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-len') === len); }});
    applyRamp();
  }}
  document.querySelectorAll('[data-ramp]').forEach(function(b){{ b.addEventListener('click', function(){{ ramp = b.getAttribute('data-ramp'); applyRamp(); }}); }});
  document.querySelectorAll('.controls button[data-mark]').forEach(function(b){{ b.addEventListener('click', function(){{ mark = b.getAttribute('data-mark'); applyMark(); }}); }});
  document.querySelectorAll('.controls button[data-len]').forEach(function(b){{ b.addEventListener('click', function(){{ len = b.getAttribute('data-len'); applyMark(); }}); }});
  document.querySelectorAll('.controls button[data-filled]').forEach(function(b){{ b.addEventListener('click', function(){{ filled = b.getAttribute('data-filled'); applyMark(); }}); }});
  var current = 'system';
  function resolve(){{ return current === 'system' ? pick(mq.matches ? 'vercel-night' : 'vercel-day') : pick(current); }}
  function setTheme(id){{
    current = id; apply(resolve());
    document.querySelectorAll('.controls button[data-theme-id]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-theme-id') === id); }});
    try {{ localStorage.setItem('parker-visuals-theme', id); }} catch (e) {{}}
  }}
  document.querySelectorAll('.controls button[data-theme-id]').forEach(function(b){{ b.addEventListener('click', function(){{ setTheme(b.getAttribute('data-theme-id')); }}); }});
  mq.addEventListener('change', function(){{ if (current === 'system') apply(resolve()); }});
  var saved = 'system'; try {{ saved = localStorage.getItem('parker-visuals-theme') || 'system'; }} catch (e) {{}}
  setTheme(pick(saved) || saved === 'system' ? saved : 'system');
  var g = document.getElementById('guides'), f = document.getElementById('fixplay'), fs = document.getElementById('fillshapes');
  var heavy = '4', solids = 'path';
  function fillTuning(){{
    root.style.setProperty('--heavy', heavy);
    body.classList.remove('solids-edge', 'solids-path', 'solids-optical'); body.classList.add('solids-' + solids);
    document.querySelectorAll('.controls button[data-heavy]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-heavy') === heavy); }});
    document.querySelectorAll('.controls button[data-solids]').forEach(function(b){{ b.classList.toggle('on', b.getAttribute('data-solids') === solids); }});
  }}
  document.querySelectorAll('.controls button[data-heavy]').forEach(function(b){{ b.addEventListener('click', function(){{ heavy = b.getAttribute('data-heavy'); fillTuning(); }}); }});
  document.querySelectorAll('.controls button[data-solids]').forEach(function(b){{ b.addEventListener('click', function(){{ solids = b.getAttribute('data-solids'); fillTuning(); }}); }});
  fillTuning();
  function flags(){{ body.classList.toggle('show-guides', g.checked); body.classList.toggle('fix-play', f.checked); body.classList.toggle('fill-shapes', fs.checked); }}
  g.addEventListener('change', flags); f.addEventListener('change', flags); fs.addEventListener('change', flags); flags();
  document.getElementById('nogrey').addEventListener('change', applyRamp);
  applyMark();
}})();
</script>
'''
open(os.path.join(HERE, 'parker-todo-visuals.html'),'w',encoding='utf-8').write(page); print("written", len(page))
