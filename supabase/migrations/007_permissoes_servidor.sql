-- 007 (28/11/2026): permissões do servidor (service_role = chave secreta do Worker) nas tabelas.
-- Projetos novos do Supabase não dão mais SELECT/INSERT/UPDATE/DELETE automáticos; sem isto as funções
-- buscar_conhecimento, buscar_resposta e gravar_respostas respondiam 403 ("permission denied for table ...").
-- Público (anon/authenticated) continua sem nenhum acesso. As funções rodam como quem chama (security invoker).
grant select on public.entes, public.fontes, public.mapa, public.termos, public.trechos, public.erros to service_role;
grant select, insert, update, delete on public.respostas to service_role;
grant usage, select on all sequences in schema public to service_role;
