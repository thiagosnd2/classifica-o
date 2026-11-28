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

${RULES}${RULES_UF[uf]||''}

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

${RULES}${es?RULES_ES:(RULES_UF[uf]||'')}

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

