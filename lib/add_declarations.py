#!/usr/bin/env python3
path = '/home/probers1/Dev/slag3D/lib/thumbnail.ts'

with open(path, 'r') as f:
    content = f.read()

old_comment = '# @ts-ignore - puppeteer-canvas uses jsdom instead of Chrome, 2-5x faster'
replacement = "\n// Extend types for WebGL rendering mode\ndeclare module \"puppeteer\" {\n  // Type augmentation for jsdom-based WebGL rendering\n}"

content = content.replace(old_comment + ':', replacement)

with open(path, 'w') as f:
    f.write(content)

print("✓ Updated thumbnail.ts")