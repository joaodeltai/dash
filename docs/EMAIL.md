# Caixa comercial do CRM

A tela **Configurações de e-mail** liga o CRM à caixa `contato@grupodeltai.com.br` na Hostinger. A senha é digitada nessa tela e gravada cifrada. O navegador não a recebe de volta. Nenhum e-mail sai sozinho.

## Onde abrir

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Menu           | Barra lateral, grupo **Workspace**, item **E-mail** (logo abaixo de CRM). No inglês da interface o item se chama `Email`. |
| Aba            | Dentro do CRM, a aba **E-mail**.                                                                                          |
| Rota           | `#/crm/email`                                                                                                             |
| Título da tela | **Configurações de e-mail**                                                                                               |
| Comando        | Paleta (`⌘K` / `Ctrl+K`): **Ir para Configurações de e-mail**                                                             |

A leitura e o teste de login rodam numa função da Vercel (`/api/email/...`), não no navegador. `npm run dev` não serve essa função. Ela aparece no deploy (produção ou preview).

## Campos

| Campo           | Sugestão                     | Observação                                                |
| --------------- | ---------------------------- | --------------------------------------------------------- |
| E-mail da caixa | `contato@grupodeltai.com.br` | Já vem preenchido.                                        |
| Usuário         | `contato@grupodeltai.com.br` | Na Hostinger o usuário é o próprio e-mail.                |
| Senha           | vazia                        | Não há valor de exemplo. O campo fica vazio de propósito. |
| Servidor IMAP   | `imap.hostinger.com`         | Só este host é aceito.                                    |
| Porta IMAP      | `993`                        | SSL/TLS, obrigatório.                                     |
| Servidor SMTP   | `smtp.hostinger.com`         | Só este host é aceito.                                    |
| Porta SMTP      | `465`                        | SSL/TLS, obrigatório.                                     |
| POP3            | `pop.hostinger.com:995`      | Só informação. Nada conecta em POP3.                      |

**Testar IMAP** e **Testar SMTP** só fazem login e desligam. Não enviam mensagem, não marcam nada como lido e não mudam etapa de lead.

**Ler caixa** copia o total, as não lidas e as últimas mensagens. A caixa abre com `EXAMINE` (somente leitura) e o corpo sai com `BODY.PEEK`. A função não marca como lida, não move e não apaga.

Uma resposta casada com um lead (pelo e-mail do remetente, ou por `In-Reply-To` / `References` de um envio futuro) aparece em **Respostas para triagem** e na gaveta do lead, em **Respostas da caixa**. Isso não muda a etapa e não altera `email_draft`.

**Aprovar esta versão para envio**, na gaveta do lead, grava a aprovação. Não envia.

## Segredos no servidor

Nenhum deles é a senha da caixa. Nenhum pode ter prefixo `VITE_` (o Vite copiaria o valor para o site). Na Vercel: **Settings → Environment Variables**, ambientes Production e Preview, tipo **Sensitive**.

| Variável                   | Obrigatória para                           | Valor                                                               |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `EMAIL_CREDENTIALS_KEY`    | gravar e ler a senha cifrada               | 32 bytes em base64. Não invente um texto curto.                     |
| `SUPABASE_SECRET_KEY`      | a função falar com o banco                 | Secret key do projeto (`sb_secret_...`) ou a `service_role` legada. |
| `SUPABASE_URL`             | idem, se a `VITE_SUPABASE_URL` não existir | `https://mgnmkdutkppchqpffxwq.supabase.co`                          |
| `SUPABASE_PUBLISHABLE_KEY` | conferir o login de quem usa a tela        | a publishable key. Pode ficar só a `VITE_` que já existe.           |
| `EMAIL_SENDING_ENABLED`    | envio                                      | deixe `false`. Só a string `true` libera.                           |
| `EMAIL_READ_SYNC_ENABLED`  | leitura periódica                          | deixe `false`.                                                      |
| `CRON_SECRET`              | o endpoint de leitura periódica            | um segredo longo, só se for ligar o cron.                           |

Gerar a chave mestra:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Cole o resultado em `EMAIL_CREDENTIALS_KEY`. Não commite, não cole no banco e não use essa chave como senha da caixa. Sem ela, **Salvar conexão** responde que a chave não está configurada e não grava a senha em lugar nenhum.

A senha da caixa fica em `crm_mailbox_secrets` como `ciphertext`, `nonce` e `tag` (AES-256-GCM). A tabela não tem política para o navegador e o `SELECT` foi revogado de `anon` e `authenticated`. Quem descriptografa é a função da Vercel.

## Ordem para ligar

1. Aplicar a migration `supabase/migrations/20261118183000_crm_mailbox.sql` no projeto `mgnmkdutkppchqpffxwq`. Este repositório não aplica essa migration.
2. Definir os segredos na Vercel, ainda com `EMAIL_SENDING_ENABLED=false`.
3. Merge do PR em `main` (o deploy da Vercel publica a função). Não faça o merge antes da migration se quiser a tela funcionando no primeiro acesso: a tela avisa que a migration falta e o resto do CRM continua.
4. Abrir `#/crm/email`, conferir os campos sugeridos, digitar a senha real e clicar em **Salvar conexão**.
5. **Testar IMAP** e **Testar SMTP**. Os dois devem responder sucesso sem enviar nada.
6. **Ler caixa**. A tela mostra total, não lidas, últimas mensagens e respostas casadas com leads.

## Consultar a caixa (assistente)

Snapshot já gravado, sem abrir IMAP e sem enviar:

```http
GET /api/email/status?workspaceId=<uuid-do-workspace>
Authorization: Bearer <access_token de um membro do workspace>
```

A resposta tem `status.total`, `status.unseen`, `status.lastSyncAt`, `latest`, `matched` e `sendingEnabled`. Não traz senha nem ciphertext.

Leitura ao vivo (também só leitura): `GET /api/email/status?workspaceId=<uuid>&live=1`. O mesmo efeito do botão **Ler caixa** é `POST /api/email/sync` com `{ "workspaceId": "<uuid>" }`.

No SQL do Supabase, sem passar pela caixa:

```sql
select m.address, s.total_messages, s.unseen_messages, s.last_sync_at, s.last_error
from public.crm_mailboxes m
left join public.crm_mailbox_status s on s.mailbox_id = m.id;

select i.from_email, i.subject, i.received_at, i.needs_triage, l.deal_id, l.match_reason
from public.crm_inbox_messages i
left join public.crm_inbox_links l on l.message_id = i.id
order by i.received_at desc nulls last
limit 30;
```

Não consulte `crm_mailbox_secrets` para "ver a senha": aquilo é ciphertext e a chave não está no banco.

O `workspaceId` é o `id` em `public.workspaces`.

## Envio

Continua desligado. As duas travas são independentes:

1. `EMAIL_SENDING_ENABLED` precisa ser exatamente `true`. Qualquer outro valor, inclusive vazio ou `TRUE`, deixa o envio recusado.
2. A mensagem precisa de uma linha em `crm_email_approvals` ainda não consumida, criada pelo botão **Aprovar esta versão para envio**.

Não há botão de enviar na tela. Não há cron, trigger nem job que envie. O único caminho que sabe enviar é `POST /api/email/send` com `{ "workspaceId", "approvalId" }`, e ele responde `sending_disabled` enquanto a trava global estiver desligada, sem abrir o SMTP.

Quando for a hora do primeiro teste, com uma mensagem que você queira de fato enviar: aprove essa versão, mude a variável para `true`, faça um novo deploy e chame o endpoint. Trocar a variável de volta para `false` fecha de novo.

## Leitura periódica (opcional, desligada)

`POST /api/email/cron-sync` com `Authorization: Bearer <CRON_SECRET>` só lê, e só se `EMAIL_READ_SYNC_ENABLED=true`. Sem o segredo responde 401. Com o segredo e a flag apagada, responde `{ "skipped": true, "sent": false }` e não conecta.

O `vercel.json` não registra cron. Para ligar depois, com a flag ainda em `false` até você querer a leitura automática:

```json
{ "path": "/api/email/cron-sync", "schedule": "0 * * * *" }
```

Esse cron não muda etapa de lead.
