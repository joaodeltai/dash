# Redes sociais

A aba **Redes sociais** acompanha o crescimento da audiência das contas de cada marca do workspace. Os números entram de três formas, que convivem:

- **coleta automática diária**: a Edge Function `social-collect` roda todo dia às 06:00 (horário de Brasília), chama um actor da Apify por rede (ou a API do Google Analytics, para sites) e grava a fotografia do dia;
- **formulário "Lançar números"**: alguém digita os números de um dia;
- **importação de CSV**: o histórico de qualquer rede vem de uma planilha.

Uma conta tem no máximo uma fotografia por dia. Gravar o mesmo dia de novo, por qualquer um dos três caminhos, substitui os números em vez de duplicar.

> **Estado desta entrega.** O código está pronto e validado no Supabase local. Em produção ainda **não** foi feito: aplicar a migration, criar os secrets, fazer o deploy da função, agendar o `pg_cron` e cadastrar os coletores. Esses passos dependem de aprovação e estão em [Colocar em produção](#colocar-em-produção), na ordem. Enquanto a migration não for aplicada, a aba mostra o aviso "Redes sociais ainda não foi configurada aqui" e nada mais muda no app.

## O que existe

| Onde                                                     | O quê                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261111170127_social_networks.sql` | Seis tabelas, três views, índices, RLS. Só cria objetos novos.                                        |
| `supabase/functions/social-collect/`                     | A Edge Function da coleta (`index.ts`, `collect.ts`, `providers.ts`, `normalize.ts`).                 |
| `supabase/cron/social_collect_cron.sql`                  | Agendamento diário com `pg_cron`. **Não é migration**: roda-se à mão, uma vez.                        |
| `src/pages/social.js`, `src/social/`                     | A aba. É carregada só quando alguém a abre.                                                           |
| `src/i18n/pt-BR/social.js`                               | Textos em português (o inglês é a própria chave, como no resto do app).                               |
| `tests/sql/social_networks.sql`                          | Isolamento entre workspaces, upsert idempotente, crescimento com resultado conhecido.                 |
| `tests/unit/social-*.test.js`                            | Normalização e coleta (com banco e rede simulados); lógica da tela (CSV, datas, séries, metas).       |
| `tests/functions/social-collect.local.js`                | A função de verdade, servida localmente, contra um servidor que imita a Apify e o Google.             |
| `tests/e2e/social.spec.js`                               | A aba num navegador de verdade contra o Supabase local.                                               |
| `docs/social/`                                           | Este guia, [PADROES.md](PADROES.md), [SUPOSICOES.md](SUPOSICOES.md) e [PENDENCIAS.md](PENDENCIAS.md). |

### Tabelas

| Tabela                | Guarda                                                                                                           | Quem grava                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `social_accounts`     | Uma conta por rede e por marca (`brand`, `platform`, `handle`).                                                  | Pessoas (owner, admin, member).      |
| `social_snapshots`    | Os números de uma conta em um dia. Única por `(account_id, date)`.                                               | Coleta automática, formulário e CSV. |
| `social_posts`        | Publicações com curtidas, comentários, compartilhamentos e visualizações. Única por `(account_id, external_id)`. | Só a coleta automática.              |
| `social_goals`        | Meta de audiência por conta.                                                                                     | Pessoas.                             |
| `social_collectors`   | Como coletar cada rede: actor, entrada e mapa de campos. Uma linha por rede e por workspace.                     | Owner e admin (hoje, por SQL).       |
| `social_collect_runs` | Histórico: uma linha por rede a cada execução, com `status` (`success`, `partial`, `error`) e mensagem.          | Só a coleta automática.              |

Views (todas com `security_invoker`, então valem as mesmas regras de acesso das tabelas):

- `social_account_growth`: audiência atual de cada conta e variação em 7 dias, 30 dias e desde a primeira fotografia;
- `social_brand_growth`: os mesmos números somados por marca;
- `social_last_runs`: a última execução da coleta de cada rede. É dela que a tela tira o alerta de falha.

Acesso: owner, admin e member do workspace leem e escrevem; **convidado não vê esta área**. Pela API ninguém grava publicações nem histórico de coleta, e só entram fotografias com origem `manual` ou `csv`. A função grava com a chave secreta do projeto.

### Como o crescimento é calculado

"Hoje" é a data em `America/Sao_Paulo`. Para cada conta:

- **audiência** = valor da fotografia mais recente (até hoje);
- **7 dias** = audiência menos o valor da fotografia mais recente com data até hoje − 7 dias;
- **30 dias** = o mesmo, com 30 dias;
- **desde o início** = audiência menos o valor da primeira fotografia.

Conta com menos de 7 (ou 30) dias de histórico usa a primeira fotografia como base. O percentual é a variação dividida pela base. Por marca, somam-se as contas, e o percentual é a soma das variações dividida pela soma das bases.

O gráfico soma as contas que estão na tela, dia a dia, com o número mais recente de cada uma. Uma conta que começa a ser acompanhada no meio do período entra com o primeiro número conhecido, para que passar a acompanhá-la não apareça como crescimento. Assim a variação do gráfico bate com a dos totais.

## Colocar em produção

Nada abaixo foi executado. A ordem importa.

### 1. Criar os secrets da função

No painel do Supabase, em **Edge Functions → Secrets**, ou pela CLI:

```bash
# um segredo longo e aleatório, que só a função e o agendador conhecem
openssl rand -hex 32          # guarde o valor: ele é usado de novo no passo 4

supabase secrets set --project-ref <ref-do-projeto> \
  SOCIAL_COLLECT_SECRET=<valor gerado acima> \
  APIFY_TOKEN=<token da Apify>
```

| Secret                     | Obrigatório               | O que é                                                                                                                 |
| -------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `SOCIAL_COLLECT_SECRET`    | sim                       | Segredo compartilhado, com 16 caracteres ou mais. Quem chama a função precisa enviá-lo no cabeçalho `x-collect-secret`. |
| `APIFY_TOKEN`              | sim, para redes via Apify | Token da API da Apify (Apify Console → Settings → API & Integrations).                                                  |
| `GA4_SERVICE_ACCOUNT_JSON` | só para sites             | O arquivo JSON da conta de serviço do Google, inteiro, em uma linha. Ver [GA4](#ga4-sites).                             |
| `SOCIAL_TIME_ZONE`         | não                       | Fuso que define "o dia" da fotografia. Padrão: `America/Sao_Paulo`.                                                     |

`SUPABASE_URL` e a chave secreta do projeto já existem no ambiente de toda Edge Function; não é preciso criá-las.

Os tokens ficam **só** nos secrets do Supabase. Não vão para o repositório, para o front nem para os logs: a função manda o token da Apify no cabeçalho `Authorization` (nunca na URL) e remove qualquer segredo das mensagens de erro antes de gravá-las. Se um token já circulou por chat, e-mail ou captura de tela, gere outro na Apify e revogue o antigo antes de criar o secret.

### 2. Aplicar a migration

```bash
supabase db push --dry-run     # deve listar só 20261111170127_social_networks.sql
supabase db push
```

A migration só cria objetos (confira com `grep -inE "\b(alter|drop|update|delete)\b"`: os `alter` são `enable row level security` nas tabelas novas). Para aplicar pelo servidor MCP do Supabase em vez da CLI, siga a nota de `docs/DATABASE.md` ("Criar uma nova migration") sobre ajustar a versão no histórico.

Depois de aplicar, confira:

```bash
psql "<url do banco>" -v ON_ERROR_STOP=1 -f tests/sql/social_networks.sql    # termina com NOTICE: PASS e não deixa nada no banco
```

O front pode ser publicado antes ou depois: sem a migration ele mostra o aviso de área não configurada.

### 3. Fazer o deploy da função

```bash
supabase functions deploy social-collect --no-verify-jwt --project-ref <ref-do-projeto>
```

`--no-verify-jwt` é necessário: a função não recebe o token de um usuário, e sim o segredo compartilhado, que ela mesma confere. Sem o cabeçalho certo a resposta é `401`.

Teste antes de agendar (ainda sem coletores, a resposta é `{"ok":true,"runs":[]}`):

```bash
curl -sS -X POST "https://<ref-do-projeto>.supabase.co/functions/v1/social-collect" \
  -H "Content-Type: application/json" -H "x-collect-secret: $SOCIAL_COLLECT_SECRET" -d '{}'
```

### 4. Agendar a coleta diária

Abra `supabase/cron/social_collect_cron.sql`, troque os dois valores marcados com `<...>` (o endereço da função e o mesmo `SOCIAL_COLLECT_SECRET`) e rode o arquivo **no SQL Editor** do projeto. Não salve o arquivo com os valores preenchidos. O arquivo recusa rodar enquanto os marcadores estiverem lá, e pode ser rodado de novo para trocar um valor.

Ele liga `pg_cron` e `pg_net`, guarda o endereço e o segredo no Vault e agenda `social-collect-daily` para `0 9 * * *`. O `pg_cron` do Supabase conta em UTC, e 09:00 UTC é 06:00 em Brasília o ano todo. Os comandos de conferência e o de desligar (`cron.unschedule`) estão comentados no fim do arquivo.

### 5. Cadastrar os coletores

Sem linha em `social_collectors`, uma rede não é coletada (continua funcionando por formulário e CSV). Cadastre uma linha por rede. Ver [Coletores](#coletores).

## Coletores

Uma linha de `social_collectors` diz como coletar **uma rede** de **um workspace**:

| Coluna           | Para quê                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_id`   | O workspace (`select id, name from public.workspaces`).                                                                                               |
| `platform`       | A rede, igual ao `platform` das contas: `instagram`, `tiktok`, `youtube`, `facebook`, `linkedin`, `x`, `threads`, `pinterest`, `substack`, `website`. |
| `provider`       | `apify` (padrão) ou `ga4`.                                                                                                                            |
| `actor`          | O actor da Apify, no formato `usuario/nome`.                                                                                                          |
| `input_template` | A entrada enviada ao actor, com marcadores (abaixo).                                                                                                  |
| `field_map`      | Onde está cada número na resposta do actor (abaixo).                                                                                                  |
| `batch`          | `true` (padrão): uma execução com todas as contas da rede. `false`: uma execução por conta.                                                           |
| `timeout_secs`   | Quanto esperar pelo actor, de 10 a 300 (padrão 120).                                                                                                  |
| `enabled`        | `false` pausa a coleta da rede.                                                                                                                       |

**Trocar o actor de uma rede é mudar essa linha.** Não há nome de actor, de rede ou de campo no código da função:

```sql
update public.social_collectors
set actor = 'outro-usuario/outro-actor'       -- e, se a resposta for diferente, field_map e input_template
where workspace_id = '<id>' and platform = 'instagram';
```

### Marcadores do `input_template`

| Marcador      | Vira                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `{{handles}}` | A lista das contas da rede, sem `@`. Um texto que é só o marcador (ou uma lista que só contém o marcador) vira a lista. |
| `{{urls}}`    | A lista dos endereços de perfil preenchidos nas contas.                                                                 |
| `{{handle}}`  | A conta, como texto. Use com `batch = false`.                                                                           |
| `{{url}}`     | O endereço do perfil, como texto. Use com `batch = false`.                                                              |

Dentro de um texto maior os marcadores são substituídos no lugar: `"https://www.youtube.com/@{{handle}}"`.

### `field_map`

Caminhos separados por ponto, com índices para listas (`authorMeta.fans`, `latestPosts.0.id`).

| Chave         | Para quê                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item_kind`   | `profile` (padrão): cada item é uma conta, com as publicações numa lista interna. `post`: cada item é uma publicação que traz junto os números da conta. |
| `account_key` | Caminho do valor que diz de qual conta é o item (usuário ou endereço do perfil). Necessário quando uma execução traz várias contas.                      |
| `snapshot`    | Caminhos para `followers`, `following`, `posts_count`, `views`, `likes`, `comments`, `shares`. Só o que o actor devolver.                                |
| `extra`       | Opcional: outros valores a guardar em `social_snapshots.extra`.                                                                                          |
| `posts_path`  | Com `item_kind = profile`: caminho da lista de publicações dentro do item.                                                                               |
| `post`        | Caminhos para `external_id`, `url`, `caption`, `post_type`, `posted_at`, `likes`, `comments`, `shares`, `views`.                                         |
| `max_posts`   | Quantas publicações guardar por conta a cada coleta (padrão 50, máximo 100).                                                                             |

A conta é reconhecida sem diferenciar maiúsculas, com ou sem `@`, pelo usuário ou pelo endereço do perfil. Números aceitam `12345`, `"12,345"`, `"12.345"`, `"1.2K"` e `"3,4 mi"`. Datas aceitam ISO e tempo Unix em segundos ou milissegundos.

### Exemplos

Pontos de partida para três redes. Os nomes de campo foram conferidos na página pública de cada actor em novembro de 2026, mas **nenhum foi executado com uma conta real nesta entrega**: rode o actor uma vez no Apify Console com uma conta sua, compare a saída com o `field_map` e ajuste. Actors mudam de versão e de preço; confira o custo por execução na página do actor antes de agendar.

```sql
-- Instagram · apify/instagram-profile-scraper (um item por perfil, com as últimas publicações dentro)
insert into public.social_collectors (workspace_id, platform, actor, input_template, field_map) values (
  '<workspace_id>', 'instagram', 'apify/instagram-profile-scraper',
  '{"usernames": "{{handles}}"}',
  '{
    "account_key": "username",
    "snapshot": {"followers": "followersCount", "following": "followsCount", "posts_count": "postsCount"},
    "posts_path": "latestPosts",
    "post": {"external_id": "id", "url": "url", "caption": "caption", "post_type": "type", "posted_at": "timestamp",
             "likes": "likesCount", "comments": "commentsCount", "views": "videoViewCount"}
  }'
);

-- TikTok · clockworks/tiktok-scraper (cada item é um vídeo que traz os números do autor)
insert into public.social_collectors (workspace_id, platform, actor, input_template, field_map) values (
  '<workspace_id>', 'tiktok', 'clockworks/tiktok-scraper',
  '{"profiles": "{{handles}}", "resultsPerPage": 20}',
  '{
    "item_kind": "post",
    "account_key": "authorMeta.name",
    "snapshot": {"followers": "authorMeta.fans", "following": "authorMeta.following", "likes": "authorMeta.heart", "posts_count": "authorMeta.video"},
    "post": {"external_id": "id", "url": "webVideoUrl", "caption": "text", "posted_at": "createTimeISO",
             "likes": "diggCount", "comments": "commentCount", "shares": "shareCount", "views": "playCount"}
  }'
);

-- YouTube · streamers/youtube-scraper (cada item é um vídeo; uma execução por canal)
insert into public.social_collectors (workspace_id, platform, actor, batch, input_template, field_map) values (
  '<workspace_id>', 'youtube', 'streamers/youtube-scraper', false,
  '{"startUrls": [{"url": "https://www.youtube.com/@{{handle}}"}], "maxResults": 10}',
  '{
    "item_kind": "post",
    "snapshot": {"followers": "numberOfSubscribers"},
    "post": {"external_id": "id", "url": "url", "caption": "title", "posted_at": "date",
             "likes": "likes", "comments": "commentsCount", "views": "viewCount"}
  }'
);
```

Para as outras redes (Facebook, LinkedIn, X, Threads, Pinterest), escolha um actor na Apify Store, rode-o uma vez, veja o formato da saída e escreva o `field_map` do mesmo jeito. Redes sem actor (Substack, por exemplo) ficam no formulário e no CSV.

### Rodar a coleta à mão

```bash
# tudo
curl -sS -X POST "https://<ref-do-projeto>.supabase.co/functions/v1/social-collect" \
  -H "Content-Type: application/json" -H "x-collect-secret: $SOCIAL_COLLECT_SECRET" -d '{}'

# só uma rede de um workspace
... -d '{"workspace_id": "<id>", "platform": "instagram"}'
```

A resposta traz uma linha por rede: `status`, `message`, contas coletadas, fotografias e publicações gravadas. O mesmo fica em `social_collect_runs`:

```sql
select platform, status, message, accounts_ok, accounts_total, snapshots_written, posts_written, finished_at
from public.social_last_runs where workspace_id = '<id>';
```

### Como a função se comporta

- **Cada rede é isolada.** As redes rodam em paralelo; a falha de uma vira uma linha `error` com a mensagem e não interrompe as outras. A linha do histórico é gravada assim que a rede termina.
- **`partial`** = algumas contas da rede vieram e outras não (a mensagem diz quais).
- **Só contas ativas** (`is_active`) de redes com coletor ligado (`enabled`) entram.
- **Idempotente.** Rodar duas vezes no mesmo dia atualiza a fotografia do dia e as publicações; não duplica.
- **Tempo.** A função espera cada actor por `timeout_secs` + 10 s. O limite de uma Edge Function é de 150 s no plano gratuito e 400 s nos pagos: no gratuito, mantenha `timeout_secs` em até 120. Se as redes ficarem lentas, agende uma chamada por rede (mesmo arquivo de cron, com `body := '{"platform":"instagram"}'::jsonb` e outro nome de job).
- **Fotografia do dia.** A coleta substitui os números do dia, inclusive os lançados à mão antes dela. O que for lançado depois da coleta vale até a coleta do dia seguinte.

## GA4 (sites)

Para acompanhar um site, a "audiência" é o número de usuários ativos nos últimos 28 dias.

1. No Google Cloud, crie um projeto (ou use um existente), ative a **Google Analytics Data API** e crie uma **conta de serviço** com uma chave JSON.
2. No Google Analytics, em **Administrador → Gerenciamento de acesso da propriedade**, adicione o e-mail da conta de serviço com o papel **Leitor**.
3. Crie o secret `GA4_SERVICE_ACCOUNT_JSON` com o conteúdo do arquivo JSON em uma linha:

   ```bash
   supabase secrets set --project-ref <ref-do-projeto> GA4_SERVICE_ACCOUNT_JSON="$(tr -d '\n' < chave.json)"
   ```

   Apague o arquivo local depois. Ele não deve entrar no repositório.

4. Na aba, adicione uma conta com a rede **Site** e, no campo da conta, o **ID da propriedade do GA4** (só dígitos; está em Administrador → Detalhes da propriedade).
5. Cadastre o coletor:

   ```sql
   insert into public.social_collectors (workspace_id, platform, provider, field_map) values (
     '<workspace_id>', 'website', 'ga4',
     '{"snapshot": {"followers": "activeUsers", "views": "screenPageViews"}}'
   );
   ```

Com `input_template` vazio, a função pede `activeUsers`, `sessions` e `screenPageViews` do período de 28 dias terminado ontem. Para outro relatório, coloque em `input_template` o corpo de um `runReport` da Data API e aponte o `field_map` para os nomes das métricas pedidas.

## Plano B: formulário e CSV

Funcionam para qualquer rede, com ou sem coletor.

**Lançar números.** Botão no topo da aba ou no cartão da conta. Escolha a conta e o dia (não pode ser futuro) e digite a audiência; os outros números são opcionais. Se o dia já tiver números, a tela avisa e os campos preenchidos substituem os anteriores.

**Importar CSV.** Botão **Importar CSV**: escolha um arquivo ou cole as linhas. A tela mostra quantos dias estão prontos e quais linhas têm problema (com o número da linha) antes de importar; linhas com problema ficam de fora.

- Uma linha por dia. A primeira linha dá o nome das colunas.
- Separador: vírgula, ponto e vírgula ou tab, detectado pela primeira linha não vazia. Arquivos salvos pelo Excel em português são lidos como estão: ponto e vírgula, codificação do Windows e a linha `sep=;` que ele às vezes escreve no topo.
- Colunas aceitas, em inglês ou português, sem diferenciar maiúsculas e acentos:

  | Coluna      | Também aceita                                                                                        |
  | ----------- | ---------------------------------------------------------------------------------------------------- |
  | `date`      | `data`, `dia`, `day`                                                                                 |
  | `followers` | `seguidores`, `subscribers`, `assinantes`, `inscritos`, `audience`, `audiência`, `users`, `usuários` |
  | `following` | `seguindo`                                                                                           |
  | `posts`     | `publicações`, `postagens`, `videos`                                                                 |
  | `views`     | `visualizações`, `impressions`, `impressões`, `pageviews`                                            |
  | `likes`     | `curtidas`                                                                                           |
  | `comments`  | `comentários`                                                                                        |
  | `shares`    | `compartilhamentos`                                                                                  |
  | `platform`  | `rede`, `plataforma`, `network`                                                                      |
  | `handle`    | `conta`, `usuário`, `account`, `username`, `perfil`                                                  |

- `date` é obrigatória, e pelo menos uma coluna de número.
- Datas: `2026-01-31`, `2026/01/31` ou `31/01/2026` (dia primeiro), com ou sem hora depois. Datas futuras são recusadas.
- Números inteiros: `12345`, `12.345`, `12,345`, `1.234,00`, `1,2 mil`, `3.4k`. Número com casas decimais que não sejam zero é recusado.
- Com as colunas `platform` e `handle`, um arquivo alimenta várias contas de uma vez (as contas precisam existir). Sem elas, escolha a conta no diálogo.
- Um dia que aparece duas vezes para a mesma conta fica com a última linha. Os números do arquivo substituem os que já estavam gravados naquele dia; uma célula vazia não altera o número que já existia.
- Limite: 2 MB por arquivo.

Exemplo (o botão **Baixar um exemplo** entrega um arquivo assim):

```csv
date,platform,handle,followers,posts,views,likes,comments,shares
2026-01-30,substack,minhanewsletter,1180,,,,,
2026-01-31,substack,minhanewsletter,1204,,,,,
2026-01-31,instagram,minhamarca,12345,210,,,,
```

**Substack.** Não há coleta automática. Adicione a conta com a rede Substack (o campo da conta é o endereço da publicação sem `.substack.com`) e lance o número de assinantes pelo formulário ou por um CSV com `date` e `followers`.

## Rodar e testar localmente

Precisa de Docker e do Supabase local (`supabase start`; este projeto usa as portas 5532x).

```bash
supabase migration up                                   # aplica as migrations pendentes no banco local
psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/social_networks.sql
npm test                                                # unitários (inclui o coletor e a lógica da tela)
node tests/functions/social-collect.local.js            # a função servida localmente contra actors simulados
npx playwright test tests/e2e/social.spec.js            # a aba no navegador
npm run lint && npm run format:check && npm run build
```

`tests/functions/social-collect.local.js` sobe a função com `supabase functions serve`, um servidor local que imita a Apify, o login do Google e a Data API do GA4, cria um workspace próprio, confere o que foi gravado (inclusive com um actor forçado a falhar e com a troca de actor por uma linha) e apaga tudo no fim. O token e o segredo usados nele são gerados na hora e não saem da máquina.

Para servir a função à mão:

```bash
cat > /tmp/social.env <<'EOF'
SOCIAL_COLLECT_SECRET=um-segredo-local-qualquer-123
APIFY_TOKEN=<um token de teste>
EOF
supabase functions serve social-collect --no-verify-jwt --env-file /tmp/social.env
```

Arquivos `.env*` estão no `.gitignore`. Não coloque o token de produção num arquivo dentro do repositório.

## Problemas comuns

| O que aparece                                                    | Causa provável e o que fazer                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Aba mostra "Redes sociais ainda não foi configurada aqui"        | A migration não foi aplicada neste banco (passo 2).                                                                                    |
| Alerta "a última coleta automática falhou" numa rede             | Leia a mensagem no alerta ou em `social_last_runs`. Enquanto isso, os números podem ser lançados à mão pelo botão do próprio alerta.   |
| `actor ... failed (HTTP 401)`                                    | `APIFY_TOKEN` errado ou revogado. Recrie o secret.                                                                                     |
| `actor ... failed (HTTP 404)`                                    | Nome do actor errado em `social_collectors.actor`.                                                                                     |
| `actor ... timed out`                                            | Aumente `timeout_secs`, reduza o que o actor busca (`resultsPerPage`, `maxResults`) ou agende a rede separadamente.                    |
| `no numbers returned for ...`                                    | O actor rodou, mas o `field_map` não achou os números: compare com a saída real do actor. Ou a conta não existe na rede.               |
| `APIFY_TOKEN is not set` / `GA4_SERVICE_ACCOUNT_JSON is not set` | Falta o secret (passo 1).                                                                                                              |
| A função responde `401`                                          | O cabeçalho `x-collect-secret` não bate com o secret `SOCIAL_COLLECT_SECRET`. No cron, o valor vem do Vault (`social_collect_secret`). |
| A função responde `500` com `SOCIAL_COLLECT_SECRET is not set`   | O secret não existe ou tem menos de 16 caracteres.                                                                                     |
| O cron não roda                                                  | Confira `cron.job` e `cron.job_run_details` (consultas no fim de `social_collect_cron.sql`) e a resposta em `net._http_response`.      |
| Nenhuma linha em `social_collect_runs` depois de uma execução    | Não há coletor ligado com conta ativa, ou a função foi encerrada por tempo antes de qualquer rede terminar.                            |
