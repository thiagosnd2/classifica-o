/**
 * Servidor do Classificador de Natureza de Despesa (Cloudflare Workers)
 *
 * Rotas (todas POST, JSON):
 *   /classificar  { prompt }          -> consulta individual (plano gratuito)
 *   /lote         { prompt, chave }   -> importador (exige chave Pro válida)
 *   /licenca      { hash }            -> verifica uma chave Pro
 *
 * Configuração no painel do Cloudflare:
 *   Segredo  ANTHROPIC_API_KEY  chave da API da Anthropic (obrigatório)
 *   Variável ALLOWED_ORIGIN     endereço da página, ex.: https://thiagosnd2.github.io
 *   Variável MODEL              opcional; padrão claude-haiku-5-5
 *   KV       LICENCAS           chaves Pro: nome = hash da chave, valor = JSON
 *   Rate limit RL               opcional; limita consultas por IP
 *   Segredo  TURNSTILE_SECRET   opcional; exige a verificação anti-robô na consulta individual
 *   Variável DAILY_LIMIT        opcional; teto de consultas de IA por dia (todas as pessoas somadas)
 *   Variável PRO_OBRIGATORIO    "true" = importador só com chave Pro; ausente/"false" = Pro suspenso,
 *                               importação liberada com limite diário por IP
 *   Variável IMPORT_LIMIT       importações por dia por IP quando o Pro está suspenso (padrão 5)
 */

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
        const prompt = String(corpo.prompt || '');
        if (!prompt) return resp(400, { erro: 'Prompt vazio' });
        if (prompt.length > LIM[tipo].chars) return resp(413, { erro: 'Pedido grande demais' });

        let restantes = null;
        if (tipo === 'lote') {
          // Com chave Pro válida: sem limite. Sem chave: depende do modo (Pro obrigatório ou suspenso).
          const lic = corpo.chave ? await licencaValida(env, corpo.chave) : null;
          if (!lic) {
            if (env.PRO_OBRIGATORIO === 'true') return resp(403, { erro: 'Chave Pro inválida, vencida ou cancelada' });
            const r = await contarImportacao(env, String(corpo.arquivo || ''), req.headers.get('CF-Connecting-IP') || 'anon');
            if (!r.ok) return resp(403, { erro: r.erro });
            restantes = r.restantes;
          }
        } else if (env.TURNSTILE_SECRET) {
          const ok = await verificarTurnstile(env, corpo.ts, req.headers.get('CF-Connecting-IP'));
          if (!ok) return resp(403, { erro: 'Verificação anti-robô falhou' });
        }

        if (!(await dentroDoTeto(env))) return resp(429, { erro: 'Limite diário de consultas atingido' });

        const resultado = await chamarIA(env, prompt, LIM[tipo].maxTokens);
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

// Limite de importações por dia por IP (Pro suspenso). Cada planilha enviada tem um id próprio;
// os lotes da mesma planilha contam como uma importação só. Se o KV falhar, a importação segue.
async function contarImportacao(env, arquivo, ip) {
  const lim = Number(env.IMPORT_LIMIT || 5);
  if (!/^[\w.-]{8,64}$/.test(arquivo)) return { ok: false, erro: 'Importação sem identificação; recarregue a página e envie a planilha de novo' };
  if (!env.LICENCAS) return { ok: true, restantes: null };
  const k = 'imp:' + ip + ':' + diaBrasilia();
  let ids = [];
  try { ids = JSON.parse((await env.LICENCAS.get(k)) || '[]'); } catch { ids = []; }
  if (ids.includes(arquivo)) return { ok: true, restantes: Math.max(0, lim - ids.length) };
  if (ids.length >= lim) return { ok: false, erro: `Limite de ${lim} importações por dia atingido. Tente novamente amanhã` };
  ids.push(arquivo);
  try { await env.LICENCAS.put(k, JSON.stringify(ids), { expirationTtl: 2 * 86400 }); } catch {}
  return { ok: true, restantes: Math.max(0, lim - ids.length) };
}

function diaBrasilia() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }

// Teto diário aproximado (contador no KV; a contagem pode escapar em poucas unidades
// com muitos acessos simultâneos). No plano gratuito o KV aceita 1.000 gravações por dia.
async function dentroDoTeto(env) {
  const lim = Number(env.DAILY_LIMIT || 0);
  if (!lim || !env.LICENCAS) return true;
  const k = 'uso:' + diaBrasilia();
  let n = 0;
  try { n = Number((await env.LICENCAS.get(k)) || 0); } catch {}
  if (n >= lim) return false;
  try { await env.LICENCAS.put(k, String(n + 1), { expirationTtl: 3 * 86400 }); } catch {} // KV cheio: não derruba a consulta
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

/* Chama a API da Anthropic com a chave secreta, detecta resposta cortada e extrai o JSON. */
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
  if (!r.ok) throw { status: r.status, motivo: r.status === 529 ? 'IA sobrecarregada, tente de novo' : `a IA respondeu ${r.status}` };
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
