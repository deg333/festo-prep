#!/usr/bin/env python3
"""Compile Tailwind CSS for tools/info.src.html and inline it -> air-prep-info.html (images load from assets/info/)."""
import pathlib, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'tools' / 'info.src.html'
with tempfile.TemporaryDirectory() as d:
    css_in = pathlib.Path(d) / 'in.css'; css_out = pathlib.Path(d) / 'out.css'
    css_in.write_text('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n')
    subprocess.run(['npx', '--yes', 'tailwindcss@3.4.17', '-i', str(css_in), '-o', str(css_out), '--content', str(src), '--minify'], check=True)
    css = css_out.read_text()
(root / 'air-prep-info.html').write_text(src.read_text().replace('/*TAILWIND*/', css), encoding='utf8')
print('wrote air-prep-info.html')
