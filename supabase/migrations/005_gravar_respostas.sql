-- 005 (28/11/2026): o Worker grava as respostas de confiança alta (código conferido) na tabela respostas.
-- Recebe uma lista JSON: [{ "ente": "AC", "item": "...", "tipo": "Material", "codigo": "...", "conta": "...", "justificativa": "..." }]
-- Regras (para a base não se contaminar):
--   * resposta "aprovada" (conferida por Sanada) nunca é alterada pela IA;
--   * mesmo item, mesmo código: soma 1 em confirmacoes;
--   * mesmo item, código diferente: troca pela resposta nova e zera a contagem (confirmacoes = 1),
--     porque a IA mudou de ideia e a resposta antiga deixa de ser "repetida".
-- Só o servidor (service_role / chave secreta) executa.
create function public.gravar_respostas(p jsonb)
returns integer
language plpgsql security invoker set search_path = '' as
$$
declare
  r jsonb; n integer := 0;
begin
  if jsonb_typeof(p) <> 'array' then return 0; end if;
  for r in select * from jsonb_array_elements(p) loop
    -- campos mínimos e ente conhecido; o resto é ignorado em silêncio
    continue when coalesce(r->>'codigo', '') = '' or coalesce(r->>'item', '') = ''
               or (r->>'tipo') not in ('Material', 'Serviço')
               or not exists (select 1 from public.entes e where e.sigla = r->>'ente');
    insert into public.respostas as x (ente, item_norm, tipo, codigo, conta, justificativa, origem)
    values (r->>'ente', left(public.norm_txt(r->>'item'), 500), r->>'tipo', left(r->>'codigo', 40),
            left(r->>'conta', 200), left(r->>'justificativa', 1500), 'ia_alta')
    on conflict (ente, item_norm, tipo) do update set
      confirmacoes  = case when x.codigo = excluded.codigo then x.confirmacoes + 1 else 1 end,
      codigo        = excluded.codigo,
      conta         = coalesce(excluded.conta, x.conta),
      justificativa = excluded.justificativa,
      atualizado_em = now()
    where x.origem <> 'aprovada';
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.gravar_respostas(jsonb) from public, anon, authenticated;
grant execute on function public.gravar_respostas(jsonb) to service_role;
