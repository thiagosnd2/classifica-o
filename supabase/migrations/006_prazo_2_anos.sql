-- 006 (28/11/2026, aprovada por Sanada): prazo de guarda da base de respostas = 2 anos.
-- O termo de aceite (v2) informa que o texto do item e a classificação ficam na base por até 2 anos.
-- Limpeza diária (pg_cron, 03:17 UTC): apaga as respostas da IA (origem 'ia_alta') sem nova consulta há mais de
-- 2 anos (atualizado_em muda a cada nova consulta do mesmo item). Respostas 'aprovada' são curadas por Sanada
-- e não expiram.
create extension if not exists pg_cron with schema pg_catalog;

create function public.limpar_respostas_antigas()
returns integer
language sql security invoker set search_path = '' as
$$
  with apagadas as (
    delete from public.respostas
    where origem = 'ia_alta' and atualizado_em < now() - interval '2 years'
    returning 1
  )
  select count(*)::int from apagadas;
$$;
revoke execute on function public.limpar_respostas_antigas() from public, anon, authenticated;
grant execute on function public.limpar_respostas_antigas() to service_role;

select cron.schedule('limpar-respostas-2-anos', '17 3 * * *', 'select public.limpar_respostas_antigas()');
