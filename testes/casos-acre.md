# Casos de teste — Acre (AC)

Criados em 27/11/2026 a partir das normas e dos extratos de contrato da CGE-AC (Diário Oficial do Acre, 2026).
Como testar: em https://classificabr.com, escolha **Estado = Acre**, faça a consulta individual de cada item
e anote o código que a IA devolveu. Para os casos 1 a 3, repita com **Estado = São Paulo** para confirmar
que a regra do Acre não vaza para outro estado.

| # | Item (digitar no campo "Nome ou descrição") | Tipo | Esperado no AC | Esperado nos demais estados | Origem |
|---|---|---|---|---|---|
| 1 | Terceirização de serviços de apoio técnico, administrativo e operacional, com mão de obra em regime de dedicação exclusiva | Serviço | **3.3.90.34** | 3.3.90.37 (regra 11) | Extrato do termo aditivo nº 3/2026 ao contrato 03/2023 (CGE-AC) |
| 2 | Serviço de segurança eletrônica e monitoramento remoto de alarme e imagens, com equipamentos e manutenção | Serviço | 3.3.90.39 | 3.3.90.39 | Extrato do contrato nº 27/2026 (CGE-AC) |
| 3 | Fornecimento de sistemas com suporte técnico, manutenção evolutiva e sustentação de TI | Serviço | 3.3.90.40 | 3.3.90.40 | Extrato do contrato nº 26/2026 (CGE-AC) |
| 4 | Medalha de mérito dourada em metal nobre, com diploma, para homenagem | Material | **a definir** (observar se vem 3.3.90.31, 3.3.90.32 ou 3.3.90.30) | — | IN CGE-AC nº 1/2026 (Medalha de Mérito em Ouvidoria) |
| 5 | Moeda honorífica institucional dourada em metal nobre, com diploma | Material | **a definir** (idem) | — | IN CGE-AC nº 2/2026 (Moeda Honorífica Institucional) |
| 6 | Mesa de escritório | Material | 4.4.90.52, e o quadro "Registro patrimonial" mostra a orientação de tombamento do Acre | 4.4.90.52, sem a orientação | IN CGE-AC nº 3/2026, art. 30 |

Os casos 4 e 5 servem para decidir se vale criar uma regra. Se a IA variar entre consultas ou escolher
um elemento que Sanada não considera correto, a regra entra em `RULES_UF.AC` (index.html).
