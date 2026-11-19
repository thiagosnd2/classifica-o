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
 */

const PREFIXO = 'qw-classificador:';
const LIM = {
  classificar: { chars: 120000, maxTokens: 2000 },
  lote:        { chars: 300000, maxTokens: 6000 },
};
const SISTEMA = 'Você é um classificador de natureza de despesa pública brasileira. Responda SOMENTE com JSON válido, sem texto antes ou depois e sem blocos de código.';

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

        if (tipo === 'lote') {
          const lic = await licencaValida(env, corpo.chave);
          if (!lic) return resp(403, { erro: 'Chave Pro inválida, vencida ou cancelada' });
        }

        const resultado = await chamarIA(env, prompt, LIM[tipo].maxTokens);
        return resp(200, { resultado });
      }

      return resp(404, { erro: 'Rota não encontrada' });
    } catch (e) {
      const status = e && e.status === 429 ? 429 : 502;
      return resp(status, { erro: status === 429 ? 'Limite da IA atingido' : 'Falha ao consultar a IA' });
    }
  },
};

async function lerLicenca(env, hash) {
  if (!env.LICENCAS) return null;
  const v = await env.LICENCAS.get(hash);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

async function hashChave(chave) {
  const norm = String(chave || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(PREFIXO + norm));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function licencaValida(env, chave) {
  if (!chave) return null;
  const d = await lerLicenca(env, await hashChave(chave));
  if (!d || d.ativa === false) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  if (d.validade && d.validade < hoje) return null;
  return d;
}

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
  if (!r.ok) throw { status: r.status };
  const j = await r.json();
  const texto = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return extrairJSON(texto);
}

function extrairJSON(t) {
  const s = String(t).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(s); } catch {}
  const ini = s.search(/[\[{]/);
  if (ini < 0) throw { status: 502 };
  const fecha = s[ini] === '[' ? ']' : '}';
  const fim = s.lastIndexOf(fecha);
  return JSON.parse(s.slice(ini, fim + 1));
}
