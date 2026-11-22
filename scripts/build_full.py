"""Monta a base completa do ES: lê a Tabela de Natureza da Despesa TCE-ES 2027, alinha cada subelemento
com os trechos da Portaria 448 e com as contas do PCASP, e gera palavras-chave, ementas e exemplos."""
import json, re, unicodedata
import openpyxl

TCE = '/mnt/user-data/uploads/af73bcee-TABELA-NATUREZA-DA-DESPESA-TCEES-2027_ConsultaPublica2.xlsx'
chunks = json.load(open('/home/claude/kb/p448_chunks.json'))
pcasp = {p['conta']: p for p in json.load(open('/home/claude/kb/pcasp_material.json'))}
old = json.load(open('/home/claude/kb/base_classificacao.json'))  # 3.3.90.30 (federal codes == TCE codes) and 52 with 448 text

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9 ]', ' ', s)

STOP = set('para com das dos que de da do e em os as no na ou por tais como registra valor despesas despesa servicos servico outros outras outra geral afins'.split())
def toks(s):
    return {w[:6] for w in norm(s).split() if len(w) > 3 and w not in STOP}

def sim(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb: return 0.0
    return len(ta & tb) / len(ta)

def align(titles, texts, head=220):
    """monotonic alignment of TCE titles (code order) to 448 chunks (doc order)."""
    n, m = len(titles), len(texts)
    S = [[sim(titles[i], texts[j][:head]) for j in range(m)] for i in range(n)]
    INF = -1e9
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    bk = [[None] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        for j in range(m + 1):
            if i == 0 and j == 0: continue
            best, arg = INF, None
            if i > 0 and dp[i-1][j] > best: best, arg = dp[i-1][j], 'skipT'
            if j > 0 and dp[i][j-1] > best: best, arg = dp[i][j-1], 'skipC'
            if i > 0 and j > 0:
                v = dp[i-1][j-1] + (S[i-1][j-1] if S[i-1][j-1] >= 0.34 else -5)
                if v > best: best, arg = v, 'match'
            dp[i][j], bk[i][j] = best, arg
    res = {}
    i, j = n, m
    while i > 0 or j > 0:
        a = bk[i][j]
        if a == 'match': res[i-1] = (j-1, S[i-1][j-1]); i -= 1; j -= 1
        elif a == 'skipT': i -= 1
        else: j -= 1
    return res

def split_ex(txt):
    m = re.search(r'tais como[:.,]?\s*(.*)$', txt)
    if m: return txt[:m.start()].strip(' ,:'), m.group(1).strip()
    return txt, ''

# ---------- TCE rows ----------
wb = openpyxl.load_workbook(TCE, read_only=True)
raw = [r for r in wb['ND 2027'].iter_rows(min_row=8, values_only=True) if r[0] is not None]
SCOPE = {(3, 3): {30, 31, 32, 33, 35, 36, 37, 38, 39, 40}, (4, 4): {30, 35, 36, 39, 40, 51, 52, 61}, (4, 5): {61}}
tce = []
for r in raw:
    c, g, mod, e, s = r[:5]
    if mod != 90 or e not in SCOPE.get((c, g), set()) or s in (0, None):
        continue
    tce.append(dict(cat=c, grp=g, el=e, sub=s, codigo=f'{c}.{g}.90.{e:02d}.{s:02d}',
                    titulo=re.sub(r'\s+', ' ', str(r[5])).strip(),
                    incl=bool(r[8] and str(r[8]).strip()), excl=bool(r[9] and str(r[9]).strip()),
                    alt=bool(r[10] and str(r[10]).strip()), ente=(r[7] or '').strip()))
elnames = {int(r[0]): r[1].strip() for r in wb['Elemento de Despesa'].iter_rows(min_row=2, values_only=True) if r[0] is not None and str(r[0]).strip().isdigit()}

# ---------- descriptions ----------
desc = {}  # codigo -> dict(descricao, exemplos_448, exemplos_pcasp, conta, fonte)
# 3.3.90.30: TCE numbering equals federal numbering used in old base
old30 = {r['subelemento']: r for r in old if r['natureza'] == '3.3.90.30'}
for t in tce:
    if (t['cat'], t['grp'], t['el']) == (3, 3, 30):
        k = f"{t['sub']:02d}"
        src = old30.get({'61': '07', '62': '23'}.get(k, k))
        if src:
            desc[t['codigo']] = dict(descricao=src['descricao_448'], ex448=src['exemplos_448'], expcasp=src['exemplos_pcasp'],
                                     conta=' | '.join(x for x in [src['conta_vpd'], src['conta_estoque_ou_ativo']] if x),
                                     fonte='Portaria 448 + PCASP 2027' + (' (herdado do subelemento ' + {'61': '07', '62': '23'}[k] + ')' if k in ('61', '62') else ''))
        else:
            vp = pcasp.get(f'3.3.1.1.1.{k}.00')
            if vp:
                f = vp['funcao']; ex = ''
                if ' - ' in f:
                    i = f.find(' - '); s0 = f.rfind('. ', 0, i); ex = f[s0+2:] if s0 > 0 else ''
                desc[t['codigo']] = dict(descricao=f, ex448='', expcasp=ex, conta=vp['conta'], fonte='PCASP 2027')

# 4.4.90.52: align TCE titles with 448 Anexo IV (titles known from old base)
old52 = [r for r in old if r['natureza'] == '4.4.90.52']
tce52 = [t for t in tce if (t['cat'], t['grp'], t['el']) == (4, 4, 52)]
for t in tce52:
    best, bs = None, 0
    tt = t['titulo']
    if 'TELEFONIA' in tt:
        best = next(r for r in old52 if r['subelemento'] == '06'); bs = 1
    elif 'EQUIPAMENTOS DE TIC' in tt:
        best = next(r for r in old52 if r['subelemento'] == '35'); bs = 1
    elif 'ACESSÓRIOS PARA VEÍCULOS' in tt:
        best = next(r for r in old52 if r['subelemento'] == '57'); bs = 1
    else:
        for r in old52:
            s_ = (sim(tt, r['titulo']) + sim(r['titulo'], tt)) / 2
            if s_ > bs: best, bs = r, s_
    if best and bs >= 0.5:
        conta = best['conta_estoque_ou_ativo']
        if 'SERVIDORES' in tt or 'ATIVOS DE REDE' in tt: conta = '1.2.3.1.1.02.01'
        elif 'COMPUTADORES' in tt or 'IMPRESSORAS' in tt: conta = '1.2.3.1.1.02.02'
        elif 'TELEFONIA' in tt: conta = '1.2.3.1.1.01.02'
        desc[t['codigo']] = dict(descricao=best['descricao_448'], ex448=best['exemplos_448'], expcasp='', conta=conta,
                                 fonte=f"Portaria 448 (Anexo IV – {best['titulo']})")

# 3.3.90.36 / 3.3.90.39: manual map TCE subelemento -> chunk index of Portaria 448 Anexo II/III
MAP36 = {1:0,2:1,3:2,4:3,5:4,6:5,7:6,9:8,11:9,12:10,13:11,14:12,15:13,16:14,18:15,20:16,21:17,22:18,23:19,24:20,25:21,26:22,27:23,28:24,30:25,31:26,32:27,33:30,34:28,35:29,36:31,37:32,38:33,39:34,40:35,41:36,42:37,43:38,45:39,46:40,49:42,50:41,99:44}
MAP39 = {1:0,2:1,3:2,4:3,5:4,6:5,7:6,8:7,9:8,10:9,11:10,12:11,14:12,16:13,17:14,19:15,20:16,21:17,22:18,23:19,27:20,28:21,29:22,30:23,31:24,33:26,60:25,34:27,43:28,44:29,37:30,38:31,47:32,40:33,41:34,50:35,35:36,36:37,53:38,54:39,64:40,49:41,42:42,51:43,52:44,45:45,46:46,55:47,65:48,57:49,58:50,59:51,61:52,70:53,63:54,72:55,56:56,67:58,77:59,78:60,62:61,71:62,48:63,74:64,75:65,68:66,90:67,79:68,84:69,86:70,88:72,99:73}
for el, nat, mp in ((36, '339036', MAP36), (39, '339039', MAP39)):
    for t in tce:
        if (t['cat'], t['grp'], t['el']) == (3, 3, el) and t['sub'] in mp:
            d, ex = split_ex(chunks[nat][mp[t['sub']]])
            desc[t['codigo']] = dict(descricao=d, ex448=ex, expcasp='', conta='',
                                     fonte=f'Portaria 448 (Anexo {"II" if el == 36 else "III"})')

# 4.4.90.xx and others: borrow 3.3.90 description of same element and same normalized title
by_title = {}
for t in tce:
    if t['codigo'] in desc and t['cat'] == 3:
        by_title.setdefault((t['el'], norm(t['titulo']).strip()), t['codigo'])
for t in tce:
    if t['codigo'] in desc: continue
    k = (t['el'], norm(t['titulo']).strip())
    src = by_title.get(k)
    if not src and t['el'] == 30:  # 4.4.90.30 titles differ slightly
        cands = [(sim(t['titulo'], x['titulo']), x) for x in tce if (x['cat'], x['el']) == (3, 30) and x['codigo'] in desc]
        s_, x = max(cands, key=lambda z: z[0])
        if s_ >= 0.6: src = x['codigo']
    if src:
        d = dict(desc[src]); d['fonte'] = f'Herdado de {src}'
        desc[t['codigo']] = d

MAP4430 = {9: '09', 14: '24', 25: '54', 26: '99', 22: '26', 15: '26'}
for t in tce:
    if (t['cat'], t['grp'], t['el']) == (4, 4, 30) and t['sub'] in MAP4430 and t['codigo'] not in desc:
        src = f"3.3.90.30.{MAP4430[t['sub']]}"
        if src in desc:
            d = dict(desc[src]); d['fonte'] = f'Herdado de {src}'; desc[t['codigo']] = d

# ---------- categorization ----------
def categoria(t):
    e, c = t['el'], t['cat']
    if e == 30: return 'Material de consumo' + (' (capital: obra/melhoria)' if c == 4 else '')
    if e == 52: return 'Material permanente'
    if e == 32: return 'Distribuição gratuita'
    if e == 31: return 'Premiação'
    if e == 33: return 'Passagens e locomoção'
    if e == 35: return 'Consultoria'
    if e == 36: return 'Serviço – pessoa física'
    if e == 37: return 'Locação de mão de obra'
    if e == 38: return 'Arrendamento mercantil'
    if e == 39: return 'Serviço – pessoa jurídica'
    if e == 40: return 'Serviço de TIC – PJ'
    if e == 51: return 'Obras e instalações'
    if e == 61: return 'Aquisição de imóveis'
    return ''

NAO = re.compile(r'JUROS|MULTAS|ENCARGOS FINANCEIROS|VARIA..O CAMBIAL|DESCONTOS FINANCEIROS|TRIBUTOS . CONTA|INDENIZA|OBRIGA..ES PATRONAIS|HONOR.RIOS ADVOCAT|DI.RIAS|JETONS|ESTAGI.RIOS|INTERNOS EM PENITENCI|RESID.NCIA M.DICA|BOLSA DE INICIA|PER.CIAS T.CNICAS JUSTI|OBRAS EM ANDAMENTO|IMPORTA..ES EM ANDAMENTO|IM.VEIS A REGISTRAR|ALMOXARIFADO DE OBRAS|AGENTES CREDENCIADOS|VISTOS CONSULARES')
ELDESC = json.load(open('/home/claude/kb/mcasp_elementos.json'))

out = []
for t in tce:
    d = desc.get(t['codigo'], {})
    sit = 'Incluído na consulta 2027' if t['incl'] else ('Alterado na consulta 2027' if t['alt'] else '')
    if t['excl']: sit = 'Marcado para exclusão'
    out.append(dict(codigo=t['codigo'], elemento=f"{t['el']:02d} – {elnames.get(t['el'], '').title()}",
        categoria=categoria(t), subelemento=t['titulo'],
        uso='Outros (financeiro/pessoal/contábil)' if NAO.search(t['titulo']) else 'Compra/contratação',
        descricao=d.get('descricao', ''), ex448=d.get('ex448', ''), expcasp=d.get('expcasp', ''),
        conta=d.get('conta', ''), situacao=sit, fonte=d.get('fonte', 'Só título (TCE-ES)'), ente=t['ente']))
json.dump(out, open('/home/claude/kb/base_full.json', 'w'), ensure_ascii=False, indent=1)

from collections import Counter
print(len(out), Counter(o['categoria'] for o in out))
print('com descrição:', sum(1 for o in out if o['descricao']), Counter(o['fonte'].split(' (')[0].split(' –')[0] for o in out))
for o in out:
    if o['codigo'].startswith('4.4.90.30') and not o['descricao']:
        print(o['codigo'], o['subelemento'][:45].ljust(45), '|', o['descricao'][29:110])
