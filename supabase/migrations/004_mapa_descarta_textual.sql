-- 004 (28/11/2026, aprovada por Sanada): descarta o resultado só textual quando o mapa
-- de busca já achou o assunto certo. Resto da função igual à 003.
drop function if exists public.buscar_conhecimento(text, text, int);
create function public.buscar_conhecimento(p_texto text, p_ente text, p_limite int default 4)
returns table (trecho_id bigint, ente text, nivel smallint, fonte text, referencia text, resumo text, caminhos extensions.ltree[], pontos_mapa int, rank real)
language sql stable set search_path = '' as
$$
  with t as (
    select ' ' || regexp_replace(public.norm_txt(p_texto), '[^a-z0-9]+', ' ', 'g') || ' ' as txt
  ),
  nos as (
    select distinct m.caminho from public.termos m, t where t.txt like '% ' || m.termo || ' %'
  ),
  q as (
    select to_tsquery('portuguese'::regconfig,
             nullif(array_to_string(array(
               select distinct w from regexp_split_to_table(trim((select txt from t)), '\s+') w where length(w) >= 3
             ), ' | '), '')) as tq
  ),
  cand as (
    select tr.*, f.nivel, f.titulo,
           coalesce((select max(case when c operator(extensions.<@) n.caminho then 2
                                      when n.caminho operator(extensions.<@) c then 1 else 0 end)
                     from nos n, unnest(tr.caminhos) c), 0) as pm,
           coalesce(ts_rank(tr.tsv, (select tq from q)), 0)::real as rk
    from public.trechos tr join public.fontes f on f.id = tr.fonte_id
    where tr.ente in (p_ente, 'BR')
  )
  select id, ente, nivel, titulo, referencia, resumo, caminhos, pm, rk
  from cand
  -- Quando o mapa já achou o assunto (algum pm > 0), só voltam os trechos do mapa;
  -- a busca textual (pm = 0) fica só para quando o mapa não achou nada. Economiza token
  -- e evita palavra solta casar com outro assunto (ex.: "Unidade" SSD × unidade de medida).
  where pm > 0
     or (not exists (select 1 from cand c2 where c2.pm > 0)
         and (select tq from q) is not null and tsv @@ (select tq from q))
  order by pm desc, (ente = p_ente) desc, nivel desc, rk desc
  limit greatest(1, least(coalesce(p_limite, 4), 8));
$$;
revoke execute on function public.buscar_conhecimento(text, text, int) from public, anon, authenticated;
grant execute on function public.buscar_conhecimento(text, text, int) to service_role;
