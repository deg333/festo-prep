#!/usr/bin/env python3
"""Inline src/ + vendor/three.min.js into one self-contained festo-air-prep-sim.html"""
import pathlib
r = pathlib.Path(__file__).parent
rd = lambda p: (r / p).read_text(encoding='utf8')
html = rd('src/index.html')
for key, path in [('/*STYLE*/', 'src/style.css'), ('/*THREE*/', 'vendor/three.min.js'), ('/*SIM*/', 'src/sim.js'),
                  ('/*VIEW3D*/', 'src/view3d.js'), ('/*UI*/', 'src/ui.js')]:
    html = html.replace(key, rd(path).replace('</script', '<\\/script'))
(r / 'festo-air-prep-sim.html').write_text(html, encoding='utf8')
print('wrote festo-air-prep-sim.html', len(html) // 1024, 'KB')
