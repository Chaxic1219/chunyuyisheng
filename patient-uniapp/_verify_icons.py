#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from PIL import Image
files = [
    'src/static/icons/v2/health-record.png',
    'src/static/icons/v2/health-assistant.png',
    'src/static/icons/v2/service-package.png',
    'dist/build/mp-weixin/static/icons/v2/health-record.png',
    'dist/build/mp-weixin/static/icons/v2/health-assistant.png',
    'dist/build/mp-weixin/static/icons/v2/service-package.png',
]
for f in files:
    im = Image.open(f).convert('RGBA')
    w, h = im.size
    bbox = im.split()[3].getbbox()
    cw = bbox[2] - bbox[0]
    ch = bbox[3] - bbox[1]
    where = 'SRC' if f.startswith('src') else 'BUILD'
    name = f.split('/')[-1]
    print('%-22s %-6s 占比 %3.0f%% x %3.0f%%  (%dx%d)' % (name, where, cw/w*100, ch/h*100, cw, ch))
