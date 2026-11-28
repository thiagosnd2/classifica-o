/* Testes do Worker com KV, Turnstile e IA simulados (sem rede e sem chave).
   Como rodar, na raiz do projeto:  node testes/worker.teste.mjs
   Cada linha mostra OK ou ERRO. Criado na fase 2 do levantamento (27/11/2026). */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const tmp = join(tmpdir(), 'worker-teste.mjs');
writeFileSync(tmp, readFileSync(new URL('../servidor/worker.js', import.meta.url)));
const { default: W } = await import(tmp);
const kv = new Map(); let falharPut = false, falharGet = false, chamadasIA = 0, ultimoCorpoIA = null;
const KV = { get: async k => { if(falharGet) throw new Error('x'); return kv.has(k) ? kv.get(k) : null; },
             put: async (k,v) => { if(falharPut) throw new Error('x'); kv.set(k,v); } };
globalThis.fetch = async (url, op) => {
  if (String(url).includes('turnstile')) { const tok = op.body.get('response'); return { json: async () => ({ success: tok === 'TOK-OK' }) }; }
  chamadasIA++; ultimoCorpoIA = JSON.parse(op.body);
  return { ok: true, json: async () => ({ content: [{ type:'text', text: '[{"n":1,"codigo":"3.3.90.30"}]' }], stop_reason:'end_turn' }) };
};
const env = { ANTHROPIC_API_KEY:'k', LICENCAS: KV, TURNSTILE_SECRET:'s', DAILY_LIMIT:'3', IMPORT_LIMIT:'5' };
const req = (rota, corpo, ip='1.1.1.1', metodo='POST') => new Request('https://w.dev'+rota, { method: metodo, headers: {'content-type':'application/json','CF-Connecting-IP': ip}, body: metodo==='POST'?JSON.stringify(corpo):undefined });
const run = async (...a) => { const r = await W.fetch(req(...a), env); return [r.status, await r.json()]; };
const ok = (c, m) => console.log((c ? 'OK  ' : 'ERRO') + ' ' + m);
let r;
r = await run('/versao', null, '1.1.1.1', 'GET'); ok(r[0]===200 && r[1].versao, 'GET /versao → ' + r[1].versao);
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===403 && /anti-robô/.test(r[1].erro), '1ª chamada sem token é recusada');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1', ts:'TOK-OK'}); ok(r[0]===200, '1ª chamada com token passa');
ok(!('temperature' in ultimoCorpoIA), 'pedido à IA sem temperature'); ok(chamadasIA===1, 'uma chamada à IA por pedido');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===200, '2º lote da mesma planilha passa sem token');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}, '2.2.2.2'); ok(r[0]===403 && /outra conexão/.test(r[1].erro), 'mesma planilha em outro IP é recusada');
r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===200, '3ª chamada ainda cabe no teto de 3'); r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-aaaa1'}); ok(r[0]===429, 'teto compartilhado (DAILY_LIMIT=3): 4ª chamada barrada');
// teto separado
kv.clear(); env.DAILY_LIMIT_LOTE='100'; env.DAILY_LIMIT='1';
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
// limite de 5 planilhas por IP
kv.clear(); delete env.DAILY_LIMIT_LOTE; env.DAILY_LIMIT='1000';
for(let i=1;i<=6;i++){ r = await run('/lote', {prompt:'x array JSON', arquivo:'planilha-dddd'+i, ts:'TOK-OK'}); }
ok(r[0]===403 && /5 importações/.test(r[1].erro), '6ª planilha no dia é recusada');
