"""Gera a planilha de conferência da base (subelementos, elementos e contas) para revisão humana."""
import json
from openpyxl import Workbook
from openpyxl.styles import Alignment, PatternFill

rows = json.load(open('/home/claude/kb/base_full.json'))
els = json.load(open('/home/claude/kb/mcasp_elementos.json'))
fill = PatternFill('solid', fgColor='F3F3F3')

def style(ws, widths, wrap_cols):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=c.column_letter in wrap_cols, vertical='top')
    for c in ws[1]:
        c.fill = fill
    ws.freeze_panes = 'A2'

wb = Workbook()
ws = wb.active
ws.title = 'Classificação'
ws.append(['Natureza (TCE-ES 2027)', 'Subelemento', 'Categoria', 'Uso', 'Descrição do subelemento', 'Exemplos – Portaria 448',
           'Exemplos – PCASP 2027', 'Conceito do elemento (MCASP 11ª ed.)', 'Elemento', 'Conta PCASP', 'Situação na consulta 2027', 'Fonte da descrição'])
for r in rows:
    el = int(r['codigo'].split('.')[3])
    ws.append([r['codigo'], r['subelemento'], r['categoria'], r['uso'], r['descricao'], r['ex448'], r['expcasp'],
               els.get(str(el), {}).get('conceito', ''), r['elemento'], r['conta'], r['situacao'], r['fonte']])
style(ws, {'A': 16, 'B': 40, 'C': 26, 'D': 22, 'E': 60, 'F': 60, 'G': 50, 'H': 60, 'I': 34, 'J': 30, 'K': 24, 'L': 34}, 'BEFGH')

we = wb.create_sheet('Elementos')
we.append(['Elemento', 'Nome', 'Conceito (MCASP 11ª ed., Parte I)'])
for k, v in sorted(els.items(), key=lambda x: int(x[0])):
    we.append([int(k), v['nome'], v['conceito']])
style(we, {'A': 10, 'B': 44, 'C': 110}, 'BC')

wr = wb.create_sheet('Regras')
wr.append(['Tema', 'Regra', 'Fonte'])
R = [
 ('Consumo × permanente', 'Material de consumo: perde normalmente a identidade física e/ou tem utilização limitada a dois anos. Material permanente: não perde a identidade física e/ou dura mais de dois anos.', 'Lei 4.320/64, art. 15 §2º; Portaria STN 448/2002, art. 2º; MCASP 4.6.1.1'),
 ('Consumo × permanente', 'O material é de CONSUMO se atender a pelo menos um critério: durabilidade (perde condições de uso em até 2 anos), fragilidade (quebradiço, deformável ou danificável), perecibilidade (sofre modificações químicas/físicas ou se deteriora), incorporabilidade (incorporado a outro bem sem poder ser retirado sem prejuízo) ou transformabilidade (adquirido para transformação). Só é permanente se não atender a nenhum.', 'Portaria 448, art. 3º; MCASP 4.6.1.1'),
 ('Incorporabilidade: corrente × capital', 'Peça incorporada para constituir bem novo, melhoria ou adição complementar → 4.4.90.30. Peça de reposição com a mesma configuração, para manter o uso normal → 3.3.90.30.', 'MCASP 4.6.1.1, critério d'),
 ('Melhoria × manutenção', 'Trocar memória por outra de maior capacidade ou incluir componente novo (ex.: leitora de CD) é melhoria → 4.4.90.30. Trocar por peça de mesma capacidade é manutenção → 3.3.90.30.', 'MCASP 4.6.1.1, exemplo b'),
 ('Pen-drive, caneta óptica e similares', 'Material de consumo (3.3.90.30) pelo critério da fragilidade, com controle por relação-carga como material de uso duradouro.', 'MCASP 4.6.1.1, exemplo e'),
 ('Livros', 'Livros para bibliotecas públicas são material de consumo (Lei 10.753/2003, art. 18). Para as demais finalidades, material bibliográfico é permanente (4.4.90.52).', 'MCASP 4.6.1.1, exemplo c'),
 ('Peças não incorporáveis a imóveis', 'Biombos, cortinas, divisórias removíveis, estrados, persianas e tapetes: aplicar os cinco critérios; em geral são material permanente (4.4.90.52.29).', 'MCASP 4.6.1.1, exemplo a; TCE-ES 2027'),
 ('Uso duradouro', 'Material de consumo de uso duradouro (por durabilidade, quantidade ou valor) é controlado por relação-carga e incorporado ao patrimônio. A tabela TCE-ES 2027 tem o subelemento 4.4.90.52.38 – Material de consumo de uso duradouro.', 'MCASP 4.6.1.1; TCE-ES 2027'),
 ('Classificação orçamentária × controle patrimonial', 'Classificação orçamentária, controle patrimonial e reconhecimento do ativo seguem critérios distintos. A classificação orçamentária segue os critérios consumo × permanente; o controle patrimonial segue a racionalização (custo × benefício).', 'MCASP 4.6.1.1'),
 ('Serviço de manutenção: corrente × capital', 'Serviço que mantém o bem em condições normais, sem aumento relevante de vida útil → despesa corrente. Se aumentar significativamente a vida útil → despesa de capital, incorporada ao ativo.', 'MCASP 4.6.1.1, exemplo d'),
 ('Material por encomenda', 'Só é serviço (36 PF / 39 PJ) se o órgão fornecer a matéria-prima. Caso contrário: 52 se permanente, 30 se consumo. Vale a essência, não o tipo de nota fiscal. Ex.: confecção de placas de sinalização com nota fiscal de serviço → 3.3.90.30.', 'Portaria 448, art. 6º; MCASP 4.6.1.2'),
 ('Obras × serviços', 'São serviços (36/39): reparos, consertos, revisões, pinturas, reformas e adaptações de imóveis sem ampliação; reparos em instalações elétricas e hidráulicas; reparos de biombos, carpetes, divisórias e lambris; manutenção de elevadores e limpeza de fossa. Se houver ampliação relevante do potencial de benefícios do imóvel → 4.4.90.51.', 'MCASP 4.6.1.3'),
 ('Comunicação: 39 × 40', 'Telefonia fixa sem pacote de dados → 39. Telefonia fixa ou móvel com pacote de dados/internet → 40. Token (dispositivo + licença de software) → 40.', 'MCASP 4.6.1.6'),
 ('TIC', 'Serviços de TIC prestados por PJ (locação de equipamentos e softwares, desenvolvimento e manutenção de software, hospedagem, comunicação de dados, suporte, nuvem, outsourcing de impressão, digitalização, treinamento em TIC) → elemento 40, não 39. Desenvolvimento, manutenção evolutiva e aquisição de software → 4.4.90.40.', 'MCASP, conceito do elemento 40; TCE-ES 2027'),
 ('Equipamentos de TIC (TCE-ES)', 'A tabela TCE-ES 2027 detalha os equipamentos de TIC: 4.4.90.52.41 computadores, .43 servidores/storage, .45 impressoras, .46 ativos de rede, .47 telefonia, além de 4.4.90.52.19 equipamentos de processamento de dados.', 'TCE-ES 2027'),
 ('Alimentação: 30 × 39 × 46', 'Gêneros alimentícios in natura → 3.3.90.30.07 (exceto merenda) ou 3.3.90.30.61 (merenda escolar). Refeições preparadas fornecidas por PJ → 3.3.90.39.33. Auxílio-alimentação em pecúnia, bilhete ou cartão → elemento 46.', 'MCASP 4.6.1.5; TCE-ES 2027'),
 ('Uniformes', 'Uniforme escolar → 3.3.90.30.62. Demais uniformes, tecidos e aviamentos → 3.3.90.30.23. Confecção com matéria-prima fornecida pelo órgão → 36.37 (PF) ou 39.70 (PJ).', 'TCE-ES 2027; MCASP 4.6.1.2'),
 ('Distribuição gratuita', 'Material, bem ou serviço adquirido para distribuir gratuitamente (livros didáticos, medicamentos para uso domiciliar, gêneros alimentícios para assistência etc.) → elemento 32, exceto se for premiação (elemento 31).', 'MCASP, conceito do elemento 32'),
 ('Mão de obra: 37 × 39', 'Se o contrato especificar o quantitativo físico de pessoal → 37 (locação de mão de obra). Se não especificar → 39.', 'MCASP, conceito do elemento 37; Portaria 448, Anexo III'),
 ('Item não citado', 'Usar o subelemento que mais se assemelha às características do item. Estar listado em um subelemento não impede outra classificação no mesmo elemento, se houver aplicação específica.', 'Portaria 448, art. 5º'),
 ('Pequeno vulto', 'Usar a conta cuja função seja a mais adequada ao bem ou serviço.', 'Portaria 448, art. 7º'),
]
for r in R: wr.append(list(r))
style(wr, {'A': 30, 'B': 100, 'C': 40}, 'ABC')

wp = wb.create_sheet('Pendências')
wp.append(['#', 'Ponto', 'Situação / ação'])
P = [
 (1, 'Códigos oficiais', 'Resolvido: todos os códigos agora vêm da Tabela de Natureza da Despesa TCE-ES 2027 (2ª consulta pública). Os códigos provisórios da versão anterior foram descartados.'),
 (2, 'Numeração do 4.4.90.52 no TCE-ES difere da federal', 'Ex.: Mobiliário é 52.42 nos dois, mas Processamento de dados é 52.19 no TCE-ES (35 na federal) e Aeronaves é 52.01 (02 na federal). A base usa só a numeração do TCE-ES.'),
 (3, 'Tabela ainda em consulta pública', 'A versão é a 2ª consulta pública do PCM/2027. Quando o TCE-ES publicar a versão final, reimportar e comparar.'),
 (4, 'Subelementos só com título', '165 subelementos (principalmente TIC – 40, elementos 31, 32, 33, 35, 37, 38, 51, 61 e itens novos de 36/39) não têm ementa na Portaria 448 nem no PCASP. Para eles, o classificador usa o título e o conceito do elemento (MCASP). Se houver ementário do TCE-ES ou nota técnica, incluir.'),
 (5, 'Fretes PJ em despesa corrente', 'A tabela TCE-ES 2027 não tem subelemento de fretes em 3.3.90.39 (existe 3.3.90.36.38 para PF e 4.4.90.39.31 em capital). Confirmar onde classificar frete PJ corrente (provavelmente 3.3.90.39.99).'),
 (6, '4.4.90.52.38 – Material de consumo de uso duradouro', 'O MCASP trata esses itens como consumo controlado por relação-carga; o TCE-ES criou subelemento em 4.4.90.52. Confirmar critério de uso com o TCE-ES.'),
 (7, 'Modalidade de aplicação', 'A base usa a modalidade 90 (aplicação direta). Para consórcios (71/93/94) e outras modalidades, o elemento e o subelemento se mantêm; só muda a modalidade.'),
 (8, 'Itens fora do escopo de compras', 'Juros, multas, encargos, diárias, jetons, estagiários etc. estão na base, marcados como "Outros (financeiro/pessoal/contábil)" na coluna Uso, para o classificador não sugeri-los para itens de compra.'),
]
for p in P: wp.append(list(p))
style(wp, {'A': 5, 'B': 44, 'C': 110}, 'BC')

wb.save('/home/claude/kb/base_completa.xlsx')
print('ok', len(rows))
