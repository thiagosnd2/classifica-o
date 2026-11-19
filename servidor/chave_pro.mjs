#!/usr/bin/env node
// Gera a entrada de uma chave Pro para o KV LICENCAS.
// Uso: node chave_pro.mjs "QW-ES-XXXX-XXXX-XXXX" "Município" 2027-12-31
// Sem chave ("-"), gera uma nova aleatória.
import { webcrypto as crypto } from 'node:crypto';
const [, , chaveArg, municipio = '', validade = ''] = process.argv;
const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const bloco = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALF[b % ALF.length]).join('');
const chave = !chaveArg || chaveArg === '-' ? `QW-ES-${bloco()}-${bloco()}-${bloco()}` : chaveArg;
const norm = chave.toUpperCase().replace(/[^A-Z0-9]/g, '');
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('qw-classificador:' + norm));
const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const valor = JSON.stringify({ municipio, validade, ativa: true });
console.log(`Chave (entregue ao município): ${chave}`);
console.log(`Nome no KV (key):  ${hash}`);
console.log(`Valor no KV:       ${valor}`);
console.log(`\nPelo terminal: npx wrangler kv key put --binding=LICENCAS ${hash} '${valor}' --remote`);
