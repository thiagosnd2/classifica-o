"""Gera o kb.json final usado pela página: subelementos ES, base federal, Tabela Auxiliar 22, siglas de
unidade, grupos de unidade, contas de almoxarifado e de bens móveis e versões das bases."""
import json, re, sys
sys.path.insert(0, '/home/claude/scripts')

TA22 = """001 Aluno|002 Ampola|003 Ano|004 Apólice|005 Balde|006 Bandeja|007 Barra|008 Bastão|009 Bisnaga|010 Blister|011 Bloco|012 Bobina|013 Boina|014 Bolsa|015 Bombona|016 Botijão|017 Caixa|018 Capsula|019 Cartela|020 Cartucho|021 Centímetro|022 Centímetro cúbico|023 Centímetro quadrado|024 Cento|025 Cesta|026 Cilindro|027 Comprimido|028 Conjunto|029 Cópia|030 Copo|031 Desconto|032 Dezena|033 Dia|034 Diária|035 Dose|036 Drágea|037 Dúzia|038 Embalagem|039 Envelope|040 Estojo|041 Etapa|042 Fardo|043 Flaconete|044 Folha|045 Frasco conta-gotas|046 Frasco ou Pote|047 Frasco spray|048 Frasco-ampola|049 Galão|050 Garrafa|051 Gigabyte|052 Grama|053 Hectare|054 Homem/ano|055 Homem/dia|056 Homem/hora|057 Homem/mês|058 Hora|059 Hora máquina|060 Hora técnica|061 Hora/aula|062 Impressão|063 Jogo|064 Kit|065 Km quadrado|066 Lâmina|067 Lata|068 Latão|069 Lauda|070 Libra|071 Litro|072 Maço|073 Mês|074 Metro|075 Metro cúbico|076 Metro linear|077 Metro quadrado|078 Milheiro|079 Miligrama|080 Mililitro|081 Minutos|082 Modulo|083 Molho|084 Pacote|085 Palete|086 Pastilha|087 Peça|088 Película|089 Pino|090 Plantão|091 Ponto instalado|092 Porção|093 Porcentagem|094 Posto|095 Posto dia|096 Posto/ano|097 Posto/mês|098 Produto|099 Quilograma|100 Quilômetro|101 Quilômetro linear|102 Quilômetro quadrado|103 Quilômetro rodado|104 Quilômetro voado|105 Quilômetro/dia|106 Quinzena|107 Rack|108 Recipiente|109 Refil|110 Reservatório|111 Resma|112 Rolo|113 Sache|114 Saco|115 Semana|116 Semestre|117 Seringa|118 Seringa ou frasco-ampola|119 Seringa preenchida|120 Serviço|121 Sessão|122 Sistema de aplicação preenchido|123 Tablete|124 Tambor|125 Teste|126 Tira|127 Tonelada|128 Trimestre|129 Tubete|130 Tubo|131 Unidade|132 Unidade de ponto de função|133 Unidade de serviço|134 Vara|135 Varão|136 Vidro|138 Decímetro cúbico|139 Verba|140 Tonelada quilômetro"""
ta22 = [dict(c=x[:3], n=x[4:]) for x in TA22.split('|')]
assert len(ta22) == 139

# siglas usuais -> código TA 22 (sugestão local; ambíguas ficam para a IA)
SIG = {'AP':'002','AMP':'002','CP':'027','COMP':'027','CPR':'027','CA':'018','CAP':'018','CAPS':'018','DRG':'036','FA':'048','FAMP':'048',
 'UN':'131','UND':'131','UNID':'131','UNI':'131','UNIDADE':'131','U':'131','CX':'017','PCT':'084','PAC':'084','KG':'099','QUILO':'099','G':'052','GR':'052',
 'MG':'079','L':'071','LT':'071','LTS':'071','ML':'080','M':'074','MT':'074','MTS':'074','M2':'077','M²':'077','M3':'075','M³':'075','ML.':'080','KM':'100',
 'RL':'112','RS':'111','RSM':'111','GL':'049','GAL':'049','SC':'114','TB':'130','TUB':'130','KIT':'064','JG':'063','JOGO':'063','CJ':'028','CONJ':'028',
 'DZ':'037','DUZ':'037','MIL':'078','MLH':'078','CT':'024','CENTO':'024','H':'058','HR':'058','HS':'058','HORA':'058','MES':'073','MÊS':'073','DIA':'033',
 'SV':'120','SERV':'120','SERVICO':'120','SERVIÇO':'120','FL':'044','FLS':'044','BL':'011','BLC':'011','BB':'012','BOB':'012','BD':'006','BJ':'006',
 'BLD':'005','BAL':'005','BR':'007','BIS':'009','BG':'009','BLI':'010','BLT':'010','BMB':'015','BOMB':'015','BT':'016','BOT':'016','CRT':'020','CART':'020',
 'CTL':'019','ENV':'039','EMB':'038','EST':'040','FD':'042','FDO':'042','FLAC':'043','GF':'050','GRF':'050','LAT':'067','LATA':'067','MÇ':'072','MAÇO':'072',
 'PÇ':'087','PEC':'087','PECA':'087','PEÇA':'087','PLT':'085','PAST':'086','POTE':'046','REF':'109','SCH':'113','SACHE':'113','SACHÊ':'113','SER':'117','SRG':'117',
 'TAB':'123','TBT':'129','TON':'127','T':'127','TN':'127','VD':'136','VID':'136','KWH':None,'FR':None,'FRS':None,'FRC':None,'PC':None,'PÇT':'084','PCTE':'084',
 'ANO':'003','SEM':None,'VB':'139','VERBA':'139','DOSE':'035','DS':'035','TESTE':'125','TIRA':'126','TR':'126','ROLO':'112','RESMA':'111','SACO':'114','GALAO':'049','GALÃO':'049'}
AMBIG = {'FR':['046','045','047','048'],'FRS':['046','045','047'],'FRC':['046','045','047'],'PC':['087','084'],'SEM':['115','116'],'KWH':[]}

# unidade -> elementos candidatos (restringe o catálogo)
GRUPOS = {
 'farmaco': (['002','018','027','035','036','043','045','047','048','086','117','118','119','122','129','010'], ['3.3.90.30','3.3.90.32']),
 'maodeobra': (['054','055','056','057','094','095','096','097','090'], ['3.3.90.37','3.3.90.39','3.3.90.36','3.3.90.34']),
 'servico': (['060','061','121','120','133','041','034'], ['3.3.90.36','3.3.90.39','3.3.90.35','3.3.90.40','4.4.90.39','4.4.90.36','4.4.90.51']),
 'tic': (['051','132'], ['3.3.90.40','4.4.90.40']),
 'transporte': (['001','100','103','104','105','140'], ['3.3.90.33','3.3.90.39','3.3.90.36']),
 'locacao': (['059'], ['3.3.90.39','3.3.90.37']),
 'especificas': (['004','029','062','069'], ['3.3.90.39','3.3.90.40','3.3.90.36']),
 'obra': (['139','065','053','102'], ['4.4.90.51','3.3.90.39','4.4.90.39']),
}
u2grp = {}
for g, (us, els) in GRUPOS.items():
    for u in us: u2grp[u] = g

# conta PCASP por subelemento (para 30 e 52; serviços via VPD 3.3.2.x não mapeados)
base = json.load(open('/home/claude/kb/base_full.json'))
conta = {r['codigo']: r['conta'] for r in base}

kb = json.load(open('/home/claude/app/kb.json'))
for i in kb['itens']:
    i['p'] = conta.get(i['c'], '')

# ---------- base federal (sem códigos de subelemento) ----------
old = json.load(open('/home/claude/kb/base_classificacao.json'))
chunks = json.load(open('/home/claude/kb/p448_chunks.json'))
def clean(s): return re.sub(r'^Registra(m)? (o valor|os valores) d(as|os) (apropriações das )?(despesas|valores) ?(realizadas )?(com|a título de)? ?','',s or '').strip()
fed = []
for r in old:
    nat = r['natureza']
    fed.append(dict(e=nat, n=r['titulo'], d=clean(r['descricao_448'])[:500], x='; '.join(x for x in [r['exemplos_448'], r['exemplos_pcasp'].replace(' - ', ', ')] if x)[:1200]))
# 36 e 39: nomes a partir da 448 (texto) — usa o título TCE apenas como rótulo descritivo
tce_by = {(int(x['codigo'].split('.')[3]), int(x['codigo'].split('.')[4])): x for x in base if x['codigo'].startswith('3.3.90.')}
src = open('/home/claude/scripts/build_full.py').read()
MAP36 = eval(re.search(r'MAP36 = (\{.*?\})', src).group(1)); MAP39 = eval(re.search(r'MAP39 = (\{.*?\})', src).group(1))
for el, nat, mp in ((36, '339036', MAP36), (39, '339039', MAP39)):
    for sub, j in mp.items():
        t = tce_by.get((el, sub))
        if not t: continue
        txt = chunks[nat][j]
        m = re.search(r'tais como[:.,]?\s*(.*)$', txt)
        fed.append(dict(e=f'3.3.90.{el}', n=t['subelemento'].capitalize(), d=clean(txt[:m.start()] if m else txt)[:500], x=(m.group(1) if m else '')[:1200]))
kb['federal'] = fed
kb['ta22'] = ta22
kb['siglas'] = {k: v for k, v in SIG.items() if v}
kb['ambiguas'] = AMBIG
kb['grupos'] = {g: els for g, (us, els) in GRUPOS.items()}
kb['u2grp'] = u2grp
kb['versao_fed'] = 'Base federal de referência: Portaria STN 448/2002 · MCASP 11ª ed. · PCASP 2027 (classifica até o elemento; subelemento indicado pelo nome, sem código)'
s = json.dumps(kb, ensure_ascii=False, separators=(',', ':'))
open('/home/claude/app/kb.json', 'w').write(s)
from collections import Counter
print(len(s)//1024, 'KB; federal', len(fed), Counter(f['e'] for f in fed), 'contas', sum(1 for i in kb['itens'] if i['p']))
