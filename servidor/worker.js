/* =====================================================================================
   ARQUIVO GERADO — NÃO EDITE AQUI.
   Edite servidor/worker-base.js e/ou prompt.js e rode:  node servidor/montar-worker.mjs
   Versão do Worker: 2026.11.28-4
   Parte 1: prompt.js (montagem do pedido à IA, igual à da página)
   Parte 2: servidor/worker-base.js (rotas, limites, cache e chamada à IA)
   ===================================================================================== */

/* ======================= Parte 1: prompt.js ======================= */
/* =====================================================================================
   prompt.js — montagem do pedido enviado à IA (fase 3 do levantamento, 27/11/2026)
   -------------------------------------------------------------------------------------
   Arquivo ÚNICO usado em dois lugares, para o pedido sair idêntico nos dois:
     • na página (index.html carrega este arquivo antes do script principal), usado no link
       do Claude e como referência;
     • no servidor (servidor/montar-worker.mjs cola este arquivo dentro do worker.js), que
       monta o pedido a partir só dos campos enviados pela página (item 1.2).
   Regras de uso:
     • não usar nada do navegador (document, window, localStorage) aqui;
     • a base vem da variável global KB (kb.json), preparada com prepararKB(KB);
     • o Estado vem por parâmetro (uf); na página, o padrão é o Estado selecionado (UF).
   Mudou algo aqui? Rode "node servidor/montar-worker.mjs" e cole o worker.js novo no Cloudflare.
   ===================================================================================== */

/** Estado atual quando a função não recebe uf: na página é o UF selecionado; no servidor, vazio. */
const UFATUAL = () => (typeof UF !== 'undefined' ? UF : '');

/* ---------- Texto: normalização e radicais (busca por palavra-chave) ---------- */
const norm = s => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const STOP = new Set('para com das dos que de da do e em os as no na ou por tais como uma um ao aos the tipo item itens marca modelo unidade und un cx pct kit'.split(' '));
const stem = w => w.length>5 ? w.slice(0,6) : w.replace(/s$/,'');
const toks = s => norm(s).split(/[^a-z0-9]+/).filter(w=>w.length>2 && !STOP.has(w)).map(stem);

/** Prepara a base para a busca por palavra-chave (radicais de título, exemplos e descrição).
    Chamar uma vez depois de carregar o kb.json, na página e no servidor. */
function prepararKB(kb){
  for(const i of kb.itens){ i._t=new Set(toks(i.t)); i._x=new Set(toks(i.x)); i._d=new Set(toks(i.d)); }
  for(const f of kb.federal){ f._t=new Set(toks(f.n)); f._x=new Set(toks(f.x)); f._d=new Set(toks(f.d)); }
  return kb;
}

/* ---------- Estados ---------- */
/** Estados atendidos (sigla → nome). */
const UFS = {AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'};

/** Elementos válidos na base federal e seus nomes (usados fora do ES). */
const ELEM_OK = ['3.3.90.30','3.3.90.31','3.3.90.32','3.3.90.33','3.3.90.35','3.3.90.36','3.3.90.37','3.3.90.38','3.3.90.39','3.3.90.40','4.4.90.30','4.4.90.35','4.4.90.36','4.4.90.39','4.4.90.40','4.4.90.51','4.4.90.52','4.4.90.61','4.5.90.61'];
const ELNAME = {'30':'Material de consumo','31':'Premiações','32':'Material, bem ou serviço para distribuição gratuita','33':'Passagens e despesas com locomoção','35':'Serviços de consultoria','36':'Outros serviços de terceiros – PF','37':'Locação de mão de obra','38':'Arrendamento mercantil','39':'Outros serviços de terceiros – PJ','40':'Serviços de TIC – PJ','51':'Obras e instalações','52':'Equipamentos e material permanente','61':'Aquisição de imóveis'};
const elName = c => ELNAME[(c||'').split('.')[3]] || (c === '3.3.90.34' ? 'Outras despesas de pessoal decorrentes de contratos de terceirização' : '');
/* ---------- Regras por Estado (fora do ES), desde 27/11/2026 ----------
   Cada estado tem o seu regulamento. Aqui ficam só os acréscimos de um estado à base federal;
   os outros estados não são afetados.
   AC: o Acre classifica a terceirização com mão de obra em dedicação exclusiva no 3.3.90.34
   (prática do Estado, vista nos extratos de contrato da CGE-AC no Diário Oficial de 2026). */
const ELEM_UF = { AC: ['3.3.90.34'] };
const ELEM_UF_CONCEITO = { AC: { '34': ['Outras despesas de pessoal decorrentes de contratos de terceirização',
  'No Acre: contratos de terceirização com mão de obra em regime de dedicação exclusiva (apoio técnico, administrativo e operacional, com postos de trabalho). Usado no Acre como 3.3.90.34.'] } };
const RULES_UF = { AC: `
REGRAS ESPECÍFICAS DO ACRE:
- Terceirização de serviços com mão de obra em regime de DEDICAÇÃO EXCLUSIVA (postos de trabalho de apoio técnico, administrativo, operacional e similares) → 3.3.90.34 (Outras despesas de pessoal decorrentes de contratos de terceirização). No Acre, esta regra prevalece sobre a regra 11 (37 × 39).
- Serviços sem dedicação exclusiva de mão de obra continuam pelas regras gerais (ex.: segurança eletrônica e monitoramento → 39; sistemas e suporte de TI → 40).` };
/** Elementos válidos no Estado (base federal + acréscimos do Estado). */
const elemsOk = (uf = UFATUAL()) => ELEM_OK.concat(ELEM_UF[uf] || []);
/** Elementos válidos por tipo no Estado (os acréscimos do AC são de serviço). */
const tipoElems = (tipo, uf = UFATUAL()) => TIPO_ELEMS[tipo].concat(tipo === 'Serviço' ? (ELEM_UF[uf] || []) : []);
/** Conceito dos elementos para o pedido (MCASP + acréscimos do Estado). */
const elemConceitos = (uf = UFATUAL()) => Object.entries(KB.elementos).concat(Object.entries(ELEM_UF_CONCEITO[uf] || {}).map(([k,[n,c]])=>[k,{n,c}]));

/* ---------- Regras enviadas à IA ---------- */
/** Regra de revisão de texto (ortografia, padronização, alerta de descrição vaga). Nunca inventa
    característica. Entra no pedido da consulta e do lote. */
const TEXT_RULE = `REVISÃO DO TEXTO (para o usuário melhorar a descrição; não altera a classificação):
(a) corrija ortografia e acentuação; (b) padronize: primeira letra maiúscula, abreviações por extenso (cx→caixa, un→unidade, pct→pacote, c/→com), ordem item, especificação, medida; (c) NUNCA invente característica que não esteja no texto informado; (d) se a descrição for vaga (repete o título ou é genérica demais para uma compra pública), liste em "falta" até 4 especificações que deveriam ser informadas (ex.: material, dimensões, cor, capacidade, modelo). Só preencha os campos de texto quando houver mudança; senão use null.`;
/** Regras de classificação (Lei 4.320/64, Portaria 448/2002, MCASP) enviadas à IA em todo pedido. */
const RULES = `REGRAS DE CLASSIFICAÇÃO (Lei 4.320/64; Portaria STN 448/2002; MCASP 11ª ed., Parte I, item 4.6):
1. Consumo × permanente: material é de CONSUMO se atender a PELO MENOS UM critério — durabilidade (perde condições de uso em até 2 anos), fragilidade (quebradiço, deformável ou danificável), perecibilidade (modificações químicas/físicas), incorporabilidade (incorporado a outro bem sem poder ser retirado sem prejuízo), transformabilidade (adquirido para transformação). Só é PERMANENTE (4.4.90.52) se não atender a nenhum.
2. Peça de reposição com a mesma configuração → 3.3.90.30; peça para bem novo, melhoria ou adição complementar → 4.4.90.30.
3. Melhoria (aumenta capacidade/vida útil) → capital (4.4.90.xx); manutenção → corrente (3.3.90.xx).
4. Pen-drive, caneta óptica e similares → 3.3.90.30 (fragilidade).
5. Livros para biblioteca pública → consumo (Lei 10.753/2003, art. 18); demais livros → 4.4.90.52.
6. Material por encomenda: só é serviço (36/39) se o órgão fornecer a matéria-prima; senão 52 ou 30. Vale a essência, não a nota fiscal.
7. Reparos, pinturas, reformas de imóveis sem ampliação → serviço (36/39); ampliação relevante → 4.4.90.51.
8. Telefonia sem pacote de dados → 39; com pacote de dados/internet → 40. Token → 40.
9. Serviços de TIC por PJ (locação de equipamentos e softwares, SaaS, nuvem, hospedagem, suporte, manutenção de equipamentos de TIC, outsourcing de impressão, digitalização) → 40. Desenvolvimento e aquisição de software → 4.4.90.40.
10. Bens/serviços para distribuição gratuita à população → 32 (premiações → 31). Medicamento entregue ao paciente (farmácia básica, demanda judicial) → distribuição gratuita; medicamento usado na unidade de saúde → material de consumo.
11. Quantitativo de pessoal especificado no contrato → 37; sem quantitativo → 39. Fornecedor PF → 36; PJ → 39. Consultoria/auditoria → 35.
12. Evitar "outros" (99) quando houver subelemento específico. Modalidade padrão 90.`;
/** Justificativa sem citar normas (27/11/2026): a IA continua seguindo as mesmas regras (Lei 4.320/64, Portaria 448/2002,
    MCASP, tabelas), mas o texto da "justificativa" mostrado na tela explica só pelas características do item. */
const JUST_RULE = `Na "justificativa", explique em linguagem simples, pelas características do item e pelos critérios aplicados, SEM citar normas (leis, portarias, instruções normativas, manuais como o MCASP, nem números de artigos). As regras acima continuam valendo para escolher o código.`;
/** Regras específicas do ES (Tabela TCE-ES 2027 e Tabela Auxiliar 22). */
const RULES_ES = `
REGRAS ESPECÍFICAS DA TABELA TCE-ES 2027:
- Gêneros alimentícios → 3.3.90.30.07 (exceto merenda) ou 3.3.90.30.61 (merenda escolar). Refeições preparadas por PJ → 3.3.90.39.33.
- Uniforme escolar → 3.3.90.30.62; demais uniformes → 3.3.90.30.23.
- Medicamentos na unidade de saúde → 3.3.90.30.09; para uso domiciliar → 3.3.90.32.02.
- Equipamentos de TIC: 4.4.90.52.41 computadores e notebooks, .43 servidores/storage, .45 impressoras, .46 ativos de rede, .47 telefonia; 4.4.90.52.19 processamento de dados em geral.`;

/* ---------- Busca local ---------- */
/** Busca local por palavra-chave nos subelementos do ES: devolve os n mais parecidos.
    É a etapa de "busca" do RAG caseiro — restringe o catálogo enviado à IA. */
function score(q, n=18){
  const qt = toks(q); if(!qt.length) return [];
  return KB.itens.filter(i=>i.u).map(i=>{
    let s=0; for(const w of qt){ if(i._t.has(w)) s+=4; if(i._x.has(w)) s+=3; if(i._d.has(w)) s+=1; }
    return {i,s};
  }).filter(o=>o.s>0).sort((a,b)=>b.s-a.s).slice(0,n).map(o=>o.i);
}
/** Mesma busca local, na base federal (estados fora do ES). */
function scoreFed(q, n=12){
  const qt = toks(q); if(!qt.length) return [];
  return KB.federal.map(i=>{ let s=0; for(const w of qt){ if(i._t.has(w)) s+=4; if(i._x.has(w)) s+=3; if(i._d.has(w)) s+=1; } return {i,s}; })
    .filter(o=>o.s>0).sort((a,b)=>b.s-a.s).slice(0,n).map(o=>o.i);
}
const byCode = c => KB.itens.find(i=>i.c===c);
const elOf = c => (c||'').split('.').slice(0,4).join('.');

/* ---------- Catálogos para o prompt ---------- */
/** Elementos possíveis por TIPO informado na planilha (Material × Serviço). */
const TIPO_ELEMS = {
  'Material': ['3.3.90.30','3.3.90.31','3.3.90.32','4.4.90.30','4.4.90.52'],
  'Serviço': ['3.3.90.33','3.3.90.35','3.3.90.36','3.3.90.37','3.3.90.38','3.3.90.39','3.3.90.40','4.4.90.35','4.4.90.36','4.4.90.39','4.4.90.40','4.4.90.51']
};
/** Texto do catálogo TCE-ES (código | título) restrito aos elementos pedidos — vai no prompt. */
function catalogES(elems){
  const list = KB.itens.filter(i=>i.u && (!elems || elems.has(elOf(i.c))));
  return list.map(i=>`${i.c} | ${i.t}`).join('\n');
}
/** Texto do catálogo federal de elementos — vai no prompt fora do ES. */
function catalogFed(tipo, uf = UFATUAL()){
  const ok = tipo ? tipoElems(tipo, uf) : elemsOk(uf);
  const sub = KB.federal.filter(f=>ok.includes(f.e)).map(f=>`${f.e} | ${f.n}`).join('\n');
  const els = elemsOk(uf).filter(e=>ok.includes(e)).map(e=>`${e} | ${elName(e)}`).join('\n');
  return `ELEMENTOS VÁLIDOS:\n${els}\n\nSUBELEMENTOS DE REFERÊNCIA (nome, sem código; elemento | nome):\n${sub}`;
}
/** Elementos prováveis pela unidade (ex.: ampola → grupo fármaco → 3.3.90.30/32). */
function unitGroupElems(u){
  if(!u || u.status!=='ok') return null;
  const g = KB.u2grp[u.c]; return g ? KB.grupos[g] : null;
}


/* ---------- Contas de bens imóveis e obras (item 2.3; na IA fora do ES desde 27/11/2026) ----------
   Fora do ES não há subelemento: a IA escolhe a conta na lista aprovada (KB.imoveis) e a página confere se ela
   combina com o elemento (IMOVEL_GRUPO). No ES a conta sai do subelemento e esta lista não vai no pedido. */
const IMOVEL_GRUPO = { '4.4.90.61': /^1\.2\.3\.2\.1\.01\./, '4.5.90.61': /^1\.2\.3\.2\.1\.04\./, '4.4.90.51': /^1\.2\.3\.2\.1\.0[678]\./ };
const contasImoveisTxt = () => (KB.imoveis || []).map(c=>`${c.c} ${c.n}`).join('\n');
const REGRA_CONTA_IMOVEL = 'Para obras e imóveis, "conta" é a da lista de BENS IMÓVEIS E OBRAS: elemento 4.4.90.61 (imóvel para uso do órgão) → bens de uso especial (1.2.3.2.1.01.xx); 4.5.90.61 (inversão financeira) → bens dominicais (1.2.3.2.1.04.xx); 4.4.90.51 → obras em andamento, estudos e projetos, instalações ou benfeitorias (1.2.3.2.1.06/07/08). Terreno → a conta de terrenos do grupo. Para obras e imóveis a "conta" é OBRIGATÓRIA: nunca null.';

/* ---------- Norma geral fora do ES (28/11/2026, pedido de Sanada) ----------
   Regra geral: todos os estados seguem o MCASP atualizado (edição vigente; em 2026, a 11ª). EXCEÇÃO: o Espírito Santo,
   que tem normativa e regulamento próprios (Tabela de Natureza da Despesa do TCE-ES) — por isso este bloco NÃO vai no
   pedido do ES (o pedido do ES continua idêntico e o cache dele segue valendo).
   Terreno: vida útil ilimitada, não deprecia (NBC TSP 07 e MCASP), mesmo comprado junto com edificação; nesse caso o
   valor do terreno é registrado separado e só a edificação deprecia. */
const NORMA_FED = `
NORMA GERAL DESTE ESTADO: aplique o MCASP atualizado (edição vigente) em tudo: conceito dos elementos, critérios de consumo × permanente, ativo imobilizado e depreciação. (Exceção: o Espírito Santo segue normativa e regulamento próprios; não é o caso deste pedido.)
TERRENOS: não sofrem depreciação (vida útil ilimitada), mesmo quando adquiridos junto com edificações; nesse caso o valor do terreno é registrado separado do valor da edificação, e só a edificação deprecia. Para terreno, use sempre a conta de terrenos do grupo.`;

/* ---------- Pedido da consulta individual ---------- */
/** Monta o pedido da consulta individual: regras + catálogo (restrito ou federal) + dados do item
    + formato JSON exigido (código, confiança, quiz, texto sugerido...). */
function buildPrompt(st, uf = UFATUAL()){
  const {item, ctx, forn, desp, extra, un} = st;
  const el = elemConceitos(uf).map(([k,v])=>`${k} – ${v.n}: ${v.c}`).join('\n');
  const head = `ITEM: ${item}\nFINALIDADE/DETALHES: ${ctx||'não informado'}\nUNIDADE: ${un||'não informada'}\nFORNECEDOR: ${forn||'não informado'}\nTIPO DE DESPESA: ${desp||'não informado'}\n${extra?'RESPOSTA DO USUÁRIO À PERGUNTA ANTERIOR: '+extra:''}`;
  if(uf === 'ES'){
    const cand = score([item,ctx,extra].join(' ')).map(i=>`${i.c} — ${i.t}\n  Descrição: ${i.d||'—'}\n  Exemplos: ${(i.x||'—').slice(0,600)}`).join('\n');
    return `Você classifica itens de compras públicas municipais do Espírito Santo na natureza de despesa (até o subelemento), usando EXCLUSIVAMENTE códigos da Tabela de Natureza da Despesa TCE-ES 2027.

${RULES}
${RULES_ES}

CONCEITO DOS ELEMENTOS (MCASP):
${el}

CANDIDATOS MAIS PRÓXIMOS (busca na base):
${cand || '(nenhum por palavra-chave)'}

CATÁLOGO DE SUBELEMENTOS VÁLIDOS (código | título):
${catalogES()}

${head}

Instruções: escolha UM código do catálogo, nunca invente. Para material, avalie os cinco critérios da regra 1. Se finalidade, fornecedor ou tipo de despesa puderem mudar o código e não foram informados, use a hipótese mais comum e confiança "média" ou "baixa". Se a confiança for "média" ou "baixa", monte um QUIZ em "quiz": uma pergunta objetiva sobre o fator que decide a classificação (finalidade, uso, forma de fornecimento etc.) e de 2 a 4 opções curtas, cada uma ligada ao código do catálogo que vale se o usuário escolher aquela opção (códigos diferentes entre si). Se a confiança for "alta", "quiz" = null. Alternativas: até 3 códigos do catálogo com a condição. Justificativa: 2 a 4 frases citando a regra ou ementa. Se a unidade informada for incompatível com o item, explique em "alerta_unidade".
${TEXT_RULE} Na consulta, "texto_sugerido" é a versão revisada do "Nome ou descrição do item".
${JUST_RULE}
Responda SOMENTE com JSON:
{"item_interpretado":"...","codigo":"x.x.90.xx.xx","justificativa":"...","regras":["..."],"criterios":{"durabilidade":null,"fragilidade":null,"perecibilidade":null,"incorporabilidade":null,"transformabilidade":null},"confianca":"alta|média|baixa","alternativas":[{"codigo":"...","quando":"..."}],"quiz":{"pergunta":"...","opcoes":[{"texto":"...","codigo":"..."}]},"alerta_unidade":null,"texto_sugerido":null,"falta":[]}`;
  }
  const cand = scoreFed([item,ctx,extra].join(' ')).map(f=>`${f.e} | ${f.n}\n  Descrição: ${f.d||'—'}\n  Exemplos: ${(f.x||'—').slice(0,500)}`).join('\n');
  return `Você classifica itens de compras públicas municipais (estado: ${UFS[uf]}) na natureza de despesa pela base FEDERAL de referência (Portaria STN 448/2002, MCASP 11ª ed.). Não há tabela estadual carregada para este estado: classifique até o ELEMENTO (código x.x.90.ee) e indique o subelemento apenas pelo NOME de referência, sem código.

${RULES}${RULES_UF[uf]||''}${NORMA_FED}

CONCEITO DOS ELEMENTOS (MCASP):
${el}

CANDIDATOS MAIS PRÓXIMOS:
${cand || '(nenhum por palavra-chave)'}

${catalogFed(null, uf)}

CONTAS CONTÁBEIS (PCASP 2027) – material de consumo (estoque/almoxarifado):
${KB.almox.map(c=>`${c.c} ${c.n}`).join('\n')}

CONTAS CONTÁBEIS (PCASP 2027) – material permanente (bens móveis):
${KB.bensmoveis.map(c=>`${c.c} ${c.n}`).join('\n')}

CONTAS CONTÁBEIS (PCASP 2027) – bens imóveis e obras:
${contasImoveisTxt()}

${head}

Instruções: "codigo" deve ser um dos ELEMENTOS VÁLIDOS. "subelemento" é o nome de referência (ou null se não houver). "conta": para MATERIAL, a conta contábil do PCASP 2027 que corresponde ao item, escolhida nas listas acima (material de consumo → almoxarifado; material permanente → bens móveis); ${REGRA_CONTA_IMOVEL} Para os demais SERVIÇOS, null. Para material, avalie os cinco critérios. Se a confiança for "média" ou "baixa", monte um QUIZ em "quiz": uma pergunta objetiva sobre o fator que decide a classificação (finalidade, uso, forma de fornecimento etc.) e de 2 a 4 opções curtas, cada uma ligada ao elemento válido que vale se o usuário escolher aquela opção (códigos diferentes entre si) e à "conta" que vale com aquela opção, pelas mesmas regras acima (null para serviço que não seja obra). Se a confiança for "alta", "quiz" = null. Alternativas: até 3 elementos com a condição.
${TEXT_RULE} Na consulta, "texto_sugerido" é a versão revisada do "Nome ou descrição do item".
${JUST_RULE}
Responda SOMENTE com JSON:
{"item_interpretado":"...","codigo":"x.x.90.ee","subelemento":"...","conta":"x.x.x.x.x.xx.xx ou null","justificativa":"...","regras":["..."],"criterios":{"durabilidade":null,"fragilidade":null,"perecibilidade":null,"incorporabilidade":null,"transformabilidade":null},"confianca":"alta|média|baixa","alternativas":[{"codigo":"...","quando":"..."}],"quiz":{"pergunta":"...","opcoes":[{"texto":"...","codigo":"...","conta":"x.x.x.x.x.xx.xx ou null"}]},"alerta_unidade":null,"texto_sugerido":null,"falta":[]}`;
}


/* ---------- Pedido do importador (lote) ---------- */
/** Monta o pedido de um lote (até BATCH = 30 itens do mesmo TIPO): regras + catálogo restrito (RAG) +
    itens com finalidade informada + contas contábeis + formato JSON. full=true usa o catálogo completo. */
function batchPrompt(gs, full, uf = (typeof IMP !== 'undefined' && IMP ? IMP.uf : '')){
  const es = uf === 'ES';
  const tipo = gs[0].tipo, okEl = new Set(tipoElems(tipo, uf));
  let elems = new Set(okEl);
  if(es && !full){
    const cand = new Set(); let weak = false;
    for(const g of gs){
      const ge = (unitGroupElems({status:'ok', c:g.u.c})||[]).filter(e=>okEl.has(e)); ge.forEach(e=>cand.add(e));
      const c = score([g.tit,g.des].join(' '), 8).filter(i=>okEl.has(elOf(i.c)));
      if(!c.length && !ge.length) weak = true;
      c.forEach(i=>cand.add(elOf(i.c)));
    }
    if(!weak && cand.size) elems = cand;
  }
  const restrito = elems.size < okEl.size;
  const elTxt = elemConceitos(uf).filter(([k])=>[...elems].some(e=>e.endsWith('.'+k))).map(([k,v])=>`${k} – ${v.n}: ${v.c.slice(0,350)}`).join('\n');
  const itens = gs.map((g,n)=>`${n+1} | ${g.tit} | ${g.des} | unidade: ${g.u&&g.u.c?g.u.c+' ':''}${g.u?g.u.n:(g.un||'')}${g.finalidade?` | finalidade informada pelo usuário: ${g.finalidade==='Distribuição gratuita'?'DISTRIBUIÇÃO GRATUITA à população':'USO INTERNO do órgão'}`:''}`).join('\n');
  const temFin = gs.some(g=>g.finalidade);
  const comPerm = elems.has('4.4.90.52');
  const contas = tipo !== 'Material' ? '' : 'CONTAS CONTÁBEIS (PCASP 2027) – material de consumo (estoque/almoxarifado):\n' + KB.almox.map(c=>`${c.c} ${c.n}`).join('\n')
    + (comPerm ? '\n\nCONTAS CONTÁBEIS (PCASP 2027) – material permanente (bens móveis):\n' + KB.bensmoveis.map(c=>`${c.c} ${c.n}`).join('\n') : '');
  /* Fora do ES, lote de SERVIÇO que pode ter obras (4.4.90.51): vai a lista de bens imóveis e obras */
  const comObra = !es && tipo === 'Serviço' && elems.has('4.4.90.51');
  const contasObra = comObra ? 'CONTAS CONTÁBEIS (PCASP 2027) – bens imóveis e obras:\n' + contasImoveisTxt() : '';
  return `Você classifica itens de compras públicas municipais (${es?'Espírito Santo, Tabela de Natureza da Despesa TCE-ES 2027, até o subelemento':`${UFS[uf]}, base federal de referência, até o ELEMENTO`}).

${RULES}${es?RULES_ES:(RULES_UF[uf]||'')+NORMA_FED}

ELEMENTOS (MCASP):
${elTxt}

TIPO DOS ITENS (informado pelo usuário): ${tipo.toUpperCase()}

${es?`CATÁLOGO DE ${tipo.toUpperCase()} (código | título)${restrito?' – restrito aos elementos prováveis destes itens':''}:\n${catalogES(elems)}`:catalogFed(tipo, uf)}

ITENS (nº | título | descrição | unidade):
${itens}

${contas}${contasObra}

Para cada item, escolha ${es?'um código do catálogo':'um elemento válido'}; nunca invente código.${temFin?' Quando a finalidade vier informada pelo usuário, ela é obrigatória: DISTRIBUIÇÃO GRATUITA → elemento 3.3.90.32; USO INTERNO → não use 3.3.90.32.':''}${es&&restrito?' Se nenhum código do catálogo servir, responda "fora_do_catalogo": true.':''}${tipo==='Material'?' Identifique pelo título se o item é material de consumo ou permanente e escolha a conta contábil na lista correspondente (prefira a conta analítica mais específica).':(comObra ? ' Obras (4.4.90.51): "conta" da lista de bens imóveis e obras (em andamento, estudos e projetos, instalações ou benfeitorias); demais itens de serviço: "conta" vazia.' : ' Itens de serviço: "conta" vazia.')}
${TEXT_RULE} No lote, use "titulo_sugerido" e "descricao_sugerida" (até 400 caracteres) para o título e a descrição de cada item.
Se um item claramente for ${tipo==='Material'?'SERVIÇO':'MATERIAL'} e não ${tipo.toUpperCase()} (o TIPO informado está errado), NÃO o classifique: responda "codigo": null e "tipo_sugerido": "${tipo==='Material'?'Serviço':'Material'}" (mantenha os campos de texto). Na dúvida, classifique normalmente.
Responda SOMENTE com um array JSON, um objeto por item, na mesma ordem:
${es?'[{"n":1,"codigo":"x.x.90.xx.xx","conta":"x.x.x.x.x.xx.xx","titulo_sugerido":null,"descricao_sugerida":null,"falta":[]}]':'[{"n":1,"codigo":"x.x.90.ee","subelemento":"nome de referência ou vazio","conta":"x.x.x.x.x.xx.xx","titulo_sugerido":null,"descricao_sugerida":null,"falta":[]}]'}`;
}


/* ======================= Parte 2: servidor/worker-base.js ======================= */
/**
 * Servidor do Classificador de Natureza de Despesa (Cloudflare Workers)
 *
 * FONTE do Worker. O arquivo colado no Cloudflare é o servidor/worker.js, GERADO por
 *   node servidor/montar-worker.mjs
 * que junta este arquivo com o prompt.js da raiz (montagem do pedido à IA, a mesma da página).
 *
 * Rotas (todas POST, JSON):
 *   /classificar  { campos, ts }               -> consulta individual (gratuita; ts = token Turnstile)
 *   /lote         { campos, chave?, arquivo }  -> importador: com chave Pro válida, sem limite; sem chave,
 *                                                 conta 1 importação por arquivo e IP (IMPORT_LIMIT/dia),
 *                                                 ou recusa se PRO_OBRIGATORIO=true; devolve "restantes"
 *   /licenca      { hash }            -> verifica uma chave Pro
 *   GET /versao                       -> { versao } (confere se o Worker no ar é o do GitHub)
 *
 * Fase 3 do levantamento (item 1.2, 27/11/2026): a página manda só os CAMPOS (Estado, item, unidade...) e o
 * Worker monta o pedido com o prompt.js e a base kb.json do site. Campos têm tamanho máximo, e o código
 * devolvido pela IA é conferido (fora da tabela → "codigo_invalido": true e não vai para o cache).
 * Transição: enquanto ACEITAR_PROMPT_LIVRE não for "false", o Worker ainda aceita o formato antigo
 * { prompt } (página antiga em cache no navegador). Depois de uns dias, criar ACEITAR_PROMPT_LIVRE = false.
 *
 * Configuração no painel do Cloudflare:
 *   Segredo  ANTHROPIC_API_KEY  chave da API da Anthropic (obrigatório)
 *   Variável ALLOWED_ORIGIN     endereço da página, ex.: https://thiagosnd2.github.io
 *   Variável MODEL              opcional; padrão claude-haiku-5-5
 *   KV       LICENCAS           chaves Pro: nome = hash da chave, valor = JSON
 *   Rate limit RL               opcional; limita consultas por IP
 *   Segredo  TURNSTILE_SECRET   opcional; exige a verificação anti-robô na consulta individual
 *   Variável DAILY_LIMIT        opcional; teto de chamadas à IA por dia (todas as pessoas somadas). Sem
 *                               DAILY_LIMIT_LOTE, vale para consulta e importação juntas (como antes)
 *   Variável DAILY_LIMIT_LOTE   opcional; teto próprio da importação (chave "usol:"); com ele, DAILY_LIMIT
 *                               passa a valer só para a consulta individual
 *   Variável LOTES_POR_PLANILHA opcional; máximo de lotes por planilha (padrão 20 = 17 para 500 itens + folga)
 *   Variável KB_URL             opcional; endereço do kb.json (padrão https://classificabr.com/kb.json)
 *   Variável ACEITAR_PROMPT_LIVRE  "false" = recusa pedidos no formato antigo { prompt } (fim da transição)
 *   Variável PRO_OBRIGATORIO    "true" = importador só com chave Pro; ausente/"false" = Pro suspenso,
 *                               importação liberada com limite diário por IP
 *   Variável IMPORT_LIMIT       importações por dia por IP quando o Pro está suspenso (padrão 5)
 *
 * Estabilidade: a consulta individual tem cache de 30 dias no KV (respostas de confiança alta; veja
 * chaveDoCache/CACHE_VERSAO). O parâmetro temperature foi retirado em 27/11/2026: o modelo claude-haiku-5-5
 * o recusa, e a tentativa com ele dobrava as chamadas.
 *
 * Fase 2 do levantamento (27/11/2026):
 *  1.1 cada planilha tem no máximo LOTES_POR_PLANILHA lotes, presos ao IP que a enviou, e a primeira chamada
 *      de cada planilha passa pela verificação anti-robô (se TURNSTILE_SECRET estiver configurado);
 *  1.3 se o contador do teto não puder ser lido ou gravado, o pedido é recusado (antes seguia sem contar);
 *  1.4 teto separado para a importação (DAILY_LIMIT_LOTE);
 *  1.5 sem temperature;
 *  5.2 rota GET /versao com WORKER_VERSAO.
 */

/* Versão deste arquivo: atualizar a cada mudança (AAAA.MM.DD-n). GET /versao devolve este valor. */
const WORKER_VERSAO = '2026.11.28-4';

/* Prefixo do hash das chaves Pro (o mesmo usado na página e nos scripts). */
const PREFIXO = 'qw-classificador:';
/* Limites por rota: tamanho máximo do pedido (caracteres) e da resposta da IA (tokens). */
const LIM = {
  classificar: { chars: 120000, maxTokens: 4000 },
  lote:        { chars: 300000, maxTokens: 12000 },
};
/* Instrução de sistema enviada à IA em toda chamada: resposta só em JSON. */
const SISTEMA = 'Você é um classificador de natureza de despesa pública brasileira. Responda SOMENTE com JSON válido, sem texto antes ou depois e sem blocos de código.';

/* Ponto de entrada do Worker: trata CORS, confere origem e limite por IP e despacha para as rotas. */
export default {
  async fetch(req, env) {
    const origem = req.headers.get('Origin') || '';
    const permitida = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigem = permitida.length === 0 || permitida.includes(origem);
    const cors = {
      'Access-Control-Allow-Origin': okOrigem && origem ? origem : (permitida[0] || '*'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin',
    };
    const resp = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // Versão do Worker (GET, sem dados sensíveis): para conferir se o que está no ar é o do GitHub
    if (req.method === 'GET' && new URL(req.url).pathname.replace(/\/+$/, '') === '/versao') return resp(200, { versao: WORKER_VERSAO });
    if (req.method !== 'POST') return resp(405, { erro: 'Método não permitido' });
    if (!okOrigem) return resp(403, { erro: 'Origem não autorizada' });

    const rota = new URL(req.url).pathname.replace(/\/+$/, '');
    let corpo;
    try { corpo = await req.json(); } catch { return resp(400, { erro: 'JSON inválido' }); }

    // Limite por IP (se o binding RL estiver configurado)
    if (env.RL && rota !== '/licenca') {
      const ip = req.headers.get('CF-Connecting-IP') || 'anon';
      const { success } = await env.RL.limit({ key: ip });
      if (!success) return resp(429, { erro: 'Muitas consultas seguidas' });
    }

    try {
      if (rota === '/licenca') {
        const hash = String(corpo.hash || '');
        if (!/^[0-9a-f]{64}$/.test(hash)) return resp(400, { erro: 'Hash inválido' });
        const dados = await lerLicenca(env, hash);
        return resp(200, dados ? { existe: true, dados } : { existe: false });
      }

      if (rota === '/classificar' || rota === '/lote') {
        const tipo = rota.slice(1);
        // Item 1.2: com "campos", o pedido é montado aqui (prompt.js); sem eles, só no período de transição
        let prompt = '', campos = null;
        if (corpo.campos) {
          try { await carregarKB(env); } catch { return resp(503, { erro: 'Base de classificação indisponível. Tente de novo em alguns minutos' }); }
          const v = tipo === 'classificar' ? validarCamposConsulta(corpo.campos) : validarCamposLote(corpo.campos);
          if (v.erro) return resp(400, { erro: v.erro });
          campos = v.campos;
          prompt = tipo === 'classificar' ? buildPrompt(campos, campos.uf) : batchPrompt(campos.itens, campos.full, campos.uf);
        } else {
          if (env.ACEITAR_PROMPT_LIVRE === 'false') return resp(400, { erro: 'Página desatualizada. Recarregue com Ctrl + F5' });
          prompt = String(corpo.prompt || '');
        }
        if (!prompt) return resp(400, { erro: 'Prompt vazio' });
        if (prompt.length > LIM[tipo].chars) return resp(413, { erro: 'Pedido grande demais' });

        let restantes = null;
        if (tipo === 'lote') {
          // Com chave Pro válida: sem limite. Sem chave: depende do modo (Pro obrigatório ou suspenso).
          const lic = corpo.chave ? await licencaValida(env, corpo.chave) : null;
          if (!lic) {
            if (env.PRO_OBRIGATORIO === 'true') return resp(403, { erro: 'Chave Pro inválida, vencida ou cancelada' });
            const r = await contarImportacao(env, String(corpo.arquivo || ''), req.headers.get('CF-Connecting-IP') || 'anon', corpo.ts);
            if (!r.ok) return resp(403, { erro: r.erro });
            restantes = r.restantes;
          }
        } else if (env.TURNSTILE_SECRET) {
          const ok = await verificarTurnstile(env, corpo.ts, req.headers.get('CF-Connecting-IP'));
          if (!ok) return resp(403, { erro: 'Verificação anti-robô falhou' });
        }

        // Cache da consulta individual: o mesmo pedido (mesmo item, finalidade, unidade, fornecedor, despesa,
        // Estado e versão da base, que estão todos no prompt) volta com a mesma resposta, sem chamar a IA
        // e sem contar no teto diário. Só guarda respostas de confiança alta.
        const chaveCache = tipo === 'classificar' ? await chaveDoCache(prompt) : null;
        if (chaveCache) {
          const salvo = await lerCache(env, chaveCache);
          if (salvo) return resp(200, { resultado: salvo, cache: true });
        }

        const teto = await dentroDoTeto(env, tipo);
        if (teto === 'falha') return resp(503, { erro: 'Serviço temporariamente indisponível. Tente de novo em alguns minutos' });
        if (!teto) return resp(429, { erro: 'Limite diário de consultas atingido' });

        const resultado = await chamarIA(env, prompt, LIM[tipo].maxTokens);
        if (campos) conferirCodigos(resultado, campos.uf);
        if (chaveCache && resultado && resultado.codigo && !resultado.codigo_invalido && /^alta$/i.test(String(resultado.confianca || '').trim())) {
          await gravarCache(env, chaveCache, resultado);
        }
        return resp(200, restantes === null ? { resultado } : { resultado, restantes });
      }

      return resp(404, { erro: 'Rota não encontrada' });
    } catch (e) {
      const status = e && e.status === 429 ? 429 : 502;
      const motivo = e && e.motivo ? e.motivo : (e && e.status ? `a IA respondeu ${e.status}` : 'erro inesperado');
      console.error('falha IA', rota, motivo);
      return resp(status, { erro: status === 429 ? 'Limite da IA atingido' : `Falha ao consultar a IA (${motivo})` });
    }
  },
};

/* ---------- Fase 3: base, campos e conferência do código ---------- */

/* Base kb.json (a mesma da página), guardada na memória do Worker e relida a cada 10 minutos. */
let KB = null, KB_EM = 0;
async function carregarKB(env) {
  if (KB && Date.now() - KB_EM < 10 * 60e3) return KB;
  const r = await fetch(env.KB_URL || 'https://classificabr.com/kb.json', { cf: { cacheTtl: 300 } });
  if (!r.ok) { if (KB) return KB; throw new Error('kb ' + r.status); }
  KB = prepararKB(await r.json()); KB_EM = Date.now();
  return KB;
}

/* Texto de um campo: string, espaços normalizados, cortado no tamanho máximo. */
const campo = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* Consulta individual: só os campos conhecidos, com tamanho máximo. */
function validarCamposConsulta(c) {
  if (!c || typeof c !== 'object') return { erro: 'Campos inválidos' };
  const uf = campo(c.uf, 2).toUpperCase();
  if (!UFS[uf]) return { erro: 'Estado inválido' };
  const item = campo(c.item, 1000);
  if (!item) return { erro: 'Informe o item' };
  return { campos: { uf, item, ctx: campo(c.ctx, 1000), forn: campo(c.forn, 100), desp: campo(c.desp, 100),
    extra: campo(c.extra, 1500), un: campo(c.un, 60) } };
}

/* Lote: até 30 itens do mesmo TIPO (Material ou Serviço), com tamanho máximo por campo. */
function validarCamposLote(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.itens)) return { erro: 'Campos inválidos' };
  const uf = campo(c.uf, 2).toUpperCase();
  if (!UFS[uf]) return { erro: 'Estado inválido' };
  if (!c.itens.length || c.itens.length > 30) return { erro: 'Lote com quantidade de itens inválida' };
  const tipo = campo(c.itens[0].tipo, 10);
  if (!TIPO_ELEMS[tipo]) return { erro: 'TIPO inválido' };
  if (c.itens.some(g => campo(g && g.tipo, 10) !== tipo)) return { erro: 'Itens de TIPOS diferentes no mesmo lote' };
  const itens = c.itens.map(g => ({
    tipo, tit: campo(g.tit, 1000), des: campo(g.des, 400), un: campo(g.un, 60),
    u: g.u ? { c: campo(g.u.c, 3), n: campo(g.u.n, 80) } : null,
    finalidade: ['Distribuição gratuita', 'Uso interno'].includes(g.finalidade) ? g.finalidade : '',
  }));
  return { campos: { uf, full: !!c.full, itens } };
}

/* Confere se o código devolvido existe: no ES, subelemento utilizável da tabela TCE-ES; fora dele, elemento
   válido no Estado. Não troca a resposta: só marca "codigo_invalido": true (a página já avisa). */
function codigoValido(cod, uf) {
  if (!cod) return true; // sem código = TIPO a corrigir ou fora do catálogo; a página trata
  if (uf === 'ES') return KB.itens.some(i => i.c === cod && i.u);
  return elemsOk(uf).includes(cod);
}
function conferirCodigos(res, uf) {
  for (const r of Array.isArray(res) ? res : [res]) if (r && typeof r === 'object' && !codigoValido(r.codigo, uf)) r.codigo_invalido = true;
}

/* Confere o token anti-robô no serviço do Cloudflare (só se TURNSTILE_SECRET estiver configurado). */
async function verificarTurnstile(env, token, ip) {
  if (!token) return false;
  const f = new FormData();
  f.append('secret', env.TURNSTILE_SECRET);
  f.append('response', String(token));
  if (ip) f.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}

/* Limite de importações (Pro suspenso), em duas camadas:
   (a) por IP e por dia: cada planilha enviada tem um id próprio; até IMPORT_LIMIT planilhas por dia;
   (b) por planilha (item 1.1, 27/11/2026): registro "lote:<id>" com o IP que a enviou e quantos lotes já usou.
       Até LOTES_POR_PLANILHA lotes; outro IP não pode usar o mesmo id. Na PRIMEIRA chamada de uma planilha,
       exige o token anti-robô (se TURNSTILE_SECRET estiver configurado).
   Se o KV não puder ser lido ou gravado, a importação é recusada (antes seguia sem contar). */
async function contarImportacao(env, arquivo, ip, ts) {
  const lim = Number(env.IMPORT_LIMIT || 5);
  const maxLotes = Number(env.LOTES_POR_PLANILHA || 20);
  if (!/^[\w.-]{8,64}$/.test(arquivo)) return { ok: false, erro: 'Importação sem identificação; recarregue a página e envie a planilha de novo' };
  if (!env.LICENCAS) return { ok: true, restantes: null };
  const kLote = 'lote:' + arquivo, kIp = 'imp:' + ip + ':' + diaBrasilia();
  let rec, ids;
  try {
    rec = JSON.parse((await env.LICENCAS.get(kLote)) || 'null');
    ids = JSON.parse((await env.LICENCAS.get(kIp)) || '[]');
  } catch { return { ok: false, erro: 'Serviço temporariamente indisponível. Tente de novo em alguns minutos' }; }
  if (!rec) {
    // Planilha nova: verificação anti-robô e limite de planilhas por IP no dia
    if (env.TURNSTILE_SECRET && !(await verificarTurnstile(env, ts, ip))) return { ok: false, erro: 'Verificação anti-robô falhou. Envie a planilha de novo' };
    if (ids.length >= lim) return { ok: false, erro: `Limite de ${lim} importações por dia atingido. Tente novamente amanhã` };
    ids.push(arquivo);
    rec = { ip, n: 0 };
    try { await gravarKV(env, kIp, JSON.stringify(ids), 2 * 86400); }
    catch { return { ok: false, erro: 'Serviço temporariamente indisponível. Tente de novo em alguns minutos' }; }
  }
  if (rec.ip !== ip) return { ok: false, erro: 'Esta importação começou em outra conexão. Envie a planilha de novo' };
  if (rec.n >= maxLotes) return { ok: false, erro: 'Esta planilha já usou todos os lotes permitidos. Envie a planilha de novo' };
  rec.n++;
  try { await gravarKV(env, kLote, JSON.stringify(rec), 2 * 86400); }
  catch { return { ok: false, erro: 'Serviço temporariamente indisponível. Tente de novo em alguns minutos' }; }
  return { ok: true, restantes: Math.max(0, lim - ids.length) };
}

/* Grava no KV tentando até 3 vezes, com 1,1 s entre as tentativas. O KV aceita só 1 gravação por segundo na
   MESMA chave (vale nos dois planos), e o importador manda 2 lotes em paralelo que gravam as mesmas chaves
   ("lote:<id>" e o teto). Só depois das 3 tentativas a falha sobe (e o pedido é recusado, item 1.3). */
async function gravarKV(env, k, v, ttl) {
  for (let t = 0; ; t++) {
    try { return await env.LICENCAS.put(k, v, { expirationTtl: ttl }); }
    catch (e) { if (t >= 2) throw e; await new Promise(r => setTimeout(r, 1100)); }
  }
}

function diaBrasilia() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }

/* Teto diário aproximado (contador no KV; a contagem pode escapar em poucas unidades com muitos acessos
   simultâneos). No plano gratuito o KV aceita 1.000 gravações por dia.
   Devolve true (pode seguir), false (teto atingido) ou 'falha' (KV sem leitura/gravação: recusa, item 1.3).
   Com DAILY_LIMIT_LOTE, a importação tem contador próprio ("usol:"); sem ele, tudo conta em "uso:" (como antes). */
async function dentroDoTeto(env, tipo) {
  const separado = tipo === 'lote' && Number(env.DAILY_LIMIT_LOTE || 0) > 0;
  const lim = separado ? Number(env.DAILY_LIMIT_LOTE) : Number(env.DAILY_LIMIT || 0);
  if (!lim || !env.LICENCAS) return true;
  const k = (separado ? 'usol:' : 'uso:') + diaBrasilia();
  let n;
  try { n = Number((await env.LICENCAS.get(k)) || 0); } catch { console.error('teto: KV sem leitura'); return 'falha'; }
  if (n >= lim) return false;
  try { await gravarKV(env, k, String(n + 1), 3 * 86400); }
  catch { console.error('teto: KV sem gravação'); return 'falha'; }
  return true;
}

/* Lê a licença no KV pelo hash da chave; devolve o JSON ou null. */
async function lerLicenca(env, hash) {
  if (!env.LICENCAS) return null;
  const v = await env.LICENCAS.get(hash);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

/* SHA-256 da chave normalizada — igual ao cálculo feito na página. */
async function hashChave(chave) {
  const norm = String(chave || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PREFIXO + norm));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Licença válida = existe, não está cancelada (ativa !== false) e não venceu. */
async function licencaValida(env, chave) {
  if (!chave) return null;
  const d = await lerLicenca(env, await hashChave(chave));
  if (!d || d.ativa === false) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  if (d.validade && d.validade < hoje) return null;
  return d;
}

/* ---------- Cache de respostas da consulta individual (KV LICENCAS, prefixo "cache:") ----------
   Chave = SHA-256 do prompt normalizado (minúsculas, espaços únicos) + CACHE_VERSAO. Mudar CACHE_VERSAO
   descarta o cache inteiro (ex.: nova tabela do TCE-ES ou mudança nas regras). Validade: 30 dias.
   Falha no KV nunca derruba a consulta: sem cache, segue para a IA. */
const CACHE_VERSAO = 'v1';
async function chaveDoCache(prompt) {
  const norm = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CACHE_VERSAO + '|' + norm));
  return 'cache:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function lerCache(env, chave) {
  if (!env.LICENCAS) return null;
  try { const v = await env.LICENCAS.get(chave); return v ? JSON.parse(v) : null; } catch { return null; }
}
async function gravarCache(env, chave, resultado) {
  if (!env.LICENCAS) return;
  try { await env.LICENCAS.put(chave, JSON.stringify(resultado), { expirationTtl: 30 * 86400 }); } catch {}
}

/* Chama a API da Anthropic com a chave secreta, detecta resposta cortada e extrai o JSON.
   Sem temperature desde 27/11/2026 (o claude-haiku-5-5 recusa o parâmetro; a estabilidade vem do cache).
   Em erro, o motivo leva o status e o tipo/mensagem curta da Anthropic (sem dados do pedido). */
async function chamarIA(env, prompt, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-haiku-5-5',
      max_tokens: maxTokens,
      system: SISTEMA,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) {
    let erro = '';
    try { const e = await r.json(); erro = String((e.error && (e.error.message || e.error.type)) || '').slice(0, 160); } catch {}
    throw { status: r.status, motivo: r.status === 529 ? 'IA sobrecarregada, tente de novo' : `a IA respondeu ${r.status}${erro ? ': ' + erro : ''}` };
  }
  const j = await r.json();
  const texto = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  if (j.stop_reason === 'max_tokens') throw { status: 502, motivo: 'resposta da IA cortada por tamanho' };
  try { return extrairJSON(texto); }
  catch { throw { status: 502, motivo: 'resposta da IA fora do formato' }; }
}

/* Extrai o JSON da resposta mesmo que venha com cercas de código ou texto em volta. */
function extrairJSON(t) {
  const s = String(t).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(s); } catch {}
  const ini = s.search(/[\[{]/);
  if (ini < 0) throw { status: 502 };
  const fecha = s[ini] === '[' ? ']' : '}';
  const fim = s.lastIndexOf(fecha);
  return JSON.parse(s.slice(ini, fim + 1));
}
