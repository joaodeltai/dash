# Suposições

O que foi decidido sem perguntar, porque a instrução era não interromper o trabalho. Em cada item: o que faltava, o que foi assumido e onde mudar se a suposição estiver errada.

## Sobre o pedido

1. **O campo ESCOPO veio vazio.** O texto dizia "[Cole aqui os itens 1 a 4 da especificação original…]" e os itens não foram colados. O escopo foi tirado das fases, dos critérios de pronto e das regras. Tudo o que está nesta lista sob "Produto" é consequência disso: se a especificação original dizia outra coisa, é aqui que a entrega pode divergir dela.
2. **O token da Apify colado na conversa não foi usado nem gravado.** Ele não está em nenhum arquivo, comando, teste ou log desta entrega, e nenhuma chamada real à Apify foi feita. Os testes usam um token gerado na hora contra um servidor local que imita a Apify. Como o token ficou registrado no histórico da conversa, o mais seguro é gerar outro na Apify, revogar esse e só então criar o secret.
3. **"Validar localmente" foi feito no Supabase local (Docker), não numa branch do Supabase.** Criar uma branch tem custo e não era necessário. Nada foi aplicado, publicado ou agendado em produção.

## Produto

4. **Redes conhecidas pela tela:** Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Threads, Pinterest, Substack e Site. O X é gravado como `twitter`, porque o banco exige identificador de rede com duas letras ou mais. O banco aceita qualquer identificador de rede; acrescentar uma à tela é uma linha em `src/social/platforms.js`.
5. **"Marca" é um texto livre na conta.** Não há cadastro de marcas. Contas com a mesma marca são somadas. A tela reaproveita a grafia de uma marca que já existe (sem diferenciar maiúsculas); o banco não normaliza.
6. **"Totais por marca" somam a audiência de todas as contas da marca**, inclusive a de um site (usuários ativos em 28 dias), se a marca tiver um. Se o site não deve entrar na soma, dê a ele uma marca própria.
7. **"Cartões por rede" virou um cartão por conta**, com a rede em destaque. Com uma conta por rede, é o mesmo; com várias marcas, cada conta tem o seu cartão e os filtros de marca e de rede reduzem a lista.
8. **A métrica acompanhada é a audiência** (seguidores, inscritos, assinantes ou usuários ativos). Curtidas, comentários, compartilhamentos, visualizações e número de publicações são guardados quando chegam, mas o gráfico, o crescimento e as metas olham só a audiência.
9. **Crescimento:** variação entre a fotografia mais recente e a mais recente com data até hoje − 7 (ou − 30) dias; conta com menos histórico usa a primeira fotografia. "Hoje" é o dia em `America/Sao_Paulo`. O gráfico segue a mesma regra: uma conta que começa a ser acompanhada no meio do período entra com o primeiro número conhecido, para não aparecer como um salto.
10. **O gráfico tem uma linha só:** a soma das contas na tela, ou uma conta escolhida. A comparação entre contas é feita pelos cartões, cada um com a sua linha pequena. Motivo: as cores do tema existente não formam uma paleta de séries distinguível por pessoas com daltonismo (conferido com um validador), e a regra era usar só as variáveis de tema existentes.
11. **Uma fotografia por conta e por dia; a última gravação vence, número a número.** A coleta automática substitui os números que ela traz, inclusive os lançados à mão no mesmo dia antes dela, e não mexe nos que o actor não devolve; o que for lançado depois vale até a coleta seguinte. No formulário e no CSV, campo ou célula vazia não apaga número já gravado.
12. **Publicações só chegam pela coleta automática.** O formulário e o CSV cobrem os números das contas, não publicações. Redes sem coletor não aparecem em "Melhores publicações".
13. **"Melhores publicações" ordena por curtidas + comentários + compartilhamentos**, entre as 200 de maior engajamento do workspace. Sem miniaturas: a política de conteúdo do site só permite imagens do próprio domínio e do Supabase, e mudá-la exigiria alterar `vercel.json`.
14. **Metas: uma por conta, para a audiência**, com data opcional.
15. **Convidados não veem a área.** As políticas de leitura usam `private.can_write` (owner, admin, member) em vez de `private.is_member`, e o item da barra lateral não aparece para convidado. As demais tabelas de escopo de workspace do app deixam o convidado ler; aqui foi escolhido o caminho mais restrito.
16. **Coletores são cadastrados por SQL, por owner ou admin.** Não há tela para isso nem botão "coletar agora"; a coleta manual é uma chamada HTTP com o segredo (ver README).
17. **Sem atualização em tempo real.** As tabelas novas não entram na publicação Realtime (seria alterar um objeto existente). A aba relê os dados ao abrir, ao voltar depois de um minuto e depois de cada alteração.
18. **CSV com datas em dia/mês/ano.** `01/02/2026` é 1º de fevereiro.

## Coleta

19. **Chamada síncrona à Apify** (`run-sync-get-dataset-items`), uma execução por rede com todas as contas (ou uma por conta, com `batch = false`). É o desenho mais simples que cabe no tempo de uma Edge Function com poucas contas. Com muitas contas ou actors lentos, o caminho é agendar uma chamada por rede.
20. **Autorização por segredo compartilhado** (`x-collect-secret`), com a função publicada com `--no-verify-jwt`. O projeto usa as chaves novas do Supabase (`sb_publishable_…`), que a verificação de JWT da plataforma não entende. A opção fica no comando de deploy, não em `supabase/config.toml`, para não alterar arquivo existente.
21. **Valores guardados em inglês**, como no resto do banco: o status de falha é `error` (o critério diz "status erro").
22. **Três status:** `success`, `partial` (algumas contas da rede vieram, outras não) e `error`. A tela alerta em vermelho para `error` e em amarelo para `partial`.
23. **GA4 entra como um segundo provedor** (`provider = 'ga4'`), com conta de serviço. A audiência de um site é `activeUsers` dos últimos 28 dias. Foi validado só contra um servidor que imita o Google.
24. **Os actors sugeridos no README não foram executados.** Quem preparou a entrega conferiu os nomes de campo nas páginas públicas dos actors, mas sem conta real e sem gastar créditos. São pontos de partida. No exemplo do YouTube, a conta é o nome do canal depois do `@`.
25. **O dia é o de Brasília, fixo.** A fotografia é datada com o dia da execução em `America/Sao_Paulo`, o mesmo fuso que a view de crescimento usa para "hoje". O fuso não é configurável, para as duas coisas não se desencontrarem. No GA4, o relatório cobre os 28 dias terminados na véspera e é gravado com a data da execução.
26. **Limites:** até 100 publicações por conta por coleta (padrão 50), legenda cortada em 5.000 caracteres, mensagem de erro em 1.000.

## Código

27. **Onde a aba se afasta do padrão do repositório**, para cumprir "não alterar arquivo existente além do registro da aba": dados lidos e gravados direto pelo cliente Supabase (fora do motor de sincronização), CSS importado pelo módulo da página, diálogos desenhados pela própria página com as classes de modal, e página carregada sob demanda. Detalhes em [PADROES.md](PADROES.md), seção 7. Arquivos existentes alterados: `src/shell/render.js`, `src/shell/layout.js` e `src/i18n/pt-BR/index.js`.
28. **Carregamento sob demanda para não criar aviso no build.** Com a aba dentro do pacote principal, ele passava de 500 kB e o Vite emitia um aviso que antes não existia. O pacote principal está em 488 kB (era 473 kB): a folga é de 12 kB, e qualquer crescimento futuro do app pode trazer o aviso de volta, com ou sem esta aba.
29. **"Existe em pt e en"** foi lido conforme o padrão do repositório: o inglês é a própria chave e o português fica no dicionário. O teste de dicionário cobre os textos novos.
30. **Reforços feitos depois da aprovação da Fase 2**, a partir das observações do verificador: o histórico de cada rede é gravado assim que ela termina, a mensagem de erro aceita qualquer valor lançado, e o SQL do agendamento pode ser rodado de novo. Foram testados (unitários e teste local da função) e entram na verificação final.

## Ambiente

31. **O banco local recebeu as migrations pendentes** (`supabase migration up`): a de chaves de tarefa, que já estava em produção, e a nova. Nada foi apagado.
32. **Conta de demonstração no Supabase local**, criada a pedido durante o trabalho: `demo@dash-local.test`, workspace "Estúdio Demo", com dados de exemplo. Existe só na máquina local.
