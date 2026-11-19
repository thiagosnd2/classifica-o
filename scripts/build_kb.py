import json, re

chunks = json.load(open('/home/claude/kb/p448_chunks.json'))
pcasp = {p['conta']: p for p in json.load(open('/home/claude/kb/pcasp_material.json'))}

# (código federal de referência, título, conta VPD PCASP 3.3.1.1.1.xx.00 ou None, conta almoxarifado 1.1.5.6.1.xx.00)
C30 = [
 ('01','Combustíveis e lubrificantes automotivos','01','01'),
 ('02','Combustíveis e lubrificantes de aviação',None,'01'),
 ('03','Combustíveis e lubrificantes para outras finalidades',None,'01'),
 ('04','Gás e outros materiais engarrafados','03','01'),
 ('05','Explosivos e munições','04','01'),
 ('06','Alimentos para animais','05','01'),
 ('07','Gêneros de alimentação','06','02'),
 ('08','Animais para pesquisa e abate','07','01'),
 ('09','Material farmacológico','08','05'),
 ('10','Material odontológico','09','05'),
 ('11','Material químico','10','01'),
 ('12','Material de coudelaria ou de uso zootécnico','11','01'),
 ('13','Material de caça e pesca','13','01'),
 ('14','Material educativo e esportivo','14','01'),
 ('15','Material para festividades e homenagens','15','01'),
 ('16','Material de expediente','16','07'),
 ('17','Material de processamento de dados','17','01'),
 ('18','Materiais e medicamentos para uso veterinário','18','05'),
 ('19','Material de acondicionamento e embalagem','19','01'),
 ('20','Material de cama, mesa e banho','20','01'),
 ('21','Material de copa e cozinha','21','01'),
 ('22','Material de limpeza e produtos de higienização','22','01'),
 ('23','Uniformes, tecidos e aviamentos','23','01'),
 ('24','Material para manutenção de bens imóveis/instalações','24','03'),
 ('25','Material para manutenção de bens móveis','25','01'),
 ('26','Material elétrico e eletrônico','26','01'),
 ('27','Material de manobra e patrulhamento','27','01'),
 ('28','Material de proteção e segurança','28','01'),
 ('29','Material para áudio, vídeo e foto','29','01'),
 ('30','Material para comunicações','30','01'),
 ('31','Sementes, mudas de plantas e insumos','31','01'),
 ('32','Suprimento de aviação','32','01'),
 ('33','Material para produção industrial','33','01'),
 ('34','Sobressalentes, máquinas e motores de navios e embarcações','34','01'),
 ('35','Material laboratorial','35','01'),
 ('36','Material hospitalar','36','05'),
 ('37','Sobressalentes de armamento','37','01'),
 ('38','Suprimento de proteção ao voo','38','01'),
 ('39','Material para manutenção de veículos','39','04'),
 ('40','Material biológico','40','01'),
 ('41','Material para utilização em gráfica','41','06'),
 ('42','Ferramentas','42','01'),
 ('43','Material para reabilitação profissional','43','01'),
 ('44','Material de sinalização visual e afins','44','01'),
 ('45','Material técnico para seleção e treinamento','45','01'),
 ('46','Material bibliográfico não imobilizável','46','01'),
 ('47','Aquisição de softwares de base',None,None),
 ('48','Bens móveis não ativáveis','48',None),
 ('49','Bilhetes de passagem','49',None),
 ('50','Bandeiras, flâmulas e insígnias','50','01'),
 ('96','Material de consumo – pagamento antecipado',None,None),
 ('99','Outros materiais de consumo','99','99'),
]
# (código federal de referência, título, contas de ativo PCASP 1.2.3.1.1.xx.xx)
C52 = [
 ('02','Aeronaves',['05.05']),
 ('04','Aparelhos de medição e orientação',['01.01']),
 ('06','Aparelhos e equipamentos de comunicação',['01.02']),
 ('08','Aparelhos, equipamentos e utensílios médico-odontológicos, laboratoriais e hospitalares',['01.03']),
 ('10','Aparelhos e equipamentos para esportes e diversões',['01.04']),
 ('12','Aparelhos e utensílios domésticos',['03.01']),
 ('14','Armamentos',['09.00']),
 ('18','Coleções e materiais bibliográficos',['04.02']),
 ('19','Discotecas e filmotecas',['04.03']),
 ('20','Embarcações',['05.06']),
 ('22','Equipamentos de manobra e patrulhamento',['01.17']),
 ('24','Equipamento de proteção, segurança e socorro',['01.05']),
 ('26','Instrumentos musicais e artísticos',['04.04']),
 ('28','Máquinas e equipamentos de natureza industrial',['01.06']),
 ('30','Máquinas e equipamentos energéticos',['01.07']),
 ('32','Máquinas e equipamentos gráficos',['01.08']),
 ('33','Equipamentos para áudio, vídeo e foto',['04.05']),
 ('34','Máquinas, utensílios e equipamentos diversos',['01.99']),
 ('35','Equipamentos de processamento de dados',['02.01','02.02']),
 ('36','Máquinas, instalações e utensílios de escritório',['03.02']),
 ('38','Máquinas, ferramentas e utensílios de oficina',['01.09']),
 ('39','Equipamentos e utensílios hidráulicos e elétricos',['01.21']),
 ('40','Máquinas e equipamentos agrícolas e rodoviários',['01.19','01.20']),
 ('42','Mobiliário em geral',['03.03']),
 ('44','Obras de arte e peças para museu',['04.06']),
 ('46','Semoventes e equipamentos de montaria',['10.00','01.10']),
 ('48','Veículos diversos',['05.01']),
 ('50','Veículos ferroviários',['05.02']),
 ('51','Peças não incorporáveis a imóveis',[]),
 ('52','Veículos de tração mecânica',['05.03']),
 ('53','Carros de combate',['05.04']),
 ('54','Equipamentos, peças e acessórios aeronáuticos',['01.14']),
 ('56','Equipamentos, peças e acessórios de proteção ao voo',['01.15']),
 ('57','Acessórios para automóveis',['01.12']),
 ('58','Equipamentos de mergulho e salvamento',['01.16']),
 ('60','Equipamentos, peças e acessórios marítimos',['01.13']),
 ('83','Equipamentos e sistema de proteção e vigilância ambiental',['01.18']),
 ('87','Equipamentos, sobressalentes de máquinas, motor de navios de esquadra',[]),
 ('99','Outros materiais permanentes',['99.99']),
]
assert len(C30) == len(chunks['339030']), (len(C30), len(chunks['339030']))
assert len(C52) == len(chunks['449052'])

def split_ex(txt):
    m = re.search(r'tais como[:.]?\s*(.*)$', txt) or re.search(r'a saber,? tais como:?\s*(.*)$', txt)
    if m: return txt[:m.start()].strip(' ,:'), m.group(1).strip()
    return txt, ''

def pcasp_examples(f):
    # PCASP VPD texts: description sentence(s) then examples joined by ' - '
    if ' - ' in f:
        i = f.find(' - ')
        start = f.rfind('. ', 0, i)
        return f[start+2:].strip() if start > 0 else ''
    return ''

rows = []
for (cod, tit, vpd, alm), txt in zip(C30, chunks['339030']):
    desc, ex = split_ex(txt)
    vp = pcasp.get(f'3.3.1.1.1.{vpd}.00') if vpd else None
    rows.append(dict(natureza='3.3.90.30', tipo='Consumo', subelemento=cod, codigo=f'3.3.90.30.{cod}', titulo=tit,
        descricao_448=desc, exemplos_448=ex,
        exemplos_pcasp=pcasp_examples(vp['funcao']) if vp else '',
        conta_vpd=vp['conta'] if vp else '', conta_estoque_ou_ativo=f'1.1.5.6.1.{alm}.00' if alm else ''))
for (cod, tit, ats), txt in zip(C52, chunks['449052']):
    desc, ex = split_ex(txt)
    rows.append(dict(natureza='4.4.90.52', tipo='Permanente', subelemento=cod, codigo=f'4.4.90.52.{cod}', titulo=tit,
        descricao_448=desc, exemplos_448=ex, exemplos_pcasp='', conta_vpd='',
        conta_estoque_ou_ativo=' / '.join(f'1.2.3.1.1.{a}' for a in ats)))
# subelementos que existem no PCASP (VPD) mas não na Portaria 448
known = {r['conta_vpd'] for r in rows if r['conta_vpd']}
extra = []
for c, p in pcasp.items():
    if c.startswith('3.3.1.1.1.') and c not in known:
        extra.append(dict(conta=c, titulo=p['titulo'], funcao=p['funcao']))
json.dump(rows, open('/home/claude/kb/base_classificacao.json', 'w'), ensure_ascii=False, indent=1)
json.dump(extra, open('/home/claude/kb/pcasp_sem_448.json', 'w'), ensure_ascii=False, indent=1)
print(len(rows), 'linhas;', len(extra), 'contas VPD sem correspondente na 448:')
for e in extra: print(' ', e['conta'], e['titulo'])
for r in rows[15:17]+rows[70:72]: print(json.dumps(r, ensure_ascii=False)[:600])
