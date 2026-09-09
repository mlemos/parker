#!/usr/bin/env python3
"""Generate the Parker for iPhone mockup artboards (.dc.html) and canvas.json from
Parker's real tokens. The artboards are seeded into a Claude Design canvas:
https://claude.ai/code/artifact/843d9b1e-b24c-4e4b-a035-78b6ae2c9e93

    python3 design/iphone-mockups/gen.py
"""
import json, os

OUT = os.path.dirname(os.path.abspath(__file__))

# ---- Parker tokens (src/lib/palette.ts + themes.ts) -------------------------
DAY = dict(
    editorBg="#ffffff", editorFg="#18181b", currentLine="rgba(16,185,129,0.1)",
    selection="rgba(16,185,129,0.2)", headerBg="#f4f4f5", fieldBg="#ffffff",
    tabbarBg="#fafafa", text="#18181b", secondary="#52525b", muted="#a1a1aa",
    border="#e4e4e7", accent="#059669", onAccent="#ffffff", danger="#dc2626",
    # syntax (daySyntax)
    heading="#7c3aed", bold="#d97706", italic="#059669", list="#0891b2",
    inlineCode="#c026d3", link="#0284c7", comment="#a1a1aa", punct="#71717a",
    # todo (lightTodo)
    doing="#0891b2", pause="#2563eb", wait="#9333ea", attn="#d97706",
    done="#16a34a", fail="#dc2626",
)
NIGHT = dict(
    editorBg="#000000", editorFg="#ffffff", currentLine="rgba(34,197,94,0.2)",
    selection="rgba(34,197,94,0.33)", headerBg="#27272a", fieldBg="#09090b",
    tabbarBg="#18181b", text="#f4f4f5", secondary="#a1a1aa", muted="#71717a",
    border="#27272a", accent="#10b981", onAccent="#022c22", danger="#f87171",
    heading="#a78bfa", bold="#fbbf24", italic="#6ee7b7", list="#22d3ee",
    inlineCode="#e879f9", link="#38bdf8", comment="#71717a", punct="#a1a1aa",
    doing="#22d3ee", pause="#60a5fa", wait="#c084fc", attn="#fbbf24",
    done="#4ade80", fail="#ef4444",
)

UI = "-apple-system, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif"
MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"

# ---- To-do glyphs (src/lib/todo-glyph.ts, verbatim) --------------------------
GLYPH_PATHS = {
    "done": ["M20 6 9 17l-5-5"],
    "fail": ["M18 6 6 18", "m6 6 12 12"],
    "cancel": ["M5 12h14"],
    "attn": ["M12 6v12", "M17.196 9 6.804 15", "m6.804 9 10.392 6"],
    "doing": ["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"],
    "wait": ["M5 22h14", "M5 2h14",
             "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",
             "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"],
}
INK = {"doing": (5, 3.27, 20.01, 20.73), "pause": (5, 3, 19, 21), "wait": (5, 2, 19, 22),
       "attn": (6.8, 6, 17.2, 18), "done": (4, 6, 20, 17), "fail": (6, 6, 18, 18),
       "cancel": (5, 12, 19, 12)}
STROKE, INK_TARGET = 2.5, 16

def glyph_svg(kind):
    if kind == "todo":
        return ""
    x0, y0, x1, y1 = INK[kind]
    scale = INK_TARGET / max(x1 - x0, y1 - y0)
    r = lambda n: round(n * 1000) / 1000
    tx, ty = r(12 - scale * (x0 + x1) / 2), r(12 - scale * (y0 + y1) / 2)
    width = r(STROKE / scale)
    if kind == "pause":
        shapes = ''.join(f'<rect x="{x}" y="{y}" width="5" height="18" rx="1"></rect>' for x, y in ((5, 3), (14, 3)))
    else:
        shapes = ''.join(f'<path d="{d}"></path>' for d in GLYPH_PATHS[kind])
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" '
            f'stroke-linejoin="round" style="width: 0.85em; height: 0.85em; display: block;">'
            f'<g transform="translate({tx} {ty}) scale({r(scale)})" stroke-width="{width}">{shapes}</g></svg>')

def todo_box(kind, t, size="0.95em"):
    """The Parker checkbox, two spans like App.css: .cm-todo-box is 0.95em square at the
    LINE's font size; .cm-todo-glyph inside carries the 1.5px border, 4px radius and a
    0.7em font, and the svg is 0.85em of that. Glyph knocked out in the editor bg."""
    color = t["muted"] if kind in ("todo", "cancel") else t[kind]
    if kind == "todo":
        inner = f'border: 1.5px solid {t["muted"]}; background: transparent;'
    else:
        inner = f'border: 1.5px solid {color}; background: {color};'
    return (f'<span style="display: inline-block; box-sizing: border-box; width: {size}; height: {size}; flex: 0 0 auto; overflow: hidden;">'
            f'<span style="display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 100%; height: 100%; '
            f'border-radius: 4px; {inner} color: {t["editorBg"]}; font-size: 0.7em; line-height: 1;">{glyph_svg(kind)}</span></span>')

# ---- Small icon set (stroke SVG, 24 grid, Lucide-style) ----------------------
def icon(name, size=24, color="currentColor", sw=1.8):
    P = {
        "search": '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
        "notes": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h6"></path>',
        "tasks": '<rect x="3" y="3" width="18" height="18" rx="4"></rect><path d="m8 12 3 3 5-6"></path>',
        "plus": '<path d="M12 5v14M5 12h14"></path>',
        "gear": '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>',
        "chevron-left": '<path d="m15 6-6 6 6 6"></path>',
        "chevron-right": '<path d="m9 6 6 6-6 6"></path>',
        "chevron-down": '<path d="m6 9 6 6 6-6"></path>',
        "ellipsis": '<circle cx="5" cy="12" r="1.2" fill="currentColor"></circle><circle cx="12" cy="12" r="1.2" fill="currentColor"></circle><circle cx="19" cy="12" r="1.2" fill="currentColor"></circle>',
        "cloud-down": '<path d="M4 15.5A4.5 4.5 0 0 1 7.6 8a6 6 0 0 1 11.6 1.5A4 4 0 0 1 18 17"></path><path d="M12 12v9m-3.5-3.5L12 21l3.5-3.5"></path>',
        "trash": '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"></path><path d="M10 11v6M14 11v6"></path>',
        "folder": '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
        "indent": '<path d="M3 6h18M11 12h10M11 18h10M3 10l4 2-4 2"></path>',
        "outdent": '<path d="M3 6h18M11 12h10M11 18h10M7 10l-4 2 4 2"></path>',
        "keyboard-down": '<rect x="3" y="4" width="18" height="11" rx="2"></rect><path d="M7 8h.01M11 8h.01M15 8h.01M9 11.5h6"></path><path d="m9 19 3 2 3-2"></path>',
        "check": '<path d="m5 12 5 5 9-10"></path>',
        "info": '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path>',
        "mac": '<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8M12 16v4"></path>',
        "icloud": '<path d="M6.5 19A4.5 4.5 0 0 1 6 10a6 6 0 0 1 11.7 1.4A3.8 3.8 0 0 1 17.5 19z"></path>',
    }
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" '
            f'stroke-linejoin="round" style="width: {size}px; height: {size}px; display: block; flex: 0 0 auto;">{P[name]}</svg>')

# ---- Phone shell -------------------------------------------------------------
W, H = 390, 844
SAFE_TOP = 59          # Dynamic Island area — left blank, never painted
TABBAR = 83            # 49 + 34 home-indicator area

def head(t, extra_css=""):
    return f'''<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500;600;700&amp;display=swap">
  <style>
    body {{ margin: 0; background: {t["headerBg"]}; }}
    a {{ color: {t["link"]}; text-decoration: underline; }} a:hover {{ color: {t["accent"]}; }}
    * {{ box-sizing: border-box; -webkit-font-smoothing: antialiased; }}
    {extra_css}
  </style>
</helmet>
'''

TAIL = '''</x-dc>
</body>
</html>
'''

def phone_open(t, bg=None):
    bg = bg or t["headerBg"]
    return (f'<div style="position: relative; width: {W}px; height: {H}px; overflow: hidden; background: {bg}; '
            f'color: {t["text"]}; font-family: {UI}; font-size: 17px; line-height: 22px; display: flex; flex-direction: column;">')

def tabbar(t, active):
    items = [("search", "Search"), ("notes", "Notes"), ("tasks", "Tasks")]
    cells = []
    for key, label in items:
        c = t["accent"] if key == active else t["muted"]
        cells.append(
            f'<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; flex: 1 1 0; min-height: 49px; color: {c};">'
            f'{icon(key, 26, c, 1.9)}<span style="font-size: 10px; line-height: 12px; font-weight: 500;">{label}</span></div>')
    return (f'<div style="position: absolute; left: 0; right: 0; bottom: 0; height: {TABBAR}px; background: {t["tabbarBg"]}; '
            f'border-top: 1px solid {t["border"]}; display: flex; flex-direction: column;">'
            f'<div style="display: flex; align-items: stretch; height: 49px; padding-top: 4px;">{"".join(cells)}</div>'
            f'<div style="height: 34px; display: flex; align-items: center; justify-content: center;">'
            f'<div style="width: 139px; height: 5px; border-radius: 3px; background: {t["text"]}; opacity: 0.9;"></div></div></div>')

def large_title(t, title, left="", right=""):
    return (f'<div style="padding: {SAFE_TOP}px 16px 0 16px; display: flex; flex-direction: column; gap: 4px;">'
            f'<div style="height: 44px; display: flex; align-items: center; justify-content: space-between; color: {t["accent"]};">'
            f'<div style="display: flex; align-items: center; gap: 6px; min-width: 44px;">{left}</div>'
            f'<div style="display: flex; align-items: center; gap: 6px; min-width: 44px; justify-content: flex-end;">{right}</div></div>'
            f'<div style="font-size: 34px; line-height: 41px; font-weight: 700; letter-spacing: -0.4px; padding: 2px 0 8px 0; color: {t["text"]};">{title}</div></div>')

def inline_nav(t, title, left_label="Notes", right=""):
    return (f'<div style="padding: {SAFE_TOP}px 8px 0 8px; height: {SAFE_TOP + 44}px; background: {t["headerBg"]}; border-bottom: 1px solid {t["border"]}; '
            f'display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto;">'
            f'<div style="display: flex; align-items: center; color: {t["accent"]}; min-width: 90px; height: 44px;">{icon("chevron-left", 26, t["accent"], 2.2)}<span style="font-size: 17px;">{left_label}</span></div>'
            f'<div style="font-size: 17px; font-weight: 600; color: {t["text"]}; flex: 1 1 auto; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{title}</div>'
            f'<div style="display: flex; align-items: center; justify-content: flex-end; gap: 4px; color: {t["accent"]}; min-width: 90px; height: 44px; padding-right: 4px;">{right}</div></div>')

def hairline(t, inset=16):
    return f'<div style="height: 1px; background: {t["border"]}; margin-left: {inset}px;"></div>'

def group(t, rows, header=None, footer=None):
    out = ''
    if header:
        out += f'<div style="flex: 0 0 auto; padding: 0 16px 6px 32px; font-size: 13px; line-height: 18px; color: {t["muted"]}; text-transform: uppercase; letter-spacing: 0.2px;">{header}</div>'
    out += f'<div style="flex: 0 0 auto; margin: 0 16px; background: {t["editorBg"]}; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;">'
    for i, r in enumerate(rows):
        if i:
            out += hairline(t)
        out += r
    out += '</div>'
    if footer:
        out += f'<div style="flex: 0 0 auto; padding: 6px 32px 0 32px; font-size: 13px; line-height: 18px; color: {t["muted"]};">{footer}</div>'
    return out

def write(name, html):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", name)


# =============================================================================
# 0. Flow map — how you get in, and where you live
# =============================================================================
FW, FH = 1560, 600

def flowmap(t):
    nodes, arrows, labels, regions = [], [], [], []
    def node(x, y, label, sub="", w=210, h=84, kind="screen"):
        if kind == "system":
            bg, bd, fg, dash = t["headerBg"], t["muted"], t["secondary"], "border-style: dashed;"
        elif kind == "start":
            bg, bd, fg, dash = t["accent"], t["accent"], t["onAccent"], ""
        else:
            bg, bd, fg, dash = t["editorBg"], t["border"], t["text"], ""
        subl = f'<div style="font-size: 13px; line-height: 17px; color: {t["secondary"] if kind != "start" else t["onAccent"]}; opacity: {1 if kind != "start" else 0.85};">{sub}</div>' if sub else ''
        nodes.append(f'<div style="position: absolute; left: {x}px; top: {y}px; width: {w}px; height: {h}px; box-sizing: border-box; border-radius: 12px; background: {bg}; border: 1.5px solid {bd}; {dash} padding: 12px 14px; display: flex; flex-direction: column; justify-content: center; gap: 3px;">'
                     f'<div style="font-size: 15px; line-height: 20px; font-weight: 600; color: {fg};">{label}</div>{subl}</div>')
        return (x, y, w, h)
    def right(n): return (n[0] + n[2], n[1] + n[3] / 2)
    def left(n): return (n[0], n[1] + n[3] / 2)
    def bottom(n): return (n[0] + n[2] / 2, n[1] + n[3])
    def top(n): return (n[0] + n[2] / 2, n[1])
    def arrow(a, b, text="", color=None, dashed=False, bend=0.5):
        color = color or t["secondary"]
        (x1, y1), (x2, y2) = a, b
        if abs(y1 - y2) < 2 or abs(x1 - x2) > abs(y1 - y2):
            cx = x1 + (x2 - x1) * bend
            d = f"M{x1} {y1} C{cx} {y1} {cx} {y2} {x2} {y2}"
        else:
            cy = y1 + (y2 - y1) * bend
            d = f"M{x1} {y1} C{x1} {cy} {x2} {cy} {x2} {y2}"
        dash = 'stroke-dasharray="5 5"' if dashed else ''
        arrows.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8" {dash} marker-end="url(#ah)"></path>')
        if text:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            labels.append(f'<div style="position: absolute; left: {mx}px; top: {my}px; transform: translate(-50%, -50%); background: {t["headerBg"]}; color: {color}; font-size: 12px; line-height: 16px; font-weight: 600; padding: 2px 8px; border-radius: 8px; white-space: nowrap; border: 1px solid {t["border"]};">{text}</div>')

    # --- first run ---
    store = node(40, 150, "App Store", "first open", w=140, h=84, kind="start")
    onb = node(240, 150, "1 · Onboarding", "two paths, one screen")
    fresh = node(560, 40, "1c · After Start fresh", "folder created in iCloud Drive")
    welcome = node(880, 40, "1d · Welcome note", "learn by tapping")
    mac = node(1200, 40, "Mac · Parker finds the folder", "getparker.dev → same notes", w=250, kind="system")
    picker = node(560, 260, "Files picker", "iCloud · Google Drive · Dropbox", kind="system")
    where = node(560, 460, "1b · Where is my folder?", "the three Mac cases")
    arrow(right(store), left(onb))
    arrow(right(onb), left(fresh), "Start fresh", color=t["accent"])
    arrow(right(fresh), left(welcome), "tap the note")
    arrow(right(welcome), left(mac), "on a Mac later", dashed=True)
    arrow(right(onb), left(picker), "I already have notes")
    arrow(bottom(onb), left(where), "Where is my folder?", bend=0.35)
    arrow(top(where), bottom(picker), "Open Files")

    # --- every day ---
    region_x, region_y, region_w, region_h = 860, 200, 660, 370
    regions.append(f'<div style="position: absolute; left: {region_x}px; top: {region_y}px; width: {region_w}px; height: {region_h}px; border-radius: 16px; background: {t["tabbarBg"]}; border: 1px dashed {t["border"]};"></div>'
                    f'<div style="position: absolute; left: {region_x + 18}px; top: {region_y + 12}px; font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: {t["muted"]};">Every day · the tab bar</div>')
    search = node(890, 250, "2 · Search", "home · full text", w=190)
    notesn = node(1100, 250, "3 · Notes", "newest first", w=190)
    tasks = node(1310, 250, "4 · Tasks", "by note · by state", w=190)
    note = node(1100, 440, "5 · Note", "the editor, both themes", w=190)
    newtask = node(1310, 440, "4c · New task", "the + in the bar", w=190)
    settings = node(890, 440, "6 · Settings", "folder · themes", w=190)
    arrow(right(picker), left(search), "42 notes found")
    arrow(bottom(welcome), top(notesn), "", dashed=True)
    arrow(bottom(search), left(note), "tap a result", bend=0.4)
    arrow(bottom(notesn), top(note), "tap a row")
    arrow(bottom(tasks), top(note), "tap the text", bend=0.4)
    arrow(bottom(tasks), top(newtask), "+", bend=0.6)
    arrow(bottom(search), top(settings), "gear")

    h = head(t)
    h += (f'<div style="position: relative; width: {FW}px; height: {FH}px; overflow: hidden; background: {t["headerBg"]}; font-family: {UI}; color: {t["text"]};">'
          f'<div style="position: absolute; left: 40px; top: 36px; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -0.2px;">How you get in, and where you live</div>'
          f'<div style="position: absolute; left: 40px; top: 66px; font-size: 14px; line-height: 20px; color: {t["secondary"]}; max-width: 420px; text-wrap: pretty;">Numbers match the artboards below. Solid arrows are taps; dashed ones happen on their own. Grey boxes are the system, not Parker.</div>'
          + ''.join(regions) +
          f'<svg style="position: absolute; inset: 0; width: {FW}px; height: {FH}px; overflow: visible;" viewBox="0 0 {FW} {FH}">'
          f'<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="{t["secondary"]}"></path></marker></defs>'
          + ''.join(arrows) + '</svg>' + ''.join(nodes) + ''.join(labels) + '</div>')
    h += TAIL
    return h

# =============================================================================
# 1. Onboarding — one screen
# =============================================================================
def option_card(t, icon_name, title, body):
    return (f'<div style="min-height: 72px; border-radius: 12px; background: {t["editorBg"]}; border: 1px solid {t["border"]}; padding: 12px 14px 12px 14px; display: flex; align-items: center; gap: 12px;">'
            f'<div style="width: 40px; height: 40px; border-radius: 10px; background: {t["headerBg"]}; display: flex; align-items: center; justify-content: center; flex: 0 0 auto;">{icon(icon_name, 22, t["accent"], 1.9)}</div>'
            f'<div style="display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0;">'
            f'<div style="font-size: 17px; font-weight: 600; color: {t["text"]};">{title}</div>'
            f'<div style="font-size: 14px; line-height: 19px; color: {t["secondary"]}; text-wrap: pretty;">{body}</div></div>'
            f'{icon("chevron-right", 18, t["muted"], 2.2)}</div>')

def onboarding(t, with_help=False):
    h = head(t)
    h += phone_open(t, bg=t["editorBg"])
    h += (f'<div style="flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: {SAFE_TOP}px 28px 0 28px; gap: 24px;">'
          f'<img src="parker-head.svg" alt="Parker" style="width: 88px; height: 88px; display: block; color: {t["text"]};">'
          f'<div style="display: flex; flex-direction: column; gap: 12px; align-items: center; text-align: center;">'
          f'<div style="font-family: {UI}; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -0.3px; color: {t["text"]}; text-wrap: pretty;">Your notes, as plain files in a folder you own.</div>'
          f'<div style="font-size: 17px; line-height: 24px; color: {t["secondary"]}; text-wrap: pretty; max-width: 320px;">No account. No servers of ours, ever. The folder syncs however you like, and any app can read it.</div>'
          f'</div></div>')
    h += (f'<div style="padding: 0 20px 40px 20px; display: flex; flex-direction: column; gap: 10px; align-items: stretch;">'
          + option_card(t, "icloud", "Start fresh", "We create a Parker folder in your iCloud Drive. A Mac with Parker finds it by itself.")
          + option_card(t, "folder", "I already have notes", "Pick the folder in Files. iCloud Drive, Google Drive and Dropbox all work.")
          + f'<div style="height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; color: {t["accent"]}; font-size: 15px; font-weight: 500;">{icon("info", 16, t["accent"], 2)}<span>Where is my folder?</span></div>'
          + '</div>')
    if with_help:
        steps = [
            ("1", "On your Mac, open Parker and look at Settings → Notes folder."),
            ("2", "If that folder is in iCloud Drive, pick the same folder here. Your notes appear in seconds."),
            ("3", "If your Mac syncs Desktop &amp; Documents with iCloud, the folder is under iCloud Drive › Documents."),
        ]
        rows = ''.join(
            f'<div style="display: flex; gap: 14px; align-items: flex-start;">'
            f'<div style="width: 26px; height: 26px; border-radius: 13px; background: {t["headerBg"]}; color: {t["text"]}; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex: 0 0 auto;">{n}</div>'
            f'<div style="font-size: 16px; line-height: 22px; color: {t["text"]}; padding-top: 2px; text-wrap: pretty;">{st}</div></div>'
            for n, st in steps)
        h += (f'<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.32);"></div>'
              f'<div style="position: absolute; left: 0; right: 0; bottom: 0; background: {t["editorBg"]}; border-radius: 16px 16px 0 0; padding: 8px 20px 44px 20px; display: flex; flex-direction: column; gap: 18px;">'
              f'<div style="display: flex; justify-content: center;"><div style="width: 36px; height: 5px; border-radius: 3px; background: {t["border"]};"></div></div>'
              f'<div style="font-size: 22px; line-height: 28px; font-weight: 700; color: {t["text"]};">Where is my folder?</div>'
              f'<div style="display: flex; flex-direction: column; gap: 16px;">{rows}</div>'
              f'<div style="display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; background: {t["headerBg"]}; color: {t["secondary"]}; font-size: 14px; line-height: 20px;">{icon("info", 18, t["attn"], 2)}<span>A folder in <b style="color: {t["text"]}; font-weight: 600;">On My iPhone</b> stays on this phone and will not sync with your Mac. No notes yet? Go back and choose Start fresh.</span></div>'
              f'<div style="height: 50px; border-radius: 12px; background: {t["accent"]}; color: {t["onAccent"]}; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600;">Open Files</div>'
              f'</div>')
    h += '</div>' + TAIL
    return h

def fresh_start(t):
    """Right after Start fresh: the folder exists, one note in it, and where to find it."""
    h = head(t)
    h += phone_open(t)
    h += large_title(t, "Notes", left=icon("gear", 24, t["accent"], 1.8), right=icon("plus", 26, t["accent"], 2))
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding-bottom: {TABBAR}px;">'
    h += (f'<div style="flex: 0 0 auto; margin: 0 16px; padding: 14px 16px; border-radius: 12px; background: {t["editorBg"]}; border: 1px solid {t["border"]}; display: flex; flex-direction: column; gap: 10px;">'
          f'<div style="display: flex; align-items: center; gap: 10px;">{icon("icloud", 22, t["accent"], 1.9)}<span style="font-size: 17px; font-weight: 600; color: {t["text"]};">Your folder is ready</span></div>'
          f'<div style="font-size: 15px; line-height: 21px; color: {t["secondary"]}; text-wrap: pretty;">It lives at <b style="color: {t["text"]}; font-weight: 600;">iCloud Drive › Parker</b>. You can see it in Files, and on a Mac, Parker opens it by itself.</div>'
          f'<div style="display: flex; align-items: center; gap: 8px; color: {t["accent"]}; font-size: 15px; font-weight: 500;">{icon("mac", 18, t["accent"], 1.9)}<span>Get Parker for Mac · getparker.dev</span></div>'
          f'</div>')
    h += group(t, [
        (f'<div style="min-height: 52px; padding: 0 16px; display: flex; align-items: center; gap: 10px;">'
         f'<span style="font-size: 17px; color: {t["text"]}; flex: 1 1 auto;">Welcome to Parker</span>'
         f'<span style="font-size: 15px; color: {t["muted"]};">now</span>{icon("chevron-right", 18, t["border"], 2.4)}</div>'),
    ])
    h += f'<div style="flex: 0 0 auto; padding: 0 32px; font-size: 13px; line-height: 18px; color: {t["muted"]};">1 note · iCloud Drive › Parker</div>'
    h += '</div>'
    h += tabbar(t, "notes")
    h += '</div>' + TAIL
    return h

# =============================================================================
# 2. Search — the home screen
# =============================================================================
def mark(t, s):
    return f'<span style="background: {t["selection"]}; border-radius: 3px; padding: 0 1px;">{s}</span>'

def search(t):
    h = head(t)
    h += phone_open(t)
    right = icon("gear", 24, t["accent"], 1.8)
    h += large_title(t, "Search", right=right)
    # search field with the query typed, plus Cancel
    h += (f'<div style="padding: 0 16px 12px 16px; display: flex; align-items: center; gap: 12px;">'
          f'<div style="flex: 1 1 auto; height: 36px; border-radius: 10px; background: {t["editorBg"]}; border: 1px solid {t["border"]}; display: flex; align-items: center; gap: 8px; padding: 0 10px;">'
          f'{icon("search", 18, t["muted"], 2)}<span style="font-size: 17px; color: {t["text"]}; flex: 1 1 auto;">launch</span>'
          f'<span style="width: 2px; height: 20px; background: {t["accent"]}; border-radius: 1px; margin-left: -6px;"></span></div>'
          f'<span style="font-size: 17px; color: {t["accent"]};">Cancel</span></div>')
    # first-run confirmation banner (shows once, after the folder is picked)
    h += (f'<div style="margin: 0 16px 12px 16px; padding: 10px 14px; border-radius: 10px; background: {t["editorBg"]}; border: 1px solid {t["border"]}; display: flex; align-items: center; gap: 10px;">'
          f'{icon("icloud", 20, t["accent"], 1.9)}<span style="font-size: 15px; color: {t["text"]};"><b style="font-weight: 600;">42 notes found</b> · synced via iCloud Drive</span></div>')
    def result(name, when, snippet_html):
        return (f'<div style="padding: 11px 16px 12px 16px; display: flex; flex-direction: column; gap: 4px;">'
                f'<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 12px;">'
                f'<span style="font-size: 17px; font-weight: 600; color: {t["text"]}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{name}</span>'
                f'<span style="font-size: 13px; color: {t["muted"]}; flex: 0 0 auto;">{when}</span></div>'
                f'<div style="font-family: {MONO}; font-size: 13px; line-height: 20px; color: {t["secondary"]}; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">{snippet_html}</div></div>')
    names = [
        result(mark(t, "Launch") + " checklist", "2m", f'<span style="color: {t["heading"]}; font-weight: 700;"># Launch checklist</span><br>Ship v0.1 by <span style="color: {t["bold"]}; font-weight: 700;">**Friday**</span>. Remaining:'),
        result(mark(t, "Launch") + " tweet drafts", "Yesterday", 'Three options, shortest first. Keep the second one if the video is ready.'),
    ]
    bodies = [
        result("Weekly review", "Mon", f'<span style="color: {t["done"]}; font-weight: 500;">/DONE Move the {mark(t, "launch")} date to the 14th</span><br>' + f'<span style="color: {t["list"]};">-</span> tell the beta group'),
        result("Prompt · onboarding copy", "Aug 30", f'Rewrite so a first-time user knows what happens after {mark(t, "launch")}: one sentence, no jargon.'),
        result("Reading list", "Aug 22", f'<span style="color: {t["list"]};">-</span> <span style="color: {t["link"]}; text-decoration: underline;">The Mom Test</span> — read before the {mark(t, "launch")} interviews'),
    ]
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 22px; padding-bottom: {TABBAR}px;">'
    h += group(t, names, header="Notes")
    h += group(t, bodies, header="In notes · 5 matches")
    h += '</div>'
    h += tabbar(t, "search")
    h += '</div>' + TAIL
    return h

# =============================================================================
# 3. Notes — the folder, newest first
# =============================================================================
def notes(t):
    h = head(t)
    h += phone_open(t)
    h += large_title(t, "Notes", left=icon("gear", 24, t["accent"], 1.8), right=icon("plus", 26, t["accent"], 2))
    def row(name, when, badge="", shifted=False, dirty=False):
        trailing = ''
        shift = ''
        if shifted:
            shift = 'transform: translateX(-88px);'
            trailing = (f'<div style="position: absolute; right: 0; top: 0; bottom: 0; width: 88px; background: {t["danger"]}; color: #ffffff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 500;">{icon("trash", 22, "#ffffff", 1.9)}<span>Trash</span></div>')
        dot = f'<span style="width: 7px; height: 7px; border-radius: 4px; background: {t["accent"]}; flex: 0 0 auto;"></span>' if dirty else ''
        return (f'<div style="position: relative; overflow: hidden; background: {t["editorBg"]};">{trailing}'
                f'<div style="position: relative; background: {t["editorBg"]}; min-height: 52px; padding: 0 16px; display: flex; align-items: center; gap: 10px; {shift}">'
                f'{dot}<span style="font-size: 17px; color: {t["text"]}; flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{name}</span>'
                f'{badge}<span style="font-size: 15px; color: {t["muted"]}; flex: 0 0 auto;">{when}</span>{icon("chevron-right", 18, t["border"], 2.4)}</div></div>')
    cloud = icon("cloud-down", 20, t["muted"], 1.8)
    rows = [
        row("Launch checklist", "2m", dirty=True),
        row("Untitled-3", "14m"),
        row("Weekly review", "Mon"),
        row("Launch tweet drafts", "Yesterday"),
        row("Prompt · onboarding copy", "Aug 30", shifted=True),
        row("Trip · Lisbon", "Aug 28", badge=cloud),
        row("API notes", "Aug 27"),
        row("Reading list", "Aug 22"),
        row("Ideas", "Aug 20"),
        row("Scratchpad", "Aug 19"),
        row("Grocery", "Aug 18"),
    ]
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; padding-bottom: {TABBAR}px;">'
    h += f'<div style="margin: 0 16px; background: {t["editorBg"]}; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column;">'
    for i, r in enumerate(rows):
        if i:
            h += hairline(t)
        h += r
    h += '</div>'
    h += f'<div style="padding: 10px 32px 0 32px; font-size: 13px; line-height: 18px; color: {t["muted"]};">42 notes · iCloud Drive › Parker · one still downloading</div>'
    h += '</div>'
    h += tabbar(t, "notes")
    h += '</div>' + TAIL
    return h

# =============================================================================
# 4. Tasks — every to-do, by note (default) or by state
# =============================================================================
def segmented(t, options, selected):
    cells = []
    for o in options:
        on = o == selected
        cells.append(f'<div style="flex: 1 1 0; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; '
                     f'font-size: 13px; font-weight: 600; color: {t["text"]}; background: {t["editorBg"] if on else "transparent"}; '
                     f'box-shadow: {"0 1px 3px rgba(0,0,0,0.12)" if on else "none"};">{o}</div>')
    return (f'<div style="margin: 0 16px 12px 16px; height: 32px; padding: 2px; border-radius: 9px; background: {t["border"]}; display: flex; gap: 2px; flex: 0 0 auto;">'
            + ''.join(cells) + '</div>')

def task_line(t, kind, text, children=(), note_above=None):
    """One to-do as the editor paints it: box, text in the state color, and what is nested
    under it. A child is either a plain string (a `- ` line in the parent's color, darkened)
    or a (kind, text) tuple: a nested to-do with its own box and its own state color.
    `note_above` puts the note name (or path) over it — the by-state view."""
    color = t["editorFg"] if kind == "todo" else (t["muted"] if kind == "cancel" else t[kind])
    above = (f'<div style="font-size: 12px; line-height: 16px; color: {t["muted"]}; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{note_above}</div>'
             if note_above else '')
    kids = ''
    for c in children:
        if isinstance(c, tuple):
            ck, ctext = c[0], c[1]
            ccolor = t["editorFg"] if ck == "todo" else (t["muted"] if ck == "cancel" else t[ck])
            kids += (f'<div style="display: flex; align-items: center; gap: 8px; padding-left: 2px;">'
                     f'<div style="font-size: 13px; line-height: 22px; display: flex; align-items: center; height: 22px;">{todo_box(ck, t)}</div>'
                     f'<span style="font-family: {MONO}; font-size: 13px; line-height: 22px; color: {ccolor}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{ctext}</span></div>')
        else:
            kids += (f'<div style="font-family: {MONO}; font-size: 13px; line-height: 20px; color: {color}; filter: brightness(0.82); padding-left: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">'
                     f'<span style="color: {t["list"]};">-</span> {c}</div>')
    return (f'<div style="padding: 8px 16px 8px 16px; display: flex; align-items: flex-start; gap: 10px;">'
            f'<div style="font-size: 15px; line-height: 24px; display: flex; align-items: center; height: 24px; margin-top: {16 + 2 if note_above else 0}px;">{todo_box(kind, t)}</div>'
            f'<div style="display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0;">{above}'
            f'<span style="font-family: {MONO}; font-size: 15px; line-height: 24px; color: {color}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{text}</span>'
            f'{kids}</div></div>')

def note_header(t, name, count):
    return (f'<div style="min-height: 44px; padding: 0 12px 0 16px; display: flex; align-items: center; gap: 8px; background: {t["editorBg"]};">'
            f'<span style="font-size: 15px; font-weight: 600; color: {t["text"]}; flex: 1 1 auto;">{name}</span>'
            f'<span style="font-size: 13px; color: {t["muted"]};">{count}</span>{icon("chevron-right", 18, t["border"], 2.4)}</div>')

def note_footer(t, finished=None):
    fin = (f'<div style="display: flex; align-items: center; gap: 4px; color: {t["muted"]}; font-size: 13px;"><span>{finished} finished</span>{icon("chevron-down", 16, t["muted"], 2.2)}</div>'
           if finished else '')
    return (f'<div style="min-height: 40px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">'
            f'<div style="display: flex; align-items: center; gap: 6px; color: {t["accent"]}; font-size: 15px; font-weight: 500;">{icon("plus", 18, t["accent"], 2.2)}<span>Add task</span></div>{fin}</div>')

def tasks_by_note(t, with_add=False):
    h = head(t)
    h += phone_open(t)
    h += large_title(t, "Tasks", right=icon("plus", 26, t["accent"], 2))
    h += segmented(t, ["By note", "By state"], "By note")
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 16px; padding-bottom: {TABBAR}px;">'
    h += group(t, [
        note_header(t, "Launch checklist", "3 open"),
        task_line(t, "doing", "Write the release notes", [("done", "Draft the highlights"), ("todo", "Link the changelog"), "keep it under ten lines"]),
        task_line(t, "attn", "Ask Ana about the icon", ["she sent two options, pick one"]),
        task_line(t, "todo", "Record the demo video"),
        note_footer(t, finished=2),
    ])
    h += group(t, [
        note_header(t, "Trip · Lisbon", "2 open"),
        task_line(t, "todo", "Book the flights"),
        task_line(t, "todo", "Renew the passport", ["expires in March"]),
        note_footer(t),
    ])
    h += group(t, [
        note_header(t, "API notes", "1 open"),
        task_line(t, "pause", "Refactor the sync layer"),
        note_footer(t, finished=4),
    ])
    h += '</div>'
    h += tabbar(t, "tasks")
    if with_add:
        h += add_sheet(t)
    h += '</div>' + TAIL
    return h

def chip(t, label, on=False):
    return (f'<div style="height: 32px; padding: 0 12px; border-radius: 16px; display: flex; align-items: center; white-space: nowrap; flex: 0 0 auto; '
            f'font-size: 14px; font-weight: 500; color: {t["onAccent"] if on else t["text"]}; background: {t["accent"] if on else t["editorBg"]}; '
            f'border: 1px solid {t["accent"] if on else t["border"]};">{label}</div>')

def tasks_by_state(t):
    h = head(t)
    h += phone_open(t)
    h += large_title(t, "Tasks", right=icon("plus", 26, t["accent"], 2))
    h += segmented(t, ["By note", "By state"], "By state")
    h += (f'<div style="display: flex; gap: 8px; padding: 0 16px 14px 16px; overflow: hidden; flex: 0 0 auto;">'
          + chip(t, "All notes", on=True) + chip(t, "Launch checklist") + chip(t, "Trip · Lisbon") + chip(t, "API notes") + chip(t, "Weekly review") + '</div>')
    def section(kind, label, count, rows):
        c = t["text"] if kind == "todo" else t[kind]
        hdr = (f'<div style="flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0 16px 6px 32px;">'
               f'<span style="font-size: 13px; line-height: 18px; font-weight: 600; color: {c}; text-transform: uppercase; letter-spacing: 0.3px;">{label}</span>'
               f'<span style="font-size: 13px; line-height: 18px; color: {t["muted"]};">{count}</span></div>')
        return hdr + group(t, rows)
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 14px; padding-bottom: {TABBAR}px;">'
    h += section("attn", "Needs you", 1, [task_line(t, "attn", "Ask Ana about the icon", ["she sent two options, pick one"], note_above="Launch checklist")])
    h += section("doing", "Doing", 1, [task_line(t, "doing", "Write the release notes", ["keep it under ten lines"], note_above="Launch checklist")])
    h += section("pause", "Paused", 1, [task_line(t, "pause", "Refactor the sync layer", note_above="API notes")])
    h += section("todo", "To do", 4, [
        task_line(t, "todo", "Link the changelog", note_above="Launch checklist › Write the release notes"),
        task_line(t, "todo", "Record the demo video", note_above="Launch checklist"),
        task_line(t, "todo", "Book the flights", note_above="Trip · Lisbon"),
    ])
    h += (f'<div style="flex: 0 0 auto; margin: 0 16px; background: {t["editorBg"]}; border-radius: 10px; min-height: 44px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between;">'
          f'<span style="font-size: 15px; color: {t["secondary"]};">Finished</span>'
          f'<div style="display: flex; align-items: center; gap: 6px; color: {t["muted"]};"><span style="font-size: 15px;">6</span>{icon("chevron-right", 18, t["border"], 2.4)}</div></div>')
    h += '</div>'
    h += tabbar(t, "tasks")
    h += '</div>' + TAIL
    return h

def add_sheet(t):
    """Quick add: the text, and which note it goes to. Lands as `/TODO text` after the
    note's last to-do (or at its end). The system keyboard comes up under it."""
    return (f'<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.32);"></div>'
            f'<div style="position: absolute; left: 0; right: 0; bottom: 0; background: {t["headerBg"]}; border-radius: 16px 16px 0 0; padding: 8px 16px 24px 16px; display: flex; flex-direction: column; gap: 14px;">'
            f'<div style="display: flex; justify-content: center;"><div style="width: 36px; height: 5px; border-radius: 3px; background: {t["border"]};"></div></div>'
            f'<div style="display: flex; align-items: center; justify-content: space-between;">'
            f'<span style="font-size: 17px; color: {t["accent"]};">Cancel</span>'
            f'<span style="font-size: 17px; font-weight: 600; color: {t["text"]};">New task</span>'
            f'<span style="font-size: 17px; font-weight: 600; color: {t["muted"]};">Add</span></div>'
            f'<div style="background: {t["editorBg"]}; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; gap: 10px;">'
            f'<div style="font-size: 15px; line-height: 24px; display: flex; align-items: center; height: 24px;">{todo_box("todo", t)}</div>'
            f'<span style="font-family: {MONO}; font-size: 15px; line-height: 24px; color: {t["muted"]}; flex: 1 1 auto;">What needs doing?</span>'
            f'<span style="width: 2px; height: 18px; background: {t["accent"]}; border-radius: 1px; margin-left: -6px;"></span></div>'
            f'<div style="background: {t["editorBg"]}; border-radius: 10px; display: flex; flex-direction: column;">'
            f'<div style="min-height: 48px; padding: 8px 16px; display: flex; align-items: center; gap: 12px;">'
            f'<div style="flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 17px; color: {t["text"]};">Add to</div>'
            f'<div style="font-size: 13px; line-height: 16px; color: {t["muted"]};">after its last to-do</div></div>'
            f'<span style="font-size: 17px; color: {t["muted"]};">Launch checklist</span>{icon("chevron-right", 18, t["border"], 2.4)}</div></div>'
            f'<div style="font-size: 13px; line-height: 18px; color: {t["muted"]}; padding: 0 4px;">Saved to the note as a <span style="font-family: {MONO};">/TODO</span> line. Your Mac sees it on the next sync.</div>'
            f'</div>')

# =============================================================================
# 5. Editor — the note, exactly as the Mac paints it
# =============================================================================
def editor(t, dark=False, variant="launch"):
    h = head(t)
    h += phone_open(t, bg=t["editorBg"])
    h += inline_nav(t, "Welcome to Parker" if variant == "welcome" else "Launch checklist", "Notes", right=icon("ellipsis", 24, t["accent"], 1.8))
    fs, lh = 15, 24  # 15px / 1.6 — the Mac runs 14px / 1.6
    def line(inner, bg="", pad_left=0, color=None):
        color = color or t["editorFg"]
        style = f'font-family: {MONO}; font-size: {fs}px; line-height: {lh}px; color: {color}; white-space: pre; padding: 0 12px 0 {12 + pad_left}px; display: flex; align-items: center; gap: 0;'
        if bg:
            style += f' background: {bg};'
        return f'<div style="{style}">{inner}</div>'
    def todo_line(kind, text, bg="", nested=None):
        color = t["editorFg"] if kind == "todo" else (t["muted"] if kind == "cancel" else t[kind])
        box = f'<span style="display: inline-flex; align-items: center; height: {lh}px; margin: 0 5px 0 3px; font-size: {fs}px;">{todo_box(kind, t)}</span>'
        return line(f'{box}<span style="color: {color};">{text}</span>', bg=bg, color=color)
    amber = "rgba(217,119,6,0.13)" if not dark else "rgba(251,191,36,0.13)"
    lines = [
        line(f'<span style="color: {t["heading"]}; font-weight: 700;"># Launch checklist</span>'),
        line('&nbsp;'),
        line(f'Ship v0.1 by <span style="color: {t["bold"]}; font-weight: 700;">**Friday**</span>. Remaining:'),
        line('&nbsp;'),
        todo_line("doing", "Write the release notes"),
        line(f'<span style="display: inline-flex; align-items: center; height: {lh}px; margin: 0 5px 0 3px; padding-left: 2ch; font-size: {fs}px;">{todo_box("done", t)}</span><span style="color: {t["done"]};">Draft the highlights</span>', color=t["done"]),
        line(f'<span style="display: inline-flex; align-items: center; height: {lh}px; margin: 0 5px 0 3px; padding-left: 2ch; font-size: {fs}px;">{todo_box("todo", t)}</span><span>Link the changelog</span>'),
        line(f'<span style="color: {t["list"]};">  -</span><span style="color: {t["doing"]}; filter: brightness(0.82);"> keep it under ten lines</span>'),
        todo_line("attn", "Ask Ana about the icon", bg=amber),
        line(f'<span style="color: {t["list"]};">  -</span><span style="color: {t["attn"]}; filter: brightness(0.82);"> she sent two options, pick one</span>', bg=amber),
        todo_line("wait", "App review"),
        todo_line("todo", "Record the demo video", bg=t["currentLine"]),
        todo_line("done", "Set up TestFlight"),
        todo_line("done", "Buy the domain"),
        todo_line("cancel", "Print a launch poster"),
        line('&nbsp;'),
        line(f'Call notes: see <span style="color: {t["link"]}; text-decoration: underline;">[roadmap](roadmap.md)</span>'),
        line(f'Milestone <span style="color: {t["inlineCode"]};">`v0.1`</span>. <span style="color: {t["italic"]}; font-style: italic;">*Keep it small.*</span>'),
    ]
    if variant == "welcome":
        lines = [
            line(f'<span style="color: {t["heading"]}; font-weight: 700;"># Welcome to Parker</span>'),
            line('&nbsp;'),
            line('Notes are plain files in your folder.'),
            line('Nothing to sync, nothing to sign in to.'),
            line('&nbsp;'),
            line('Tasks are lines that start with a tag:'),
            line('&nbsp;'),
            todo_line("todo", "Tap the box to move this along"),
            todo_line("doing", "Tap again to keep it going"),
            todo_line("done", "That is the whole system"),
            line('&nbsp;'),
            line('Nested lines belong to the task above.'),
            todo_line("todo", "Like this one"),
            line(f'<span style="color: {t["list"]};">  -</span> and this note under it'),
            line('&nbsp;'),
            line(f'Headings, <span style="color: {t["bold"]}; font-weight: 700;">**bold**</span> and <span style="color: {t["inlineCode"]};">`code`</span> work too.'),
            line('&nbsp;'),
            line(f'On a Mac? Get Parker at <span style="color: {t["link"]}; text-decoration: underline;">getparker.dev</span>'),
            line('It opens this same folder.'),
        ]
        lines[12] = lines[12].replace('padding: 0 12px 0 12px;', 'padding: 0 12px 0 12px; padding-left: calc(12px + 2ch);')
    # caret on the current line: drawn as a 2px bar after the text of that line
    if variant == "launch":
      lines[11] = lines[11].replace('Record the demo video</span>', f'Record the demo video</span><span style="width: 2px; height: 18px; background: {t["accent"]}; border-radius: 1px; margin-left: 1px;"></span>')
    h += f'<div style="flex: 1 1 auto; overflow: hidden; padding: 12px 0 0 0; display: flex; flex-direction: column;">{"".join(lines)}</div>'
    # keyboard accessory bar — rides on top of the system keyboard on a real phone
    def key(inner, w=44):
        return (f'<div style="width: {w}px; height: 36px; border-radius: 8px; background: {t["editorBg"]}; border: 1px solid {t["border"]}; '
                f'display: flex; align-items: center; justify-content: center; color: {t["text"]}; font-family: {MONO}; font-size: 16px; font-weight: 500;">{inner}</div>')
    cycle_key = f'<span style="font-size: 18px; display: inline-flex;">{todo_box("done", t, size="18px")}</span>'
    h += (f'<div style="flex: 0 0 auto; height: 48px; background: {t["headerBg"]}; border-top: 1px solid {t["border"]}; padding: 0 8px; display: flex; align-items: center; gap: 6px;">'
          f'{key(cycle_key, 52)}'
          f'{key("/TODO", 72)}{key("#")}{key("-")}{key(icon("outdent", 20, t["text"], 1.9))}{key(icon("indent", 20, t["text"], 1.9))}'
          f'<div style="flex: 1 1 auto;"></div>{key(icon("keyboard-down", 20, t["secondary"], 1.9))}</div>')
    h += '</div>' + TAIL
    return h

# =============================================================================
# 6. Settings — folder, themes, editor
# =============================================================================
def settings(t):
    h = head(t)
    h += phone_open(t)
    h += inline_nav(t, "Settings", "Notes", right=f'<span style="font-size: 17px; font-weight: 600; color: {t["accent"]};">Done</span>')
    def row(label, value="", trailing=None, sub=""):
        val = f'<span style="font-size: 17px; color: {t["muted"]};">{value}</span>' if value else ''
        tr = trailing if trailing is not None else icon("chevron-right", 18, t["border"], 2.4)
        subl = f'<div style="font-size: 13px; line-height: 16px; color: {t["muted"]};">{sub}</div>' if sub else ''
        return (f'<div style="min-height: 48px; padding: 10px 16px; display: flex; align-items: center; gap: 12px;">'
                f'<div style="flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px;"><div style="font-size: 17px; color: {t["text"]};">{label}</div>{subl}</div>{val}{tr}</div>')
    def toggle(on):
        bg = t["accent"] if on else t["border"]
        knob_x = 22 if on else 2
        return f'<div style="width: 51px; height: 31px; border-radius: 16px; background: {bg}; position: relative; flex: 0 0 auto;"><div style="position: absolute; top: 2px; left: {knob_x}px; width: 27px; height: 27px; border-radius: 14px; background: #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div></div>'
    def theme_row(label, bg, accent, fg, selected=False):
        sw = (f'<div style="width: 34px; height: 24px; border-radius: 6px; background: {bg}; border: 1px solid {t["border"]}; display: flex; align-items: center; justify-content: center; gap: 3px; flex: 0 0 auto;">'
              f'<span style="width: 10px; height: 3px; border-radius: 2px; background: {fg};"></span><span style="width: 6px; height: 6px; border-radius: 3px; background: {accent};"></span></div>')
        chk = icon("check", 20, t["accent"], 2.4) if selected else '<span style="width: 20px;"></span>'
        return (f'<div style="min-height: 44px; padding: 8px 16px; display: flex; align-items: center; gap: 12px;">{sw}'
                f'<span style="font-size: 17px; color: {t["text"]}; flex: 1 1 auto;">{label}</span>{chk}</div>')
    h += f'<div style="flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; gap: 20px; padding-top: 18px;">'
    h += group(t, [row("iCloud Drive › Parker", sub="42 notes · last change 2 minutes ago", trailing=f'<span style="font-size: 17px; color: {t["accent"]};">Change</span>')],
               header="Notes folder", footer="Parker only reads and writes this folder. Move it on your Mac and pick it again here.")
    h += group(t, [
        row("Match system appearance", trailing=toggle(True), sub="Vercel Day in light, Vercel Night in dark"),
    ], header="Appearance")
    h += group(t, [
        theme_row("Vercel Day", "#ffffff", "#059669", "#18181b", selected=True),
        theme_row("Vercel Night", "#000000", "#10b981", "#f4f4f5"),
        theme_row("GitHub Light", "#ffffff", "#0969da", "#24292f"),
        theme_row("GitHub Dark", "#0d1117", "#2f81f7", "#e6edf3"),
        theme_row("Playa", "#f5efe4", "#c2410c", "#3a2e22"),
        theme_row("Playa at Night", "#1b1612", "#f59e0b", "#e8dcc8"),
        theme_row("Matrix", "#000000", "#22c55e", "#4ade80"),
        theme_row("Blueprint", "#0b2a5b", "#38bdf8", "#dbeafe"),
    ], header="Themes · the same eight as the Mac")
    h += f'<div style="flex: 0 0 auto; padding: 0 32px; font-size: 13px; line-height: 18px; color: {t["muted"]};">Parker for iPhone 1.0 · free and open source · getparker.dev</div>'
    h += '</div>'
    h += '</div>' + TAIL
    return h

# =============================================================================
if __name__ == "__main__":
    write("FlowMap.dc.html", flowmap(DAY))
    write("Main.dc.html", search(DAY))
    write("Onboarding.dc.html", onboarding(DAY))
    write("FreshStart.dc.html", fresh_start(DAY))
    write("WelcomeNote.dc.html", editor(DAY, variant="welcome"))
    write("OnboardingHelp.dc.html", onboarding(DAY, with_help=True))
    write("Notes.dc.html", notes(DAY))
    write("Tasks.dc.html", tasks_by_note(DAY))
    write("TasksByState.dc.html", tasks_by_state(DAY))
    write("TasksAdd.dc.html", tasks_by_note(DAY, with_add=True))
    write("Editor.dc.html", editor(DAY))
    write("EditorNight.dc.html", editor(NIGHT, dark=True))
    write("Settings.dc.html", settings(DAY))

    GAP, ROW = 220, 150          # wide gaps: the connector notes sit between screens
    TOP = FH + 200               # rows start under the flow map
    def pos(col, row):
        return {"x": col * (W + GAP), "y": TOP + row * (H + ROW), "w": W, "h": H}
    def between(id_, col, row, text):
        """A connector note in the gap after column `col` of row `row`."""
        return {"id": id_, "x": col * (W + GAP) + W + 30, "y": TOP + row * (H + ROW) + 300, "w": GAP - 60, "text": text}
    def rowlabel(id_, row, text):
        return {"id": id_, "x": -330, "y": TOP + row * (H + ROW), "w": 280, "text": text}
    canvas = {
        "artboards": [
            {"file": "FlowMap.dc.html", "title": "0 · Flow map", "x": 0, "y": 0, "w": FW, "h": FH},
            # row 0 — first run, Start fresh
            {"file": "Onboarding.dc.html", "title": "1 · Onboarding", **pos(0, 0)},
            {"file": "FreshStart.dc.html", "title": "1c · After Start fresh", **pos(1, 0)},
            {"file": "WelcomeNote.dc.html", "title": "1d · Welcome note", **pos(2, 0)},
            # row 1 — first run, I already have notes
            {"file": "OnboardingHelp.dc.html", "title": "1b · Where is my folder?", **pos(0, 1)},
            {"file": "Main.dc.html", "title": "2 · Search (home)", **pos(1, 1)},
            {"file": "Notes.dc.html", "title": "3 · Notes", **pos(2, 1)},
            # row 2 — the note
            {"file": "Editor.dc.html", "title": "5 · Note · Vercel Day", **pos(0, 2)},
            {"file": "EditorNight.dc.html", "title": "5b · Note · Vercel Night", **pos(1, 2)},
            {"file": "Settings.dc.html", "title": "6 · Settings", **pos(2, 2)},
            # row 3 — tasks
            {"file": "Tasks.dc.html", "title": "4 · Tasks · by note", **pos(0, 3)},
            {"file": "TasksByState.dc.html", "title": "4b · Tasks · by state", **pos(1, 3)},
            {"file": "TasksAdd.dc.html", "title": "4c · New task", **pos(2, 3)},
        ],
        "annotations": [
            {"id": "principle", "x": FW + 60, "y": 0, "w": 420,
             "text": "Inside the note is Parker; around the note is iOS.\n\nContent uses Parker's real tokens: Geist Mono, Vercel Day/Night, the to-do state colors and the Lucide glyphs from todo-glyph.ts. The shell is stock iOS: large titles, a native search field, tab bar, grouped lists, swipe actions, sheets.\n\nThe status bar and keyboard are not drawn: the real ones render on top."},
            rowlabel("row-fresh", 0, "FIRST RUN · Start fresh\n\nNo Mac, no notes yet. The app owns a folder in the user's iCloud Drive (like Pages does). It shows up in Files and on every Mac with the same account, born with one note that teaches by tapping.\n\nThis is the App Store → iPhone → Mac funnel."),
            between("go-fresh", 0, 0, "Tap Start fresh\n\nFolder created: iCloud Drive › Parker. No picker, no account."),
            between("go-welcome", 1, 0, "Tap Welcome to Parker\n\nThree boxes to tap, one nested task, the Mac link at the end."),
            rowlabel("row-existing", 1, "FIRST RUN · I already have notes\n\nTap the second card and the Files picker opens. Where is my folder? (the link under the cards) opens this sheet for the Mac cases, then Open Files.\n\nAfter picking, the app lands on Search with a one-time line: 42 notes found."),
            between("go-picker", 0, 1, "Open Files → system picker → pick the folder\n\nLands on Search, with the confirmation line."),
            between("go-notes", 1, 1, "Tab bar · Notes\n\nSearch, Notes and Tasks are the three tabs. Any of them opens a note."),
            rowlabel("row-note", 2, "THE NOTE\n\nReached from a search result, a Notes row, or a task's text. Same content as the Mac in every theme; the frame is iOS. Gear (top left of Notes) opens Settings."),
            between("go-night", 0, 2, "Same note in Vercel Night\n\nThemes are data: the eight from the Mac, via shared JSON."),
            between("go-settings", 1, 2, "Gear → Settings\n\nFolder, appearance, the eight themes."),
            rowlabel("row-tasks", 3, "TASKS\n\nTwo views on the same lines. By note: sections per note, document order, nested lines and nested to-dos under their task. By state: sections in the ⌘⏎ order, note name (or path) above each task, chips filter by note.\n\nTap the box to cycle; long-press to pick; tap the text to open the note at that line."),
            between("go-state", 0, 3, "Segmented control → By state\n\nA nested to-do is listed under its OWN state, with its path above it."),
            between("go-add", 1, 3, "Tap + in the bar\n\nText plus target note (remembers the last). Saved as a /TODO line after the note's last to-do. No inbox."),
        ],
        "launch": {"view": "canvas"},
    }
    with open(os.path.join(OUT, "canvas.json"), "w") as f:
        json.dump(canvas, f, indent=2)
    print("wrote canvas.json")
