# Classificador de Natureza de Despesa

Sistema que classifica materiais e serviços de compras públicas municipais na natureza de despesa até o subelemento e indica a conta contábil (PCASP). O usuário informa o item e o sistema devolve a classificação conforme o regulamento do Estado selecionado.

## Regulamento por Estado

| Estado | Natureza da despesa | Unidades de medida |
|---|---|---|
| Espírito Santo | Tabela de Natureza da Despesa TCE-ES 2027 (2ª consulta pública, PCM/2027), até o subelemento | Tabela Auxiliar 22 – IN 68/2020, Anexo VI (alterada pela Portaria 92/2025). Unidade fora da tabela retorna **ERRO** |
| Demais estados | Base federal de referência (Portaria STN 448/2002 e MCASP 11ª ed.), até o elemento; subelemento indicado só pelo nome | Livres; a Tabela Auxiliar 22 aparece só como referência opcional |

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
| `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest` | Ícone do site (aba, favoritos, barra lateral do navegador, atalho no celular): quadrado verde-petróleo com um "C" e linhas de classificação |
| `vendor/palavras.txt` | Dicionário de português (~178 mil palavras, licença MIT) da correção ortográfica local; origem em `vendor/palavras-LEIAME.txt` |
| `dados/` | Dados intermediários extraídos dos documentos oficiais (Portaria 448, PCASP 2027, MCASP e tabela TCE-ES) |
| `scripts/` | Scripts Python que montaram a base. Usar para reprocessar quando sair uma nova versão da tabela do TCE-ES ou do PCASP |

## Plano Pro (chave de licença)

> **Situação atual (22/11/2026): plano Pro suspenso.** O importador está liberado para todos, com limite de 5 importações por dia por endereço IP (contado no servidor). Chaves Pro válidas continuam funcionando, sem limite. Para reativar: `PLANO_PRO: true` em `window.CFG` e `PRO_OBRIGATORIO=true` no Worker.

- No topo da página, o campo **Chave Pro** ativa o plano Pro. Sem chave válida, a Consulta individual funciona normalmente, mas **importar** e **exportar** planilhas ficam desativados.
- As chaves têm o formato `QW-ES-XXXX-XXXX-XXXX`. O banco de dados da página guarda só o hash SHA-256 de cada chave (coleção `licencas/<hash>`), com município, UF, validade e situação (`ativa`). Só o dono do artefato grava nessa coleção.
- Com o termo de aceite, a chave fica salva no navegador e é revalidada a cada acesso.
- **Onde a trava vale:** no Projeto 1 (claude.ai) a importação está desligada desde 23/11/2026 (só consulta individual). No Projeto 2 (classificabr.com) a chave é conferida no servidor a cada lote; com `PRO_OBRIGATORIO=true`, sem chave válida o servidor recusa o lote.

## Publicação fora do Claude (GitHub Pages + Cloudflare Workers)

A página pode rodar no GitHub Pages, sem depender do claude.ai. A IA e a validação das chaves Pro passam por um servidor próprio em `servidor/worker.js` (Cloudflare Workers), que guarda a chave da API da Anthropic e confere as chaves Pro no servidor. O passo a passo completo está em [`servidor/PUBLICAR.md`](servidor/PUBLICAR.md).

## Guia para desenvolvedores

O código é comentado em português para leitura por pessoas e agentes:

- `index.html` — aplicação inteira. O script principal começa com um **mapa do arquivo** e está dividido em seções numeradas (1. Infraestrutura · 2. Utilitários · 3. Estado · 4. Regras e busca local · 5. Consulta individual · 6. Importador · 7. Plano Pro · 8. Início). Cada função tem um comentário dizendo o que faz e por quê.
- `servidor/worker.js` — servidor no Cloudflare: rotas `/classificar`, `/lote`, `/licenca`, anti-robô, teto diário e chamada à IA.
- `servidor/chave_pro.mjs` e `servidor/lacrar_licenca.mjs` — geração de chaves Pro (KV do Cloudflare e banco do Claude).
- `scripts/*.py` — montagem da base `kb.json` a partir das tabelas oficiais.

Princípio de projeto: **a IA só sugere; o código valida antes e confere depois; o usuário decide.** O fluxo completo está desenhado na documentação do sistema (seção "Fluxo do sistema").

## Segurança

- Respostas da IA sempre escapadas antes de aparecer na tela.
- Chave da API só no servidor (Cloudflare), nunca na página ou no repositório.
- Chaves Pro guardadas como hash; no Projeto 1 os dados da licença (município, validade) ficam cifrados com a própria chave (`servidor/lacrar_licenca.mjs`).
- Visitas: Cloudflare Web Analytics (sem cookies, sem dados pessoais), só em classificabr.com; token em `window.CFG.CF_ANALYTICS_TOKEN` (vazio desliga). Painel: Cloudflare → Analytics & Logs → Web Analytics.
- Estabilidade da IA: chamada com `temperature: 0` (o mesmo pedido tende a voltar com o mesmo código) e cache de respostas de confiança alta na consulta individual (Projeto 2).
- Projeto 2: verificação anti-robô (Turnstile) na consulta individual, teto diário de consultas, limite de importações por IP (Pro suspenso), limite por IP opcional e chave Pro conferida no servidor para o importador.
- Política de conteúdo (CSP) na hospedagem própria.
- Sem cookies próprios nem rastreadores; texto em Figtree (desde 27/11/2026) e códigos em IBM Plex Mono, ambas servidas pelo próprio site (`vendor/fonts/`, licença SIL OFL), sem envio de dados ao Google. No claude.ai a página usa o Google Fonts.
- SheetJS 0.20.3 servido pelo próprio site (`vendor/`), com verificação de integridade (SRI). No claude.ai a página usa a versão 0.18.5 do cdnjs.

## Funcionalidades

**Rodapé**
- No centro, abaixo de tudo, a marca d'água discreta "Sanada Inc 2027".
- À direita, os botões "Reportar problema" e "Fale conosco" abrem uma janela com o e-mail (mversobr@gmail.com) para copiar e atalhos para Gmail, Outlook ou o app de e-mail, já com assunto e roteiro (o problema inclui estado, versão, aba e navegador, ex.: "Edge 142 · Windows").

**Consulta individual**
- Botão Classificar habilitado só com Estado selecionado, ao menos 3 letras ou números no item (ex.: "WD40") e unidade de medida escolhida na lista. Para nova classificação é preciso apagar ao menos 3 letras ou usar Limpar.
- Resultado com código, justificativa, critérios de consumo × permanente (na tela: "MCASP"), regras aplicadas e alternativas.
- Quiz quando a confiança é média ou baixa: as opções já vêm ligadas a um código e o clique resolve sem nova chamada à IA.
- Correção ortográfica local, sem IA: palavra do título que não existe na base nem no dicionário e está a 1 letra (2 se tiver 10+) de uma conhecida → "Você quis dizer…?" com Usar sugestão / Manter como escrevi. Palavras com acento, siglas curtas, flexões e termos técnicos ficam de fora; palavra desconhecida sem parecida (ex.: "HD") segue direto para a IA.
- Unidade fora da Tabela Auxiliar 22: ao sair do campo, aparece "Você quis dizer" com as unidades mais próximas como botões (sinônimos como "mensal" → 073 – Mês e erros de digitação como "unidde" → 131 – Unidade); sem parecida, explica como escolher na lista.
- Em falha, mostra o motivo enviado pelo servidor (ex.: resposta da IA cortada por tamanho).
- **Em teste (23/11/2026):** para material permanente, o quadro "Registro patrimonial" mostra a conta do bem e a conta de depreciação acumulada (ex.: 1.2.3.1.1.03.02 → 1.2.3.8.1.01.03). A ligação fica em `kb.json` → `depreciacao` (por grupo 1.2.3.1.1.GG; contas de bens seguem o PCASP 2027). Para tirar: `git revert d7b2b32` (o Claude faz) e republicar o artefato; a versão anterior é a `39f1964`.

**Importar planilha (Pro; suspenso desde 22/11/2026: gratuito, até 5 importações por dia por IP)**
- Upload de .xlsx ou .csv no padrão do modelo.
- Unidade fora da TA 22 → ERRO, com coluna Sugestão e botões para corrigir (individual ou em lote).
- Títulos com provável erro de digitação listados antes de classificar, com Corrigir, Corrigir todos e Ignorar (o original fica guardado).
- Itens repetidos classificados uma vez só; lotes de 30 itens separados por tipo; catálogo restrito aos elementos prováveis para economizar tokens.
- Exportação: TITULO, DESCRIÇÃO, UNIDADE DE MEDIDA, TIPO, FINALIDADE, CLASSE (ELEMENTO), SUB ELEMENTO (SUGESTÃO), CONTA CONTÁBIL e, em teste, CONTA DE DEPRECIAÇÃO (TESTE).

## Limitações atuais

- A mesma página roda nos dois projetos: no claude.ai usa os recursos do Claude (`sample`, `db`, `downloads`); em https://classificabr.com usa o servidor próprio (`servidor/worker.js`). Sem nenhum dos dois, faz só a busca local por palavra-chave.
- No Projeto 1 (claude.ai), a IA só funciona para quem está logado no Claude e a correção ortográfica fica desligada (o dicionário não é publicado no artefato). Desde 23/11/2026 a importação de planilhas também fica desligada ali: a aba Importar mostra um aviso com o link para https://classificabr.com, onde o limite diário é contado no servidor.
- Fora do Espírito Santo, a classificação vai até o elemento (base federal) e a unidade de medida é livre: a Tabela Auxiliar 22 (do TCE-ES) aparece só como referência, na consulta e no importador.

## Custos, escala e métricas

### Fase de testes (link do artefato)
No artefato compartilhado, o uso da IA conta nos limites do plano de cada pessoa que usa, não no de quem criou ([Claude Help Center](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)). O risco nessa fase é o testador atingir o limite do próprio plano (principalmente no Free); a página já trata esse caso com aviso e nova tentativa no importador.

### Consumo por operação (estimado a partir do tamanho real dos prompts, ~3,5 caracteres por token)

| Operação | Tokens de entrada | Tokens de saída |
|---|---|---|
| Consulta individual (ES) | ~11.300 | ~500 |
| Consulta individual otimizada (catálogo restrito) | ~3.400 | ~500 |
| Importação, por item (lote de 30) | ~170 | ~25 |

A consulta individual ainda envia o catálogo inteiro (412 subelementos utilizáveis, dos 454 da tabela; os outros 42 não são despesas de compras, como diárias e estagiários). Aplicar a restrição de catálogo do importador reduz o custo cerca de 3 vezes.

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
2. Cache compartilhado de respostas: pergunta repetida = zero token. **Implementado em 23/11/2026** para a consulta individual em classificabr.com (respostas de confiança alta, 30 dias, no KV do Worker).
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

1. **Backend próprio:** concluído em 21/11/2026 (Cloudflare Worker + API da Anthropic, no ar em https://classificabr.com).
2. **Cache compartilhado de respostas:** feito em 23/11/2026 para a consulta individual no site (chave = hash do pedido normalizado, que já contém Estado, item, finalidade, unidade, fornecedor, despesa e catálogo; só confiança alta; 30 dias; `CACHE_VERSAO` no worker.js descarta tudo). Falta: importador e respostas confirmadas no quiz.
3. **Dicionário por município:** classificação revisada por código de catálogo, reaproveitada entre processos.
4. **Tabelas estaduais:** carregar a tabela de natureza da despesa de cada tribunal de contas e a base federal oficial de subitens.
5. **Pendências da base:** versão final da tabela TCE-ES 2027; código 137 ausente na TA 22; subelemento de frete PJ em 3.3.90.39; critério do 4.4.90.52.38 (material de consumo de uso duradouro).

## Fontes

- Tabela de Natureza da Despesa TCE-ES 2027 – 2ª consulta pública (PCM/2027)
- IN TC 68/2020, Anexo VI – Tabela Auxiliar 22 (alterada pela Portaria 92/2025)
- Portaria STN nº 448, de 13/09/2002 — revogada, mas o conceito continua: segue nas regras enviadas à IA e na base; desde 27/11/2026 não aparece mais na tela.
- **Regras por Estado (fora do ES), desde 27/11/2026:** `ELEM_UF`, `ELEM_UF_CONCEITO` e `RULES_UF` em `index.html` guardam os acréscimos de cada estado à base federal, sem afetar os demais. Hoje só o **Acre (AC)**: terceirização com mão de obra em dedicação exclusiva → 3.3.90.34 (prática do Estado nos extratos de contrato da CGE-AC de 2026; no AC prevalece sobre a regra 11) e orientação de tombamento no Registro patrimonial (IN CGE-AC nº 3/2026, art. 30). Casos de teste em `testes/casos-acre.md`.
- **Termo de aceite (revisto em 27/11/2026, aprovado por Sanada):** sem a menção a "estatística"; informa o cache de respostas no servidor (até 30 dias, só o resultado), o IP registrado por até 2 dias para o limite de importação (ambos escondidos no link do Claude) e o Cloudflare Web Analytics anônimo (só em classificabr.com).
- **Versão da página:** constante `APP_VERSAO` (AAAA.MM.DD-n) no `index.html`, mostrada no rodapé e no e-mail do "Reportar problema". Atualizar a cada publicação.
- Justificativa da IA sem citar normas (regra `JUST_RULE`, desde 27/11/2026); as regras que a IA segue não mudaram.
- Na tela: MCASP e Lei nº 4.320/1964 (art. 15, § 2º) para todos os estados; a Portaria Interministerial STN/SOF nº 163/2001 aparece só para o Espírito Santo (cada estado tem o seu regulamento).
- MCASP – 11ª edição
- PCASP 2027 – Portaria STN/MF nº 2.520, de 21/08/2026

Ferramenta de apoio: a classificação final é responsabilidade do setor de contabilidade/orçamento do ente.
