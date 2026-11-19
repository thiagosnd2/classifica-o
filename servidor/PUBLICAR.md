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
   - Variável: `ALLOWED_ORIGIN` = `https://thiagosnd2.github.io`
   - Variável (opcional): `MODEL` = `claude-haiku-5-5` (padrão) ou `claude-sonnet-5-5` para mais precisão, com custo maior.
6. Anote o endereço do Worker, algo como `https://classificador-api.SEU-USUARIO.workers.dev`.

> Pelo terminal, a alternativa é: `cd servidor && npx wrangler deploy` (depois de ajustar o `wrangler.toml`) e `npx wrangler secret put ANTHROPIC_API_KEY`.

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

No `index.html`, preencha a linha:

```js
const API_URL = 'https://classificador-api.SEU-USUARIO.workers.dev';
```

Faça commit e push.

## 5. Ativar o GitHub Pages

No repositório: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, pasta `/ (root)`. Em poucos minutos a página fica em:

https://thiagosnd2.github.io/classifica-o/

## Segurança e custos

- A chave da API fica só no Cloudflare, nunca na página.
- O importador (rota `/lote`) só funciona com chave Pro válida, conferida no servidor — trava real.
- A consulta individual é gratuita e aberta; o Worker aceita apenas pedidos vindos do endereço em `ALLOWED_ORIGIN` e com tamanho limitado. Um uso automatizado fora do navegador ainda é possível; por isso, mantenha o limite de gasto no console da Anthropic e, se quiser, ative o limite por IP (`[[ratelimits]]` no `wrangler.toml`, binding `RL`).
- Custo de referência (estimativa do projeto): cerca de US$ 39/mês para o ES inteiro com Haiku 5.5 e prompt otimizado. O Worker e o GitHub Pages ficam no plano gratuito nesse volume.
