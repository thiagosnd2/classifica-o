/**
 * Gera o servidor/worker.js (o arquivo colado no Cloudflare) juntando:
 *   1. prompt.js (raiz)            — montagem do pedido à IA, o MESMO arquivo que a página usa;
 *   2. servidor/worker-base.js     — rotas, limites, cache, Turnstile e chamada à IA.
 *
 * Uso, na raiz do projeto:   node servidor/montar-worker.mjs
 * Rode sempre que mudar o prompt.js ou o worker-base.js, e cole o worker.js gerado no Cloudflare
 * (passo a passo em servidor/PUBLICAR.md). Criado na fase 3 do levantamento (27/11/2026).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const prompt = readFileSync(new URL('prompt.js', raiz), 'utf8');
const base = readFileSync(new URL('servidor/worker-base.js', raiz), 'utf8');
const versao = (base.match(/const WORKER_VERSAO = '([^']+)'/) || [])[1] || '?';

const aviso = `/* =====================================================================================
   ARQUIVO GERADO — NÃO EDITE AQUI.
   Edite servidor/worker-base.js e/ou prompt.js e rode:  node servidor/montar-worker.mjs
   Versão do Worker: ${versao}
   Parte 1: prompt.js (montagem do pedido à IA, igual à da página)
   Parte 2: servidor/worker-base.js (rotas, limites, cache e chamada à IA)
   ===================================================================================== */
`;

writeFileSync(new URL('servidor/worker.js', raiz),
  aviso + '\n/* ======================= Parte 1: prompt.js ======================= */\n' + prompt +
  '\n/* ======================= Parte 2: servidor/worker-base.js ======================= */\n' + base);
console.log(`servidor/worker.js gerado (versão ${versao}).`);
