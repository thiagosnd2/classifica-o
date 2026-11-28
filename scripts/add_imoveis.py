"""Inclui no kb.json as contas de BENS IMÓVEIS e OBRAS (item 2.3 do levantamento, aprovado por Sanada em 27/11/2026).

Uso:  python scripts/add_imoveis.py <PCASP_2027.xlsx> [kb.json]

O que grava no kb.json:
  imoveis          lista {c, n} das contas usadas, com o título oficial do PCASP 2027 (Portaria STN/MF 2.520/2026)
  imoveis_sub      subelemento (tabela TCE-ES / Rio Branco) -> conta do bem
  imoveis_el       elemento -> conta padrão, usada fora do ES (base federal, até o elemento)
  depreciacao.imoveis  conta do bem -> {c, n} da depreciação acumulada, ou {c: null, n: motivo} quando não deprecia

Regra aprovada:
  4.4.90.61 (imóvel comprado para uso do órgão) -> bens de uso especial (1.2.3.2.1.01.xx)
  4.5.90.61 (inversão financeira)               -> bens dominicais (1.2.3.2.1.04.xx)
  4.4.90.51 obras e estudos                     -> bens imóveis em andamento (1.2.3.2.1.06.xx), sem depreciação até concluir
  Terrenos não depreciam.
Toda conta é conferida no PCASP 2027: se alguma não existir, o script para com erro.
"""
import json
import sys

import pandas as pd

SUB = {  # subelemento -> conta do bem (tabela aprovada, itens 16 a 27)
    '4.4.90.51.03': '1.2.3.2.1.07.00', '4.4.90.51.04': '1.2.3.2.1.08.00',
    '4.4.90.51.80': '1.2.3.2.1.06.05', '4.4.90.51.99': '1.2.3.2.1.06.01',
    '4.4.90.61.01': '1.2.3.2.1.01.03', '4.4.90.61.02': '1.2.3.2.1.01.04', '4.4.90.61.03': '1.2.3.2.1.01.02',
    '4.4.90.61.04': '1.2.3.2.1.01.01', '4.4.90.61.05': '1.2.3.2.1.01.05', '4.4.90.61.99': '1.2.3.2.1.01.98',
    '4.5.90.61.01': '1.2.3.2.1.04.01', '4.5.90.61.02': '1.2.3.2.1.04.08', '4.5.90.61.03': '1.2.3.2.1.04.13',
    '4.5.90.61.04': '1.2.3.2.1.04.99', '4.5.90.61.06': '1.2.3.2.1.04.12', '4.5.90.61.07': '1.2.3.2.1.04.04',
    '4.5.90.61.08': '1.2.3.2.1.04.03', '4.5.90.61.10': '1.2.3.2.1.04.99', '4.5.90.61.99': '1.2.3.2.1.04.99',
}
EL = {  # fora do ES (só o elemento): conta padrão de cada elemento (itens 19, 25 e 27)
    '4.4.90.51': '1.2.3.2.1.06.01', '4.4.90.61': '1.2.3.2.1.01.98', '4.5.90.61': '1.2.3.2.1.04.99',
}
NAO_DEPRECIA = {
    '1.2.3.2.1.01.04': 'Não deprecia: terreno',
    '1.2.3.2.1.04.13': 'Não deprecia: terreno',
    '1.2.3.2.1.06.01': 'Não deprecia enquanto a obra estiver em andamento',
    '1.2.3.2.1.06.05': 'Não deprecia enquanto em andamento',
}


def dep_de(conta):
    """Depreciação acumulada de bens imóveis no PCASP 2027, pelo grupo da conta."""
    if conta in NAO_DEPRECIA:
        return None
    if conta.startswith('1.2.3.2.1.01.'):
        return '1.2.3.8.1.02.01'  # bens de uso especial
    if conta.startswith('1.2.3.2.1.04.'):
        return '1.2.3.8.1.02.02'  # bens dominicais
    if conta == '1.2.3.2.1.07.00':
        return '1.2.3.8.1.02.05'  # instalações
    if conta == '1.2.3.2.1.08.00':
        return '1.2.3.8.1.02.06'  # benfeitorias em propriedade de terceiros
    raise SystemExit(f'sem regra de depreciação para {conta}')


def main():
    pcasp_xlsx = sys.argv[1]
    kb_path = sys.argv[2] if len(sys.argv) > 2 else 'kb.json'
    p = pd.read_excel(pcasp_xlsx, header=None, skiprows=1)
    titulo = {str(c).strip(): str(t).strip() for c, t in zip(p[7], p[8])}
    kb = json.load(open(kb_path, encoding='utf-8'))

    contas = sorted(set(SUB.values()) | set(EL.values()))
    for c in contas:
        if c not in titulo:
            raise SystemExit(f'conta {c} não existe no PCASP 2027')
    kb['imoveis'] = [{'c': c, 'n': titulo[c]} for c in contas]
    itens = {i['c'] for i in kb['itens']}
    falta = [s for s in SUB if s not in itens]
    if falta:
        raise SystemExit(f'subelementos fora da tabela: {falta}')
    kb['imoveis_sub'] = SUB
    kb['imoveis_el'] = EL
    dep = {}
    for c in contas:
        d = dep_de(c)
        if d is None:
            dep[c] = {'c': None, 'n': NAO_DEPRECIA[c]}
        else:
            if d not in titulo:
                raise SystemExit(f'conta de depreciação {d} não existe no PCASP 2027')
            dep[c] = {'c': d, 'n': titulo[d].replace('(-) ', '')}
    kb.setdefault('depreciacao', {})['imoveis'] = dep
    json.dump(kb, open(kb_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(contas)} contas de imóveis, {len(SUB)} subelementos, depreciação de {len(dep)} contas gravados em {kb_path}')


if __name__ == '__main__':
    main()
