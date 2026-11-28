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
 *   Variável LOTES_POR_PLANILHA opcional; máximo de lotes por planilha (padrão 60: 17 para 500 itens + folga para divisões)
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
 *
 * Base de conhecimento no Supabase (28/11/2026, Worker 2026.11.28-7) – opcional: sem as duas variáveis abaixo,
 * o Worker funciona exatamente como antes.
 *   Variável SUPABASE_URL         endereço do projeto (https://<id>.supabase.co)
 *   Segredo  SUPABASE_SECRET_KEY  chave secreta (sb_secret_…), NUNCA no código nem no chat
 *  - antes de chamar a IA, busca no mapa as normas do assunto (buscar_conhecimento) e, na consulta individual,
 *    as respostas parecidas já confirmadas (buscar_resposta); tudo entra no pedido num bloco curto;
 *  - depois, grava as respostas de confiança alta com código conferido da consulta individual (gravar_respostas),
 *    sem atrasar a resposta (o lote não devolve confiança e não grava);
 *  - se o Supabase demorar (mais de 1,5 s) ou falhar, o pedido segue sem o bloco (a base é um reforço, não trava nada).
 */

/* Versão deste arquivo: atualizar a cada mudança (AAAA.MM.DD-n). GET /versao devolve este valor. */
const WORKER_VERSAO = '2026.11.28-7';

/* Prefixo do hash das chaves Pro (o mesmo usado na página e nos scripts). */
const PREFIXO = 'qw-classificador:';
/* Limites por rota: tamanho máximo do pedido (caracteres) e da resposta da IA (tokens). */
const LIM = {
  /* 28/11/2026: o claude-haiku-5-5 pensa antes de responder (raciocínio adaptativo) e esse raciocínio conta dentro do
     max_tokens; com limites baixos a resposta era cortada. O modelo aceita até 128 mil tokens de saída. */
  classificar: { chars: 120000, maxTokens: 16000 }, // era 4000
  lote:        { chars: 300000, maxTokens: 32000 }, // 28/11/2026: era 12000 e cortava lotes de 30 itens com textos sugeridos
};
/* Instrução de sistema enviada à IA em toda chamada: resposta só em JSON. */
const SISTEMA = 'Você é um classificador de natureza de despesa pública brasileira. Responda SOMENTE com JSON válido, sem texto antes ou depois e sem blocos de código.';

/* Ponto de entrada do Worker: trata CORS, confere origem e limite por IP e despacha para as rotas. */
export default {
  async fetch(req, env, ctx) {
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
          // Base de conhecimento (Supabase): normas do assunto e respostas já confirmadas; vazio se não houver
          const base = await blocoBase(env, tipo, campos);
          prompt = tipo === 'classificar' ? buildPrompt(campos, campos.uf, base) : batchPrompt(campos.itens, campos.full, campos.uf, base);
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
        if (campos) {
          conferirCodigos(resultado, campos.uf);
          // Guarda as respostas de confiança alta na base, depois de responder (waitUntil não atrasa o usuário)
          const g = gravarRespostas(env, tipo, campos, resultado);
          if (ctx && ctx.waitUntil) ctx.waitUntil(g); else await g;
        }
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
let KB = null, KB_EM = 0, ERROS = null; // ERROS: dicionário de erros (erros.json), usado pelo prompt.js
async function carregarKB(env) {
  if (KB && Date.now() - KB_EM < 10 * 60e3) return KB;
  const r = await fetch(env.KB_URL || 'https://classificabr.com/kb.json', { cf: { cacheTtl: 300 } });
  if (!r.ok) { if (KB) return KB; throw new Error('kb ' + r.status); }
  KB = prepararKB(await r.json()); KB_EM = Date.now();
  /* Dicionário de erros (mesmo endereço do kb.json, arquivo erros.json); se falhar, segue sem ele */
  try { const e = await fetch((env.KB_URL || 'https://classificabr.com/kb.json').replace(/kb\.json$/, 'erros.json'), { cf: { cacheTtl: 300 } }); ERROS = e.ok ? await e.json() : ERROS; } catch {}
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
  const maxLotes = Number(env.LOTES_POR_PLANILHA || 60); // 60: folga para a página dividir lotes grandes (28/11/2026)
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

/* ---------- Base de conhecimento no Supabase (28/11/2026) ---------- */

/* Chama uma função (RPC) do Supabase com a chave secreta. Devolve null se a base não estiver configurada,
   demorar mais que o limite ou falhar: a base é reforço e nunca impede a classificação. */
async function supabaseRPC(env, nome, args, ms = 1500) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return null;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${nome}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_SECRET_KEY },
      body: JSON.stringify(args),
    });
    if (!r.ok) { console.error('supabase', nome, r.status); return null; }
    return await r.json();
  } catch (e) { console.error('supabase', nome, e && e.name); return null; }
  finally { clearTimeout(t); }
}

/* Monta o bloco que vai no pedido à IA:
   - NORMAS DA BASE: trechos achados pelo mapa de busca, já na ordem da hierarquia (assunto exato; regulamento
     do estado antes do federal). Consulta: até 4; lote: até 8 para o lote inteiro (uma chamada só).
   - RESPOSTAS JÁ CONFIRMADAS (só consulta individual): itens parecidos (semelhança >= 0,6) aprovados por
     Sanada ou repetidos pela IA ao menos 3 vezes; servem de referência, a IA continua decidindo pelo item.
   O texto não leva contagens nem datas, para o mesmo pedido continuar igual (o cache depende disso). */
async function blocoBase(env, tipo, campos) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return '';
  const uf = campos.uf;
  const texto = tipo === 'classificar'
    ? [campos.item, campos.ctx, campos.extra].join(' ')
    : campos.itens.map(g => g.tit + ' ' + g.des).join(' ');
  const [normas, respostas] = await Promise.all([
    supabaseRPC(env, 'buscar_conhecimento', { p_texto: texto.slice(0, 4000), p_ente: uf, p_limite: tipo === 'classificar' ? 4 : 8 }),
    tipo === 'classificar' ? supabaseRPC(env, 'buscar_resposta', { p_item: campos.item, p_ente: uf, p_tipo: null }) : null,
  ]);
  let out = '';
  if (Array.isArray(normas) && normas.length) {
    out += '\n\nNORMAS DA BASE DE CONHECIMENTO (em ordem de prioridade; o regulamento do estado prevalece nele, a regra geral é o MCASP atualizado e a STN federal):\n'
      + normas.map(n => `- ${n.fonte}${n.referencia ? ', ' + n.referencia : ''}: ${n.resumo}`).join('\n');
  }
  const conf = (Array.isArray(respostas) ? respostas : [])
    .filter(r => r && r.codigo && Number(r.semelhanca) >= 0.6 && (r.origem === 'aprovada' || Number(r.confirmacoes) >= 3));
  if (conf.length) {
    out += '\n\nRESPOSTAS JÁ CONFIRMADAS PARA ITENS PARECIDOS (referência; confira se o item é de fato o mesmo):\n'
      + conf.map(r => `- ${r.codigo}${r.conta ? ' | conta ' + r.conta : ''} (${r.origem === 'aprovada' ? 'aprovada por especialista' : 'confirmada várias vezes'})`).join('\n');
  }
  return out;
}

/* Grava na tabela respostas o que voltou com confiança alta e código conferido. Só a consulta individual:
   o lote não devolve "confianca", então não há como saber se a resposta é assertiva. TIPO deduzido do
   elemento (TIPO_ELEMS); sem TIPO conhecido (ex.: imóveis 4.4.90.61), não grava. */
async function gravarRespostas(env, tipo, campos, r) {
  if (tipo !== 'classificar' || !env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) return;
  if (!r || !r.codigo || r.codigo_invalido || !/^alta$/i.test(String(r.confianca || '').trim())) return;
  const t = Object.keys(TIPO_ELEMS).find(k => TIPO_ELEMS[k].includes(elOf(r.codigo)));
  if (!t) return;
  await supabaseRPC(env, 'gravar_respostas', { p: [{
    ente: campos.uf, item: campos.item, tipo: t, codigo: String(r.codigo),
    conta: r.conta ? String(r.conta) : null, justificativa: r.justificativa ? String(r.justificativa) : null,
  }] }, 3000);
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
