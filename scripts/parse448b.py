"""Extrai do texto da Portaria STN 448/2002 os anexos I a IV (detalhamento dos elementos 30, 36, 39 e 52)
em trechos por código. Uso: python parse448b.py portaria448.txt > p448_chunks.json"""
import re, json, sys

lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
annex_re = re.compile(r'^Anexo (I|II|III|IV) – (\d{6})')
texts = {}
cur = None
for ln in lines:
    m = annex_re.match(ln.strip())
    if m:
        cur = m.group(2); texts[cur] = []; continue
    if not cur or not ln.strip() or re.match(r'^\s*(de )?2002\.\s*$', ln):
        continue
    if not ln.startswith(' '):
        toks = ln.split()
        i = 0
        while i < len(toks) and not any(c.islower() for c in toks[i]):
            i += 1
        rest = ' '.join(toks[i:])
    else:
        rest = ln.strip()
    if rest:
        texts[cur].append(rest)

out = {}
for nat, parts in texts.items():
    full = re.sub(r'\s+', ' ', ' '.join(parts))
    chunks = re.split(r'(?=\bRegistra(?:m)?\b)', full)
    chunks = [c.strip() for c in chunks if c.strip()]
    out[nat] = chunks
    print(nat, len(chunks))
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
