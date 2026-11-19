# Classificador de Natureza de Despesa

Sistema que classifica materiais e serviços de compras públicas municipais na natureza de despesa até o subelemento e indica a conta contábil (PCASP). O usuário informa o item e o sistema devolve a classificação conforme o regulamento do Estado selecionado.

## Regulamento por Estado

| Estado | Natureza da despesa | Unidades de medida |
|---|---|---|
| Espírito Santo | Tabela de Natureza da Despesa TCE-ES 2027 (2ª consulta pública, PCM/2027), até o subelemento | Tabela Auxiliar 22 – IN 68/2020, Anexo VI (alterada pela Portaria 92/2025). Unidade fora da tabela retorna **ERRO** |
| Demais estados | Base federal de referência (Portaria STN 448/2002 e MCASP 11ª ed.), até o elemento; subelemento indicado só pelo nome | Não validadas |

Contas contábeis: PCASP 2027 (Portaria STN/MF nº 2.520, de 21/08/2026).
- Material de consumo: contas de almoxarifado (1.1.5.6.1.xx e 1.1.5.8.1.00).
- Material permanente: contas de bens móveis (1.2.3.1.1.xx.xx).
- Serviço: "Não se aplica (serviço)".

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `index.html` | Aplicação completa: consulta individual, quiz, importador de planilha e exportação |
| `kb.json` | Base de conhecimento usada pela página: 454 subelementos TCE-ES 2027 com ementas e exemplos, conceitos dos elementos (MCASP), Tabela Auxiliar 22, siglas de unidade, base federal, contas de almoxarifado e de bens móveis |
| `modelo_importacao.xlsx` | Modelo padrão de importação: TITULO, DESCRIÇÃO (até 400 caracteres), UNIDADE DE MEDIDA (lista da TA 22) e TIPO (Material ou Serviço) |
| `dados/` | Dados intermediários extraídos dos documentos oficiais (Portaria 448, PCASP 2027, MCASP e tabela TCE-ES) |
| `scripts/` | Scripts Python que montaram a base. Usar para reprocessar quando sair uma nova versão da tabela do TCE-ES ou do PCASP |

## Plano Pro (chave de licença)

- No topo da página, o campo **Chave Pro** ativa o plano Pro. Sem chave válida, a Consulta individual funciona normalmente, mas **importar** e **exportar** planilhas ficam desativados.
- As chaves têm o formato `QW-ES-XXXX-XXXX-XXXX`. O banco de dados da página guarda só o hash SHA-256 de cada chave (coleção `licencas/<hash>`), com município, UF, validade e situação (`ativa`). Só o dono do artefato grava nessa coleção.
- Com o termo de aceite, a chave fica salva no navegador e é revalidada a cada acesso.
- **Limite:** a verificação é feita no navegador, então é uma trava leve. Nesta fase, o uso da IA conta no plano de quem usa. A trava definitiva exige validação no backend próprio (Fase 3), com login e licenças por município.

## Funcionalidades

**Consulta individual**
- Botão Classificar habilitado só com Estado selecionado, ao menos 3 letras no item e unidade de medida escolhida na lista. Para nova classificação é preciso apagar ao menos 3 letras ou usar Limpar.
- Resultado com código, justificativa, critérios de consumo × permanente (Portaria 448, art. 3º), regras aplicadas e alternativas.
- Quiz quando a confiança é média ou baixa: as opções já vêm ligadas a um código e o clique resolve sem nova chamada à IA.

**Importar planilha (Pro)**
- Upload de .xlsx ou .csv no padrão do modelo.
- Unidade fora da TA 22 → ERRO, com coluna Sugestão e botões para corrigir (individual ou em lote).
- Itens repetidos classificados uma vez só; lotes de 20 itens separados por tipo; catálogo restrito aos elementos prováveis para economizar tokens.
- Exportação: TITULO, DESCRIÇÃO, UNIDADE DE MEDIDA, CLASSE (ELEMENTO), SUB ELEMENTO (SUGESTÃO), CONTA CONTÁBIL.

## Limitação atual

A página foi construída como artefato do Claude. Duas funções dependem de recursos do próprio Claude e **não funcionam fora dele**:
- classificação pela IA (`claude.use("sample")`);
- download de arquivos (`claude.use("downloads")`).

Fora do Claude, a página abre e faz a busca local por palavra-chave, mas não classifica com IA.

## Custos, escala e métricas

### Fase de testes (link do artefato)
No artefato compartilhado, o uso da IA conta nos limites do plano de cada pessoa que usa, não no de quem criou ([Claude Help Center](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)). O risco nessa fase é o testador atingir o limite do próprio plano (principalmente no Free); a página já trata esse caso com aviso e nova tentativa no importador.

### Consumo por operação (estimado a partir do tamanho real dos prompts, ~3,5 caracteres por token)

| Operação | Tokens de entrada | Tokens de saída |
|---|---|---|
| Consulta individual (ES) | ~11.300 | ~500 |
| Consulta individual otimizada (catálogo restrito) | ~3.400 | ~500 |
| Importação, por item (lote de 20) | ~220 | ~25 |

A consulta individual ainda envia o catálogo inteiro (412 subelementos). Aplicar a restrição de catálogo do importador reduz o custo cerca de 3 vezes.

### Custo em escala (backend próprio, API paga)
Preços de referência ([Claude Platform – Pricing](https://platform.claude.com/docs/en/about-claude/pricing)): Haiku 5.5 a US$ 0,10/MTok de entrada e US$ 0,50/MTok de saída (prompts até 100 mil tokens); Sonnet 5.5 a US$ 2/MTok e US$ 10/MTok.

Premissas: 78 municípios do ES, cada um com 1.000 consultas individuais e 3.000 itens importados por mês; na versão otimizada, 30% de perguntas repetidas atendidas pelo cache.

| Cenário mensal (ES inteiro) | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Como está hoje | ~US$ 117 | ~US$ 2.300 |
| Otimizado (catálogo restrito + cache de 30%) | ~US$ 39 | ~US$ 760 |
| Por município, otimizado | ~US$ 0,50 | ~US$ 9,70 |

Projeção para os 5.570 municípios do Brasil, versão otimizada: ~US$ 2.800/mês (Haiku) ou ~US$ 54 mil/mês (Sonnet). Com o Haiku, o custo de IA é de centavos por município e o maior custo passa a ser a infraestrutura. A escolha entre Haiku e Sonnet depende da taxa de acerto medida com itens reais.

### Plano de proteção (conexão e orçamento)
1. Haiku por padrão; Sonnet só para casos de confiança baixa.
2. Cache compartilhado de respostas: pergunta repetida = zero token.
3. Cache de prompt da API para a parte fixa (regras e catálogo).
4. Cotas por usuário e por município (plano gratuito × Pro).
5. Fila e limite de requisições por minuto no backend para importações grandes.

### Métricas a acompanhar

| Métrica | Para que serve |
|---|---|
| Consultas por dia, por município e por usuário | Volume e dimensionamento |
| Tokens de entrada e saída por consulta | Custo real |
| Taxa de acerto do cache | Economia gerada pelo cache |
| Distribuição de confiança (alta/média/baixa) | Qualidade da classificação |
| Uso do quiz e do "Nenhuma dessas" | Onde as regras precisam melhorar |
| Correções feitas pelo usuário | Taxa de acerto real |
| Erros e limites atingidos | Estabilidade |
| Tempo de resposta | Experiência do usuário |

Documento completo: [Classificador de Natureza de Despesa — Custos, Escala e Métricas](https://claude.ai/artifact/2tUgnxqJUxQMDVFpXXPQ3Y) (Claude Doc).

## Próximos passos

1. **Backend próprio (Fase 3):** API que recebe o item, monta o prompt com as regras e o catálogo do Estado e chama a IA pela API da Anthropic com chave própria. Substituir `sample.json(...)` por `fetch` para essa API e o download por geração de arquivo no navegador.
2. **Cache compartilhado de respostas:** chave = Estado + item normalizado + finalidade + unidade + fornecedor + despesa + versão da base. Respostas confirmadas no quiz têm prioridade. Pergunta repetida = zero token.
3. **Dicionário por município:** classificação revisada por código de catálogo, reaproveitada entre processos.
4. **Tabelas estaduais:** carregar a tabela de natureza da despesa de cada tribunal de contas e a base federal oficial de subitens.
5. **Pendências da base:** versão final da tabela TCE-ES 2027; código 137 ausente na TA 22; subelemento de frete PJ em 3.3.90.39; critério do 4.4.90.52.38 (material de consumo de uso duradouro).

## Fontes

- Tabela de Natureza da Despesa TCE-ES 2027 – 2ª consulta pública (PCM/2027)
- IN TC 68/2020, Anexo VI – Tabela Auxiliar 22 (alterada pela Portaria 92/2025)
- Portaria STN nº 448, de 13/09/2002
- MCASP – 11ª edição
- PCASP 2027 – Portaria STN/MF nº 2.520, de 21/08/2026

Ferramenta de apoio: a classificação final é responsabilidade do setor de contabilidade/orçamento do ente.
