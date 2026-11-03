#!/usr/bin/env python3
"""Update thumbnail.ts with proper type declarations for puppeteer-canvas support."""

import re

path = '/home/probers1/Dev/slag3D/lib/thumbnail.ts'

with open(path, 'r') as f:
    content = f.read()

# Check if we need to add imports
lines_before_first_import = content.split('export interface')[0].split('\n')
first_line = lines_before_first_import[0].strip() if lines_before_first_import else ''

if 'declare module' not in content.lower() and 'import puppeteer' not in first_line:
    print("Adding type declarations...")
    
    # Find where to insert imports (before first export)
    insert_point = 0
    for i, line in enumerate(content.split('\n')):
        if line.strip().startswith('export ') and 'interface' in line:
            insert_point = i
            break
    
    new_imports = """import path from "path";
import fs from "fs";
import puppeteer, { Browser } from "puppeteer";

declare module "puppeteer" {}

"""
    
    # Insert at the calculated position
    lines = content.split('\n')
    if insert_point > 0:
        lines.insert(insert_point, new_imports.rstrip())
    
    content = '\n'.join(lines)
else:
    print("Type declarations already present or different import style")

with open(path, 'w') as f:
    f.write(content)

print(f"✓ File updated successfully ({len(content)} bytes)")
