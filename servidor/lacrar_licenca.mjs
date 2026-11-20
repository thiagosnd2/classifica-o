#!/usr/bin/env node
// Gera o documento cifrado de uma licença para o banco do artefato (Projeto 1).
// Uso: node lacrar_licenca.mjs "QW-ES-XXXX-XXXX-XXXX" "Município" 2027-12-31 [UF]
import { webcrypto as crypto } from 'node:crypto';
const [, , chave, municipio = '', validade = '', uf = 'ES'] = process.argv;
if (!chave) { console.error('Informe a chave.'); process.exit(1); }
const norm = chave.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
const id = hex(await crypto.subtle.digest('SHA-256', enc.encode('qw-classificador:' + norm)));
const kbuf = await crypto.subtle.digest('SHA-256', enc.encode('qw-classificador-enc:' + norm));
const key = await crypto.subtle.importKey('raw', kbuf, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ municipio, validade, uf, plano: 'pro' }))));
const e = Buffer.from([...iv, ...ct]).toString('base64');
console.log(JSON.stringify({ path: 'licencas/' + id, data: { ativa: true, e } }));
