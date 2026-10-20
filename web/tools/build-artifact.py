"""Builds artifact.html (the embeddable demo page) from index.html.
The Artifact host supplies <html>/<head>/<body>, so only the inner parts are kept."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')
part = lambda name: re.search(rf'<!-- {name}:START -->(.*?)<!-- {name}:END -->', src, re.S).group(1).strip()
out = '\n'.join([
    '<title>My Hub</title>',
    '<meta name="claude:viewport-fit-sides" content="cover">',
    '<meta name="theme-color" content="#ffffff">',
    part('HEAD'),
    part('BODY'),
])
(root / 'artifact.html').write_text(out + '\n', encoding='utf-8')
print('wrote', root / 'artifact.html')
