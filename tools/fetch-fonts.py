#!/usr/bin/env python3
# Downloads the Google Fonts My Hub uses into web/vendor/fonts/<slug>/ (latin + latin-ext + vietnamese subsets,
# woff2) and writes one <slug>.css per family with local URLs. The app never calls Google Fonts at run time.
# Run again after adding a family to FAMILIES (and to web/js/core/fonts.js).
import os, re, sys, urllib.request

FAMILIES = {
    'jetbrains-mono': 'JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400',
    'be-vietnam-pro': 'Be+Vietnam+Pro:ital,wght@0,400;0,500;0,600;0,700;1,400',
    'literata': 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;0,7..72,700;1,7..72,400',
    'plus-jakarta-sans': 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
    'lexend': 'Lexend:wght@400;500;600;700;800',
    'inter-tight': 'Inter+Tight:wght@400;500;600;700;800',
    'fraunces': 'Fraunces:opsz,wght@9..144,500;9..144,700',
    'manrope': 'Manrope:wght@400;500;600;700',
    'lora': 'Lora:ital,wght@0,400;0,600;1,400',
    'merriweather': 'Merriweather:ital,wght@0,400;0,700;1,400',
    'noto-serif': 'Noto+Serif:ital,wght@0,400;0,600;1,400',
    'ibm-plex-mono': 'IBM+Plex+Mono:ital,wght@0,400;0,600;1,400',
    'atkinson-hyperlegible': 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400',
}
KEEP = {'latin', 'latin-ext', 'vietnamese'}
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'vendor', 'fonts')

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()

for slug, spec in FAMILIES.items():
    css = get(f'https://fonts.googleapis.com/css2?family={spec}&display=swap').decode()
    d = os.path.join(OUT, slug); os.makedirs(d, exist_ok=True)
    out, n, byurl = [], 0, {}
    for subset, block in re.findall(r'/\* ([\w-]+) \*/\s*(@font-face \{.*?\})', css, re.S):
        if subset not in KEEP: continue
        url = re.search(r'url\((https://[^)]+)\)', block).group(1)
        style = re.search(r'font-style: (\w+)', block).group(1)
        weight = re.search(r'font-weight: ([\d ]+)', block).group(1).replace(' ', '-')
        # A variable family serves one file for every weight: download each URL once.
        name = byurl.setdefault(url, f'{slug}-{subset}-{style}-{weight}.woff2')
        path = os.path.join(d, name)
        if not os.path.exists(path):
            open(path, 'wb').write(get(url)); n += 1
        out.append(f'/* {subset} */\n' + block.replace(url, f'{slug}/{name}'))
    open(os.path.join(OUT, slug + '.css'), 'w').write('\n'.join(out) + '\n')
    print(slug, len(out), 'faces,', n, 'downloaded', file=sys.stderr)
