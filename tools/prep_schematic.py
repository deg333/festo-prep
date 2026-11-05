#!/usr/bin/env python3
"""Turn assets/air-prep-schem.svg (hand-drawn CAD schematic) into an animatable fragment:
 - duplicate elements removed
 - valve position blocks wrapped in <g id="stLock|stCip|stSv"> so they can slide up/down
 - pneumatic lines tagged data-p="F|A|P" (supply / after on-off valve / after safety valve) so they can be coloured
Writes assets/air-prep-schem.frag.svg (inner SVG markup)."""
import re, sys, pathlib
import xml.etree.ElementTree as ET
root = pathlib.Path(__file__).resolve().parent.parent
tree = ET.parse(root / 'assets' / 'air-prep-schem.svg'); svg = tree.getroot()
NS = '{http://www.w3.org/2000/svg}'
def nums(d): return [float(x) for x in re.findall(r'-?\d+\.?\d*', d)]
def bbox(el):
    if el.tag == NS + 'path':
        n = nums(el.get('d')); xs, ys = n[0::2], n[1::2]; return min(xs), max(xs), min(ys), max(ys)
    if el.tag == NS + 'circle':
        x, y, r = float(el.get('cx')), float(el.get('cy')), float(el.get('r')); return x - r, x + r, y - r, y + r
    if el.tag == NS + 'rect':
        x, y, w, h = [float(el.get(k)) for k in 'x y width height'.split()]; return x, x + w, y, y + h
def norm(d): return re.sub(r'\s+', '', d)
# pneumatic lines by exact path data -> pressure zone
ZONE = {
 'F': ['M117.5,117.741L20.75,117.741', 'M188,117.741L148.75,117.741', 'M232.25,117.741L266.75,117.741', 'M266.75,117.741L329.25,117.741', 'M388,117.741L329.25,117.741', 'M329.25,117.741L395.25,117.741', 'M395.75,117.741L388,117.741'],
 'A': ['M438.75,117.741L427,117.741', 'M438.75,117.741L493.5,117.741', 'M493.5,117.741L548.25,117.741', 'M607,117.741L548.25,117.741', 'M614.75,117.741L607,117.741', 'M476,217.491L476,117.741', 'M476,233.241L476,117.741'],
 'P': ['M677.5,117.741L646.25,117.741', 'M677.5,117.741L712.75,117.741', 'M712.75,117.741L746,117.741', 'M695,117.741L695,233.241', 'M645.25,133.241L677.5,133.241L677.5,117.741', 'M677.5,109.241L677.5,117.741'],
}
zone_of = {norm(d): z for z, ds in ZONE.items() for d in ds}
def pilot_piece(el):   # little dashes of the pilot feedback line (y=14.741 or x=677.5 above the node)
    if el.tag != NS + 'path': return False
    x0, x1, y0, y1 = bbox(el)
    return (abs(y0 - 14.741) < .01 and abs(y1 - 14.741) < .01 and x0 > 628) or (abs(x0 - 677.5) < .01 and abs(x1 - 677.5) < .01 and y1 < 117.7) or (el.get('d').startswith('M669.5,14.741'))
FIXED_SV = {'M614.75,117.741L607,117.741'}
seen = set(); out = []; stacks = {'lock': [], 'cip': [], 'sv': []}
def style(el): return el.get('style') or ''
def emit(el, extra=''):
    t = el.tag.replace(NS, ''); a = ' '.join(f'{k}="{v}"' for k, v in el.attrib.items() if k in ('d', 'style', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height'))
    a = a.replace('stroke-width:0.5px', 'stroke-width:0.9px').replace('stroke-width:0.48px', 'stroke-width:0.8px')
    return f'<{t} {a}{extra}/>'
def walk(el, gid=None, path=()):
    for ch in el:
        if ch.tag == NS + 'g':
            walk(ch, ch.get('id') or gid, path + (ch.get('id') or '',))
        elif ch.tag in (NS + 'path', NS + 'circle', NS + 'rect'):
            key = (ch.tag, tuple(sorted(ch.attrib.items())), gid)
            if key in seen: continue
            seen.add(key)
            d = norm(ch.get('d') or '')
            ctx = gid or ''
            k = None
            if ctx == 'manual-on-off':
                x0, x1, y0, y1 = bbox(ch)
                if x0 >= 117.4 and x1 > 117.6: k = 'lock'
            elif ctx == 'VALVE-ON/OFF' or ctx == 'VALVE-ON-OFF': k = 'cip'
            elif ctx == 'VALVE-SAFTEY' and d not in FIXED_SV:
                x0, x1, y0, y1 = bbox(ch)
                if not (x0 >= 646 and y0 >= 141.2): k = 'sv'      # the G / FS box hangs off the stack but does not slide
            if k: stacks[k].append(emit(ch)); continue
            z = zone_of.get(d)
            if z: out.append(emit(ch, f' data-p="{z}" class="pp"')); continue
            if d == norm('M622.75,20.991L622.75,14.741L630.5,14.741'): out.append(emit(ch, ' id="pilotA" class="pil"')); continue
            if pilot_piece(ch): out.append(emit(ch, ' class="pil"')); continue
            if d == norm('M388,133.491L354,133.491L354,231.614'): out.append(emit(ch, ' id="eCip"')); continue
            if d == norm('M606.928,133.491L572.928,133.491L572.928,231.614'): out.append(emit(ch, ' id="eSv"')); continue
            out.append(emit(ch))
walk(svg)
# highlight rects (inside the stacks so they slide with the boxes)
W = 31.25
hl = {
 'lock': [('lkA', 117.5, 109.991), ('lkB', 117.5, 141.241)],           # upper = closed/exhaust, lower = open
 'cip':  [('cE', 395.75, 78.741), ('cS', 395.75, 109.991)],            # upper = energised, lower = spring
 'sv':   [('svV', 614.75, 47.491), ('svF', 614.75, 78.741), ('svR', 614.75, 109.991)],
}
LED = {   # coil LEDs travel with the stack they belong to: green = 24 V good, yellow = coil energised
 'cip': [('svgCipG', 399, 35), ('svgCipY', 404.5, 35)],
 'sv': [('svgV1G', 586.5, 35), ('svgV1Y', 592.5, 35), ('svgV2G', 598.5, 35), ('svgV2Y', 604.5, 35)],
}
frag = []
frag += out
for k, gid in (('lock', 'stLock'), ('cip', 'stCip'), ('sv', 'stSv')):
    frag.append(f'<g id="{gid}">' + ''.join(f'<rect id="{i}" class="hl" x="{x}" y="{y}" width="{W}" height="{W}"/>' for i, x, y in hl[k]) + ''.join(stacks[k]) + ''.join(f'<circle id="{i}" class="ld" cx="{x}" cy="{y}" r="2.3"/>' for i, x, y in LED.get(k, [])) + '</g>')
(root / 'assets' / 'air-prep-schem.frag.svg').write_text('\n'.join(frag), encoding='utf8')
print({k: len(v) for k, v in stacks.items()}, 'fixed', len(out))

T = lambda x, y, t, size=9, anchor='middle', extra='': f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}"{extra}>{t}</text>'
labels = [
 T(411, -28, 'MAIN PNEUMATIC SOLENOID', 11), T(411, -15, 'V2S1', 11),
 T(630, -28, 'MAIN PNEUMATIC SAFETY SOLENOID (PLd)', 11), T(630, -15, 'V1S1 &amp; V1S2', 11),
 T(133, 22, '919127A'), T(62, 111, '3/4&quot;'), T(133, 32, 'SUPPLY LOCK-OUT (click)', 6.5),
 T(210, 153, '919111C'), T(210, 163, 'REPLACEMENT FILTER:'), T(210, 173, '919111P'),
 T(411, 211, '919111B'), T(630, 211, '919111A'),
]
for cx in (476, 695):
    v = 'V2A1' if cx == 476 else 'V1A1'
    labels += [T(cx, 278, '919111R'), T(cx, 288, 'MAIN PNEUMATIC'), T(cx, 298, 'PRESSURE'), T(cx, 308, v)]
(root / 'assets' / 'air-prep-schem.labels.svg').write_text('\n'.join(labels), encoding='utf8')
