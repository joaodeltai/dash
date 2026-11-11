# Pendências

Nenhuma fase esgotou os quatro ciclos e nenhum critério de pronto ficou reprovado. O que está aqui é o que **não foi feito de propósito** (depende de aprovação), o que **não pôde ser validado** neste ambiente e o que ficou **fora do escopo** e vale decidir.

## Depende de aprovação (nada disto foi executado)

Na ordem. O passo a passo está em [README.md](README.md#colocar-em-produção).

1. Criar os secrets `SOCIAL_COLLECT_SECRET` e `APIFY_TOKEN` (e `GA4_SERVICE_ACCOUNT_JSON`, se houver site). Antes, gerar um token novo na Apify e revogar o que foi colado na conversa.
2. Aplicar a migration `20261111170127_social_networks.sql` em produção.
3. Fazer o deploy da função `social-collect` com `--no-verify-jwt`.
4. Rodar `supabase/cron/social_collect_cron.sql` no SQL Editor, com os dois valores preenchidos.
5. Cadastrar os coletores em `social_collectors`.
6. Revisar e fazer o merge do pull request (`feature/social-networks` → `develop`) e, depois, a release para `main`.

## Não validado

- **Actors reais da Apify.** Nenhum foi executado. Os `field_map` do README precisam ser conferidos com a saída real de cada actor, com uma conta de verdade, antes de confiar nos números.
- **GA4 real.** O fluxo da conta de serviço e do relatório foi exercitado só contra um servidor local que imita o Google.
- **A função no ambiente hospedado.** Rodou no runtime local do Supabase. Limite de tempo, variáveis de ambiente da plataforma (`SUPABASE_SECRET_KEYS`) e a chamada pelo `pg_net` só se confirmam depois do deploy.
- **O agendamento no projeto hospedado.** O SQL do cron foi executado num banco local descartável (cria o job, guarda os valores no Vault, pode ser rodado de novo). No projeto real, falta ver a primeira execução das 06:00.
- **A aba contra o Supabase de produção.** Sem a migration aplicada lá, só é possível ver o aviso de "ainda não configurada".
- **Volume.** Testado com poucas contas e alguns meses de histórico. A tela carrega até 400 dias de fotografias, em páginas de 1.000 linhas.

## Fora do escopo desta entrega

- Tela para cadastrar e editar coletores (hoje é SQL) e botão "coletar agora".
- Publicações por formulário ou CSV, e miniaturas das publicações.
- Gráfico e metas para outras métricas além da audiência.
- Aviso de dados parados (conta sem número novo há vários dias sem que a coleta tenha falhado).
- Renomear uma marca em todas as contas de uma vez.
- Atualização em tempo real da aba.
- Expurgo de `social_collect_runs`, que cresce uma linha por rede por dia.

## Observações dos verificadores que não foram tratadas

Nenhuma reprovou uma fase. Ficam registradas para decisão:

- Um member pode sobrescrever, pelo formulário, uma fotografia que veio da coleta automática (a origem passa a `manual`). É intencional, mas a origem automática daquele dia se perde.
- No banco, `@acme` e `acme` na mesma rede são contas diferentes. A tela remove o `@` ao salvar, então isso só acontece por SQL.
- A função que herda o workspace da conta responde de forma diferente para uma conta inexistente e para uma conta de outro workspace. Só serve a quem já conhece o identificador (um UUID aleatório).
- O índice único de contas usa `lower(handle)`, que não pode ser alvo de `on_conflict` pela API: contas são criadas com `insert` simples.
- A marca não é normalizada no banco (`Acme` e `acme` seriam marcas diferentes se gravadas por SQL). A tela reaproveita a grafia existente.
