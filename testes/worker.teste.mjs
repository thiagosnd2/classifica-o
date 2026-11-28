/* Testes do Worker com KV, Turnstile e IA simulados (sem rede e sem chave).
   Como rodar, na raiz do projeto:  node testes/worker.teste.mjs
   Cada linha mostra OK ou ERRO. Criado na fase 2 do levantamento (27/11/2026). */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tmp = join(tmpdir(), 'worker-teste.mjs');
writeFileSync(tmp, readFileSync(new URL('../servidor/worker.js', import.meta.url)));
const { default: W } = await import(tmp);
const kv = new Map(); let falharPut = false, falhasTransit = 0, falharGet = false, chamadasIA = 0, ultimoCorpoIA = null;
const KV = { get: async k => { if(falharGet) throw new Error('x'); return kv.has(k) ? kv.get(k) : null; },
             put: async (k,v) => { if(falharPut) throw new Error('x'); if(falhasTransit>0){ falhasTransit--; throw new Error('429 same key'); } kv.set(k,v); } };
/* Dicionário de erros de teste: uma entrada aprovada (gatilho "ssd") e uma pendente (não pode entrar no pedido) */
const ERROS_TESTE = { entradas: [
  { id: 'T1', status: 'aprovado', uf: '*', gatilhos: ['ssd'], erro: 'erro de teste', correcao: 'correção de teste', regra: 'regra de teste' },
  { id: 'T2', status: 'pendente', uf: '*', gatilhos: ['ssd'], erro: 'pendente', correcao: 'x', regra: 'x' } ] };
const KBJSON = readFileSync(new URL('../kb.json', import.meta.url), 'utf8');
let respostaIA = '[{"n":1,"codigo":"3.3.90.30"}]';
globalThis.fetch = async (url, op) => {
  if (String(url).endsWith('/kb.json')) return { ok: true, json: async () => JSON.parse(KBJSON) };
  if (String(url).endsWith('/erros.json')) return { ok: true, json: async () => ERROS_TESTE };
  if (String(url).includes('turnstile')) { const tok = op.body.get('response'); return { json: async () => ({ success: tok === 'TOK-OK' }) }; }
  chamadasIA++; ultimoCorpoIA = JSON.parse(op.body);
  return { ok: true, json: async () => ({ content: [{ type:'text', text: respostaIA }], stop_reason:'end_turn' }) };
};
const env = { ANTHROPIC_API_KEY:'k', LICENCAS: KV, TURNSTILE_SECRET:'s', DAILY_LIMIT:'3', IMPORT_LIMIT:'5' };
const req = (rota, corpo, ip='1.1.1.1', metodo='POST') => new Request('https://w.dev'+rota, { method: metodo, headers: {'content-type':'application/json','CF-Connecting-IP': ip}, body: metodo==='POST'?JSON.stringify(corpo):undefined });
const run = async (...a) => { const r = await W.fetch(req(...a), env); return [r.status, await r.json()]; };
const ok = (c, m) => console.log((c ? 'OK  ' : 'ERRO') + ' ' + m);
let r;
r = await run('/versao', null, '1.1.1.1', 'GET'); ok(r[0]===200 && /^\d{4}\.\d{2}\.\d{2}-\d+$/.test(r[1].versao), 'GET /versao → ' + r[1].versao);
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===403 && /anti-robô/.test(r[1].erro), '1ª chamada sem token é recusada');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1', ts:'TOK-OK'}); ok(r[0]===200, '1ª chamada com token passa');
ok(!('temperature' in ultimoCorpoIA), 'pedido à IA sem temperature'); ok(chamadasIA===1, 'uma chamada à IA por pedido');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===200, '2º lote da mesma planilha passa sem token');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}, '2.2.2.2'); ok(r[0]===403 && /outra conexão/.test(r[1].erro), 'mesma planilha em outro IP é recusada');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===200, '3ª chamada ainda cabe no teto de 3'); r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===429, 'teto compartilhado (DAILY_LIMIT=3): 4ª chamada barrada');
// teto separado
kv.clear(); env.DAILY_LIMIT_LOTE='100'; env.DAILY_LIMIT='1'; env.LOTES_POR_PLANILHA='20';
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-bbbb2', ts:'TOK-OK'}); ok(r[0]===200, 'com DAILY_LIMIT_LOTE, lote usa contador próprio');
let n=1, ultimo; for(;n<=25;n++){ ultimo = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-bbbb2'}); if(ultimo[0]!==200) break; }
ok(n===20 && /todos os lotes/.test(ultimo[1].erro), `planilha para no lote 21 (parou na chamada ${n+1}: ${ultimo[1].erro})`);
ok(kv.has('usol:'+new Date(Date.now()-3*3600e3).toISOString().slice(0,10)) && !kv.has('uso:'+new Date(Date.now()-3*3600e3).toISOString().slice(0,10)), 'lote grava em usol:, não em uso:');
// consulta individual e falha do KV
r = await run('/classificar', {prompt:'consulta 1', ts:'TOK-OK'}); ok(r[0]===200, 'consulta 1 passa (teto consulta = 1)');
r = await run('/classificar', {prompt:'consulta 2', ts:'TOK-OK'}); ok(r[0]===429, 'consulta 2 barrada pelo teto da consulta');
env.DAILY_LIMIT='50'; falharPut = true;
r = await run('/classificar', {prompt:'consulta 3', ts:'TOK-OK'}); ok(r[0]===503, 'KV sem gravação → consulta recusada (503): ' + r[1].erro);
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-cccc3', ts:'TOK-OK'}); ok(r[0]===403 && /indisponível/.test(r[1].erro), 'KV sem gravação → importação recusada');
falharPut = false; falharGet = true;
r = await run('/classificar', {prompt:'consulta 4', ts:'TOK-OK'}); ok(r[0]===503, 'KV sem leitura → consulta recusada (503)');
falharGet = false;
// gravação na mesma chave recusada 1 vez (limite de 1/s do KV) → nova tentativa passa
falhasTransit = 1; r = await run('/classificar', {prompt:'consulta 5', ts:'TOK-OK'}); ok(r[0]===200, 'falha passageira do KV é repetida e a consulta passa');
// limite de 5 planilhas por IP
kv.clear(); delete env.DAILY_LIMIT_LOTE; env.DAILY_LIMIT='1000';
for(let i=1;i<=6;i++){ r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-dddd'+i, ts:'TOK-OK'}); }
ok(r[0]===403 && /5 importações/.test(r[1].erro), '6ª planilha no dia é recusada');

// ---------- Fase 3: pedido montado no servidor a partir dos campos ----------
import { readFileSync as rf } from 'node:fs';
/* Opcional: pedidos gerados pela página (JSON com c_ES, c_AC, l_AC_Serviço_False) para provar que o servidor monta
   o mesmo texto; sem o arquivo, essas três verificações são puladas. */
let base = null; try { base = JSON.parse(rf(process.env.PROMPTS_PAGINA || '/home/claude/p3/antes.json', 'utf8')); } catch {}
kv.clear(); env.DAILY_LIMIT = '1000'; delete env.TURNSTILE_SECRET;
const promptEnviado = () => ultimoCorpoIA.messages[0].content;
respostaIA = '{"codigo":"3.3.90.30.16","confianca":"alta"}';
r = await run('/classificar', {campos:{uf:'ES', item:'Grampeador de mesa', ctx:'uso no setor', forn:'PJ', desp:'', extra:'', un:'131 - Unidade'}});
ok(r[0]===200 && !r[1].resultado.codigo_invalido, 'consulta por campos (ES) passa, código válido');
if (base) ok(promptEnviado() === base.c_ES, 'pedido montado no servidor = pedido da página (ES)');
respostaIA = '{"codigo":"3.3.90.30.98","confianca":"alta"}';
r = await run('/classificar', {campos:{uf:'ES', item:'Outro item', un:'131 - Unidade'}});
ok(r[1].resultado.codigo_invalido === true, 'código fora da tabela é marcado como inválido');
r = await run('/classificar', {campos:{uf:'ES', item:'Outro item', un:'131 - Unidade'}});
ok(!r[1].cache, 'código inválido não vai para o cache');
respostaIA = '{"codigo":"3.3.90.34","confianca":"alta"}';
r = await run('/classificar', {campos:{uf:'AC', item:'Terceirização de apoio administrativo', ctx:'dedicação exclusiva', un:'Mês'}});
ok(!r[1].resultado.codigo_invalido, '3.3.90.34 é válido no Acre');
if (base) ok(promptEnviado() === base.c_AC, 'pedido montado no servidor = pedido da página (AC)');
r = await run('/classificar', {campos:{uf:'SP', item:'Terceirização x', un:'Mês'}});
ok(r[1].resultado.codigo_invalido === true, '3.3.90.34 é inválido em SP');
r = await run('/classificar', {campos:{uf:'XX', item:'a'}}); ok(r[0]===400, 'Estado inválido é recusado');
r = await run('/classificar', {campos:{uf:'ES', item:''}}); ok(r[0]===400, 'item vazio é recusado');
// lote por campos
const gs = [{tipo:'Serviço',tit:'Papel A4',des:'resma 500 folhas',u:{c:'131',n:'Unidade'},un:'',finalidade:''},{tipo:'Serviço',tit:'Kit escolar',des:'kit para alunos',u:{c:'131',n:'Unidade'},un:'',finalidade:'Distribuição gratuita'}];
respostaIA = '[{"n":1,"codigo":"3.3.90.39"},{"n":2,"codigo":"3.3.90.99"}]';
r = await run('/lote', {campos:{uf:'AC', full:false, itens:gs}, arquivo:'planilha-eeee1'});
ok(r[0]===200 && !r[1].resultado[0].codigo_invalido && r[1].resultado[1].codigo_invalido, 'lote por campos: confere cada código');
if (base) ok(promptEnviado() === base['l_AC_Serviço_False'], 'pedido do lote no servidor = pedido da página (AC)');
r = await run('/lote', {campos:{uf:'AC', itens:Array(31).fill(gs[0])}, arquivo:'planilha-eeee1'}); ok(r[0]===400, 'lote com mais de 30 itens é recusado');
r = await run('/lote', {campos:{uf:'AC', itens:[gs[0], {...gs[0], tipo:'Material'}]}, arquivo:'planilha-eeee1'}); ok(r[0]===400, 'lote com TIPOS misturados é recusado');
// transição
r = await run('/classificar', {prompt:'formato antigo'}); ok(r[0]===200, 'formato antigo ainda aceito na transição');
env.ACEITAR_PROMPT_LIVRE = 'false';
r = await run('/classificar', {prompt:'formato antigo'}); ok(r[0]===400 && /Ctrl/.test(r[1].erro), 'com ACEITAR_PROMPT_LIVRE=false, formato antigo é recusado');

// ---------- Dicionário de erros ----------
env.ACEITAR_PROMPT_LIVRE = 'true';
respostaIA = '{"codigo":"3.3.90.30.17","confianca":"alta"}';
r = await run('/classificar', {campos:{uf:'ES', item:'Unidade SSD 480GB', un:'131 - Unidade'}});
ok(r[0]===200 && /ERROS JÁ CORRIGIDOS/.test(promptEnviado()) && /T1: ERRO/.test(promptEnviado()) && !/T2:/.test(promptEnviado()), 'item com gatilho leva só a entrada aprovada do dicionário');
kv.clear(); // sem cache, para a IA ser chamada de novo
r = await run('/classificar', {campos:{uf:'ES', item:'Grampeador de mesa', ctx:'uso no setor', forn:'PJ', desp:'', extra:'', un:'131 - Unidade'}});
ok(!/ERROS JÁ CORRIGIDOS/.test(promptEnviado()), 'item sem gatilho: pedido sem o bloco do dicionário');
if (base) ok(promptEnviado() === base.c_ES, 'sem gatilho, o pedido continua idêntico ao da página (cache preservado)');

// ---------- Base de conhecimento no Supabase (28/11/2026) ----------
// Simula o Supabase: guarda as chamadas RPC e responde normas, respostas e gravação.
const fetchIA = globalThis.fetch, rpcs = [];
let supaFalha = false;
globalThis.fetch = async (url, op) => {
  const u = String(url);
  if (u.startsWith('https://teste.supabase.co/rest/v1/rpc/')) {
    const nome = u.split('/').pop(), args = JSON.parse(op.body);
    rpcs.push({ nome, args, apikey: op.headers.apikey });
    if (supaFalha) throw Object.assign(new Error('x'), { name: 'AbortError' });
    if (nome === 'buscar_conhecimento') return { ok: true, json: async () => [{ fonte: 'NBC TSP 07 – Ativo Imobilizado', referencia: 'Depreciação', resumo: 'Terrenos não são depreciados.' }] };
    if (nome === 'buscar_resposta') return { ok: true, json: async () => [
      { codigo: '4.4.90.61', conta: '1.2.3.2.1.01.04', origem: 'aprovada', confirmacoes: 1, semelhanca: 0.8 },
      { codigo: '3.3.90.39', conta: null, origem: 'ia_alta', confirmacoes: 1, semelhanca: 0.9 } ] };
    if (nome === 'gravar_respostas') return { ok: true, json: async () => 1 };
  }
  return fetchIA(url, op);
};
kv.clear(); env.SUPABASE_URL = 'https://teste.supabase.co/'; env.SUPABASE_SECRET_KEY = 'sb_secret_TESTE';
respostaIA = '{"codigo":"4.4.90.52","confianca":"alta","justificativa":"permanente"}';
r = await run('/classificar', {campos:{uf:'AC', item:'Terreno para escola', un:'Unidade'}});
let p = promptEnviado();
ok(r[0]===200 && /NORMAS DA BASE DE CONHECIMENTO/.test(p) && /NBC TSP 07 – Ativo Imobilizado, Depreciação: Terrenos não são depreciados/.test(p), 'consulta leva o bloco de normas da base');
ok(/RESPOSTAS JÁ CONFIRMADAS/.test(p) && /4\.4\.90\.61 \| conta 1\.2\.3\.2\.1\.01\.04 \(aprovada por especialista\)/.test(p) && !/3\.3\.90\.39 \(confirmada/.test(p), 'só resposta aprovada (ou repetida 3x) entra como referência');
ok(rpcs.every(c => c.apikey === 'sb_secret_TESTE') && rpcs.find(c => c.nome==='buscar_conhecimento').args.p_limite === 4, 'RPC com a chave secreta no cabeçalho e até 4 normas na consulta');
const grav = rpcs.find(c => c.nome === 'gravar_respostas');
ok(grav && grav.args.p[0].ente==='AC' && grav.args.p[0].tipo==='Material' && grav.args.p[0].codigo==='4.4.90.52', 'resposta de confiança alta é gravada (TIPO deduzido do elemento)');
rpcs.length = 0; kv.clear(); respostaIA = '{"codigo":"4.4.90.52","confianca":"média"}';
r = await run('/classificar', {campos:{uf:'AC', item:'Cadeira giratória', un:'Unidade'}});
ok(!rpcs.some(c => c.nome === 'gravar_respostas'), 'confiança média não é gravada');
rpcs.length = 0; respostaIA = '[{"n":1,"codigo":"3.3.90.39"},{"n":2,"codigo":"3.3.90.39"}]';
r = await run('/lote', {campos:{uf:'AC', full:false, itens:gs}, arquivo:'planilha-ffff1'});
ok(r[0]===200 && /NORMAS DA BASE/.test(promptEnviado()) && rpcs.find(c=>c.nome==='buscar_conhecimento').args.p_limite===8 && !rpcs.some(c=>c.nome!=='buscar_conhecimento'), 'lote: uma busca de normas (até 8), sem busca nem gravação de respostas');
// Supabase fora do ar: segue sem o bloco, pedido idêntico ao da página
supaFalha = true; kv.clear(); respostaIA = '{"codigo":"3.3.90.34","confianca":"alta"}';
r = await run('/classificar', {campos:{uf:'AC', item:'Terceirização de apoio administrativo', ctx:'dedicação exclusiva', un:'Mês'}});
ok(r[0]===200 && !/NORMAS DA BASE/.test(promptEnviado()), 'Supabase com falha: consulta segue normalmente, sem o bloco');
if (base) ok(promptEnviado() === base.c_AC, 'Supabase com falha: pedido idêntico ao da página');
supaFalha = false; delete env.SUPABASE_URL; delete env.SUPABASE_SECRET_KEY;
