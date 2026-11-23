# Publicar o Classificador fora do Claude

Arquitetura:

```
Navegador ──> GitHub Pages (index.html, kb.json)
     │
     └──> Cloudflare Worker (servidor/worker.js) ──> API da Anthropic
                 │
                 └── KV LICENCAS (chaves Pro, guardadas só como hash)
```

A mesma `index.html` funciona nos dois lugares: dentro do claude.ai usa a plataforma do Claude; fora dele usa o servidor configurado em `API_URL`.

## 1. Chave da API da Anthropic

1. Crie a conta em https://console.anthropic.com e cadastre o pagamento.
2. Crie uma chave de API e guarde-a (ela aparece uma única vez).
3. **Defina um limite de gasto mensal** no console. É a principal proteção de custo.

## 2. Servidor no Cloudflare (pelo painel, sem terminal)

1. Crie a conta em https://dash.cloudflare.com (plano gratuito).
2. Em **Workers & Pages**, crie um Worker chamado `classificador-api`.
3. Abra o editor de código do Worker, apague o conteúdo e cole todo o arquivo `servidor/worker.js`. Publique (Deploy).
4. Em **Storage / KV**, crie um namespace chamado `LICENCAS`.
5. Nas configurações do Worker (**Settings → Bindings / Variables**):
   - Binding de KV: nome `LICENCAS`, namespace `LICENCAS`.
   - Segredo (Secret): `ANTHROPIC_API_KEY` = sua chave da API.
   - Variável: `ALLOWED_ORIGIN` = `https://thiagosnd2.github.io,https://classificabr.com`
   - Variável (opcional): `MODEL` = `claude-haiku-5-5` (padrão) ou `claude-sonnet-5-5` para mais precisão, com custo maior.
6. Anote o endereço do Worker, algo como `https://classificador-api.SEU-USUARIO.workers.dev`.

> Pelo terminal, a alternativa é: `cd servidor && npx wrangler deploy` (depois de ajustar o `wrangler.toml`) e `npx wrangler secret put ANTHROPIC_API_KEY`.

## 2b. Proteções do servidor (recomendado)

- **Verificação anti-robô (Turnstile).** No painel do Cloudflare, em **Turnstile**, crie um widget para os domínios da página (`classificabr.com` e `thiagosnd2.github.io`), modo *Invisible* ou *Managed*. Ele gera duas chaves:
  - a **chave secreta** vai no Worker como segredo `TURNSTILE_SECRET`;
  - a **chave pública (site key)** vai no `index.html`, em `window.CFG.TURNSTILE_SITEKEY`.
  Com isso, a consulta individual só é aceita depois da verificação. O importador já é protegido pela chave Pro.
- **Teto diário.** Variável `DAILY_LIMIT` no Worker (ex.: `800`): ao atingir o número de consultas de IA no dia, o servidor recusa as seguintes até a meia-noite (horário de Brasília). Usa o KV `LICENCAS`; no plano gratuito do Cloudflare o KV aceita 1.000 gravações por dia, então mantenha o teto abaixo disso ou use o plano pago (US$ 5/mês).
- **Plano Pro suspenso / importação gratuita.** Sem a variável `PRO_OBRIGATORIO` (ou com `false`), o importador funciona sem chave, limitado a `IMPORT_LIMIT` importações por dia por IP (padrão 5); quem tiver chave Pro válida não tem limite. Para voltar a exigir chave, crie `PRO_OBRIGATORIO` = `true` no Worker e mude `PLANO_PRO` para `true` em `window.CFG` no `index.html`.
- **Limite por IP.** Opcional: binding de *Rate Limiting* chamado `RL` (veja o `wrangler.toml`).
- **Política de conteúdo (CSP).** Já vem na página: no GitHub Pages ela só carrega scripts de origens conhecidas e só envia dados ao endereço em `API_URL`.

## 3. Cadastrar as chaves Pro

Cada chave vira uma entrada no KV `LICENCAS`:

- **Nome (key):** o hash SHA-256 da chave.
- **Valor:** `{"municipio":"Nome","validade":"AAAA-MM-DD","ativa":true}`

Para gerar (requer Node.js):

```
node servidor/chave_pro.mjs - "Prefeitura de Exemplo" 2027-12-31
```

O `-` gera uma chave nova; também dá para informar uma chave existente. O script mostra a chave (entregar ao município), o nome e o valor (colar no KV pelo painel).

- **Cancelar:** troque `"ativa":true` por `"ativa":false`.
- **Renovar:** altere a `validade`.

A chave em texto nunca fica no servidor nem no repositório — só o hash.

## 4. Apontar a página para o servidor

No `index.html`, no início da página, preencha:

```js
window.CFG = { API_URL: 'https://classificador-api.SEU-USUARIO.workers.dev', TURNSTILE_SITEKEY: 'SUA_SITE_KEY' };
```

Faça commit e push.

## 5. Ativar o GitHub Pages

No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`. Em poucos minutos a página fica em:

https://classificabr.com (domínio próprio; o arquivo `CNAME` do repositório aponta para ele). Endereço alternativo: https://thiagosnd2.github.io/classifica-o/

No registrador do domínio (Wix), crie quatro registros A para `185.199.108.153`, `185.199.109.153`, `185.199.110.153` e `185.199.111.153`, e um CNAME `www` → `thiagosnd2.github.io`. Depois, em Settings → Pages, confirme o domínio e marque *Enforce HTTPS*.

## Segurança e custos

- A chave da API fica só no Cloudflare, nunca na página.
- O importador (rota `/lote`) só funciona com chave Pro válida, conferida no servidor — trava real.
- A consulta individual é gratuita; o Worker aceita só pedidos vindos de `ALLOWED_ORIGIN`, com tamanho limitado, e — com o Turnstile e o `DAILY_LIMIT` configurados — exige a verificação anti-robô e respeita o teto diário. Mantenha também o limite de gasto no console da Anthropic.
- Custo de referência (estimativa do projeto): cerca de US$ 39/mês para o ES inteiro com Haiku 5.5 e prompt otimizado. O Worker e o GitHub Pages ficam no plano gratuito nesse volume.
