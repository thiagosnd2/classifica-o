-- =====================================================================================
-- Base de conhecimento do Classificador (Supabase, projeto "classificabr") — 28/11/2026
-- -------------------------------------------------------------------------------------
-- Objetivo (Sanada): guardar as respostas mais assertivas e os regulamentos da União, dos
-- estados e do DF, e um MAPA DE BUSCA para a IA achar o trecho certo gastando poucos tokens.
--
-- Hierarquia normativa (diretriz permanente de Sanada):
--   • regra geral: MCASP atualizado; a STN federal sempre deve ser respeitada (ente 'BR');
--   • onde o estado tem regulamento próprio, ele prevalece NAQUELE estado (ex.: ES, Tabela TCE-ES).
--   A busca devolve primeiro os trechos do ente consultado e depois os federais.
--
-- Como a busca funciona (barata em tokens):
--   1. termos:  palavras/sinônimos  → nós do mapa (ltree), ex.: 'terreno' → contabil.imobilizado.terreno
--   2. mapa:    árvore de assuntos (natureza da despesa, contabilidade, unidades...)
--   3. trechos: textos curtos de cada fonte, ligados a nós do mapa, com busca textual em português
--   4. buscar_conhecimento(texto, ente, limite): acha os nós pelas palavras do item, filtra os
--      trechos desses nós (e dos nós abaixo deles), ordena por ente (estado primeiro), nível e
--      relevância, e devolve só o RESUMO de poucos trechos.
--
-- Segurança: RLS ligado em todas as tabelas, sem política para anon/authenticated (ninguém lê de
-- fora). Só o Worker, com a chave service_role guardada como segredo no Cloudflare, acessa.
-- =====================================================================================

create extension if not exists ltree with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Normaliza texto: minúsculas e sem acento (imutável, para índices e colunas geradas)
create or replace function public.norm_txt(t text) returns text
language sql immutable parallel safe set search_path = '' as
$$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))) $$;

-- ---------- Entes: União (BR), estados, DF e, no futuro, municípios ----------
create table public.entes (
  sigla   text primary key,                       -- 'BR', 'ES', 'AC', 'DF'... (município: 'ES-3205309')
  nome    text not null,
  tipo    text not null check (tipo in ('uniao', 'estado', 'df', 'municipio')),
  uf_pai  text references public.entes (sigla)    -- município → estado
);
comment on table public.entes is 'União (BR), estados, DF e municípios. BR = regra geral federal (STN/MCASP).';

-- ---------- Fontes normativas ----------
create table public.fontes (
  id          bigint generated always as identity primary key,
  ente        text not null references public.entes (sigla),
  nivel       smallint not null check (nivel between 0 and 3),
              -- 0 = diretriz do sistema (Sanada), 1 = federal (STN, MCASP, leis, CFC),
              -- 2 = estadual/DF (tribunal de contas, secretaria), 3 = municipal
  orgao       text not null,                      -- 'STN', 'TCE-ES', 'CGE-AC', 'CFC'...
  tipo        text not null,                      -- 'manual', 'lei', 'portaria', 'tabela', 'instrução normativa'...
  numero      text,
  titulo      text not null,
  data_pub    date,
  vigente     boolean not null default true,      -- false = revogada (o conceito pode continuar valendo)
  url         text,
  observacao  text,
  criado_em   timestamptz not null default now()
);
comment on table public.fontes is 'Normas e documentos de referência, por ente e nível hierárquico.';

-- ---------- Mapa de busca (árvore de assuntos) ----------
create table public.mapa (
  caminho    extensions.ltree primary key,        -- ex.: despesa.consumo.informatica
  titulo     text not null,
  descricao  text,
  elementos  text[]                               -- elementos ligados ao assunto, ex.: {3.3.90.30}
);
create index mapa_caminho_gist on public.mapa using gist (caminho);
comment on table public.mapa is 'Mapa de busca: árvore de assuntos usada para chegar ao trecho certo sem varrer tudo.';

-- ---------- Termos (palavras e sinônimos → nós do mapa) ----------
create table public.termos (
  termo    text not null,                         -- já normalizado (norm_txt), uma ou mais palavras
  caminho  extensions.ltree not null references public.mapa (caminho) on delete cascade,
  primary key (termo, caminho)
);
comment on table public.termos is 'Gatilhos do mapa: se o texto do item contém o termo, o nó do mapa entra na busca.';

-- ---------- Trechos das fontes ----------
create table public.trechos (
  id          bigint generated always as identity primary key,
  fonte_id    bigint not null references public.fontes (id) on delete cascade,
  ente        text not null references public.entes (sigla),
  caminhos    extensions.ltree[] not null,        -- nós do mapa a que o trecho pertence
  referencia  text,                               -- 'art. 15, § 2º', 'Parte I, item ...', 'página 12'
  resumo      text not null check (length(resumo) <= 600),  -- o que vai para a IA (curto)
  texto       text,                               -- texto completo, para consulta humana
  tsv         tsvector generated always as (
                to_tsvector('portuguese'::regconfig, public.norm_txt(coalesce(resumo, '') || ' ' || coalesce(texto, '')))
              ) stored,
  criado_em   timestamptz not null default now()
);
create index trechos_tsv on public.trechos using gin (tsv);
create index trechos_caminhos on public.trechos using gist (caminhos);
create index trechos_ente on public.trechos (ente);
create index trechos_fonte on public.trechos (fonte_id);
comment on table public.trechos is 'Trechos curtos das fontes, ligados ao mapa. Só o resumo vai para a IA.';

-- ---------- Respostas assertivas (confirmadas) ----------
create table public.respostas (
  id             bigint generated always as identity primary key,
  ente           text not null references public.entes (sigla),
  item_norm      text not null,                   -- texto do item normalizado (norm_txt, espaços simples)
  tipo           text check (tipo in ('Material', 'Serviço')),
  codigo         text not null,
  conta          text,
  justificativa  text,
  origem         text not null check (origem in ('ia_alta', 'aprovada')),
              -- ia_alta = IA com confiança alta e código conferido; aprovada = conferida por Sanada
  confirmacoes   integer not null default 1,      -- quantas vezes a mesma resposta voltou
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (ente, item_norm, tipo)
);
create index respostas_trgm on public.respostas using gin (item_norm extensions.gin_trgm_ops);
comment on table public.respostas is 'Respostas mais assertivas por ente e item. Aprovadas valem mais que as da IA.';

-- ---------- Dicionário de erros (substituirá o erros.json) ----------
create table public.erros (
  id         text primary key,                    -- 'E001'...
  ente       text not null references public.entes (sigla),  -- 'BR' = todos
  status     text not null check (status in ('pendente', 'aprovado', 'arquivado')),
  gatilhos   text[] not null,                     -- normalizados
  erro       text not null,
  correcao   text not null,
  regra      text not null,
  fonte      text,
  origem     text,
  criado_em  timestamptz not null default now()
);
comment on table public.erros is 'Erros já identificados e a correção. Só "aprovado" vai para a IA.';

-- ---------- RLS: ligado em tudo, sem política pública ----------
alter table public.entes     enable row level security;
alter table public.fontes    enable row level security;
alter table public.mapa      enable row level security;
alter table public.termos    enable row level security;
alter table public.trechos   enable row level security;
alter table public.respostas enable row level security;
alter table public.erros     enable row level security;

-- ---------- Busca pelo mapa ----------
-- Devolve até p_limite trechos curtos para o item, do ente consultado primeiro e depois federais.
create or replace function public.buscar_conhecimento(p_texto text, p_ente text, p_limite int default 4)
returns table (trecho_id bigint, ente text, nivel smallint, fonte text, referencia text, resumo text, caminhos extensions.ltree[], rank real)
language sql stable set search_path = '' as
$$
  with t as (
    select ' ' || regexp_replace(public.norm_txt(p_texto), '[^a-z0-9]+', ' ', 'g') || ' ' as txt
  ),
  nos as (                                   -- 1. nós do mapa acionados pelas palavras do item
    select distinct m.caminho
    from public.termos m, t
    where t.txt like '% ' || m.termo || ' %'
  ),
  q as (                                     -- 2. consulta textual com as palavras do item (OU)
    select to_tsquery('portuguese'::regconfig,
             nullif(array_to_string(array(
               select distinct w from regexp_split_to_table(trim((select txt from t)), '\s+') w where length(w) >= 3
             ), ' | '), '')) as tq
  )
  select tr.id, tr.ente, f.nivel, f.titulo, tr.referencia, tr.resumo, tr.caminhos,
         coalesce(ts_rank(tr.tsv, (select tq from q)), 0)::real
  from public.trechos tr
  join public.fontes f on f.id = tr.fonte_id
  where tr.ente in (p_ente, 'BR')
    and (
      exists (select 1 from nos n, unnest(tr.caminhos) c where c operator(extensions.<@) n.caminho or n.caminho operator(extensions.<@) c)
      or ((select tq from q) is not null and tr.tsv @@ (select tq from q))
    )
  order by (tr.ente = p_ente) desc,          -- regulamento do estado primeiro
           (exists (select 1 from nos n, unnest(tr.caminhos) c where c operator(extensions.<@) n.caminho or n.caminho operator(extensions.<@) c)) desc,
           f.nivel desc,                     -- dentro do mesmo ente, o mais específico
           coalesce(ts_rank(tr.tsv, (select tq from q)), 0) desc
  limit greatest(1, least(coalesce(p_limite, 4), 8));
$$;
comment on function public.buscar_conhecimento is 'Mapa de busca: até 8 trechos curtos para o item, regulamento do ente primeiro, depois federal.';

-- Resposta assertiva já registrada para o item (exata ou muito parecida)
create or replace function public.buscar_resposta(p_item text, p_ente text, p_tipo text default null)
returns table (codigo text, conta text, justificativa text, origem text, confirmacoes integer, semelhanca real)
language sql stable set search_path = '' as
$$
  select r.codigo, r.conta, r.justificativa, r.origem, r.confirmacoes,
         extensions.similarity(r.item_norm, public.norm_txt(p_item))
  from public.respostas r
  where r.ente = p_ente
    and (p_tipo is null or r.tipo = p_tipo)
    and r.item_norm operator(extensions.%) public.norm_txt(p_item)
  order by (r.origem = 'aprovada') desc, extensions.similarity(r.item_norm, public.norm_txt(p_item)) desc, r.confirmacoes desc
  limit 3;
$$;

-- Só o servidor (service_role) chama as funções
revoke execute on function public.buscar_conhecimento(text, text, int) from public, anon, authenticated;
revoke execute on function public.buscar_resposta(text, text, text) from public, anon, authenticated;
grant execute on function public.buscar_conhecimento(text, text, int) to service_role;
grant execute on function public.buscar_resposta(text, text, text) to service_role;
