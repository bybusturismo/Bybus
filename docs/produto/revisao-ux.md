# Revisão de UX/UI — diagnóstico, padrão visual e consolidações propostas

Data: 06/11/2026. Pedido do dono: "analise todos os detalhes do sistema, melhore todos os layouts, deixe clean, claro, com as informações bem destacadas e aproveitadas na tela, e reúna melhor as informações para ficarem acessíveis e intuitivas". Preferências já registradas: letras pequenas e muita informação por tela; menu de áreas no topo; Listas de passageiros como item principal do dia a dia.

Evidência: capturas de todas as telas do menu em 1440x900 e 390x844 antes e depois (demonstração com dados fictícios). O que mudou no código está em `apps/web/src/estilos/padrao.css` e `apps/web/src/componentes/Pagina.tsx`.

## 1. Diagnóstico (antes)

### Problemas que se repetiam em quase todas as telas
1. **Densidade baixa apesar do pedido do dono.** Corpo em 14px, botões e campos de 44px de altura no computador, cartões com 20px de respiro, indicadores de 80px de altura. Telas de 3 linhas de dado ocupavam a tela inteira.
2. **Cabeçalho gasto em duas ou três faixas.** Título, depois um cartão branco de filtros, depois (em alguns módulos) as abas. Cada tela montava o cabeçalho de um jeito.
3. **Abas inconsistentes.** Financeiro tinha as abas acima do título; Frota, abaixo; Gestores, Importar, Saída e Extrato tinham outras variações (altura, sublinhado, espaçamento).
4. **Cartões onde cabia tabela.** Conferência (53 cartões de 130px, página de 9.945px de altura), Listas de passageiros e Saídas (cartões com 8 blocos cada) obrigavam a rolar muito e impediam comparar linhas.
5. **Botões sem hierarquia.** Várias telas com 3 ou 4 botões primários azuis lado a lado; "Excluir" em vermelho cheio dentro de tabelas (Frota) ao lado de ações comuns; botões de linha empilhados em 3 andares (Financeiro, Contas a pagar).
6. **Etiquetas de status** com formatos e cores diferentes por módulo (algumas só texto cinza, outras com borda).
7. **Estados vazios e de erro** variavam: texto solto em umas telas, caixa em outras.
8. **Informação que pede ação sem destaque.** Pendência, abaixo do mínimo e vencido só tinham etiqueta pequena; nada na linha inteira.
9. **Celular.** Texto de 13px nos campos (o iPhone dá zoom), tabelas largas com rolagem lateral (Saídas, Conferência, Reservas da saída), botões longos estourando a largura, balão do Turistinha cobrindo a última linha.

### Por tela (resumo)
| Tela | Principais problemas | Situação agora |
|---|---|---|
| Visão Geral | KPIs altos e com espaço vazio embaixo; atalhos soltos | KPIs compactos, sem esticar; mesmo padrão de cartão |
| Listas de passageiros | Automação em cartão grande; um cartão enorme por passeio com 5 botões | Faixa de automação de 1 linha; tabela com situação, contagens e ações na linha; linha âmbar quando está aberta ou tem adendo pendente |
| Saídas | Título repetido, cartão por saída com bloco de calendário, filtros em cartão, 4 KPIs grandes | Tabela densa (data, passeio, situação, ocupação, pagantes, equipe, ação); filtros e período na faixa do título; faixa de números; linha âmbar abaixo do mínimo |
| Saída (lista, reservas, embarque) | Cabeçalho de data grande, resumo em 2 linhas, alertas altos | Resumo em linha única, alertas compactos; Reservas com tabela rolável no celular |
| Conferência | 53 cartões enormes (9.945px) | Tabela única (981px, com rolagem interna e cabeçalho fixo), faixa de números (total, a conferir, com alerta), linhas com alerta destacadas, cartões no celular |
| Rastreamento | Filtro de dia em cartão sozinho | Dia na faixa do título |
| Escala | Linhas de 45px por causa dos campos de 44px | Linhas de 26 a 30px, mês no cabeçalho |
| Transfer, Meu transfer, Motorista | Mistura de caixas; texto pequeno no celular | Mesma escala; no celular texto um degrau maior e alvos de 44px |
| Listagem de reservas | Filtros com rótulo em cima, grade irregular | Barra de filtros única, tabela densa |
| WhatsApp, Importar | Textarea gigante, cartão de aviso alto | Textarea limitada, aviso compacto |
| Passeios, Equipe, Auditoria | Filtros em cartão abaixo do título | Filtros na faixa do título, rótulo ao lado do campo |
| Financeiro (9 abas) | Abas acima do título; botões empilhados na linha; "Excluir" vermelho | Abas iguais às da Frota (acima do título, componente único); ações da linha em uma fila; exclusão só com contorno |
| Frota (6 abas) | Excluir em vermelho cheio; etiquetas estourando no celular | Mesmo padrão das abas; contorno; etiquetas quebram linha |
| Marketing | Filtro de período em cartão; KPIs altos | Período na faixa do título; KPIs compactos |
| Gestores de IA, Biblioteca, Configurações, Integrações, Praças, Usuários, Perfis, Auditoria, Meu perfil | Cartões altos, títulos grandes | Escala e cartões do padrão novo |
| Login e páginas públicas | Sem problema estrutural | Só herdam a escala (no celular o texto fica maior, bom para sol forte) |

## 2. Padrão visual único (implementado)

- **Escala tipográfica** (tokens): microtexto 11px (só rótulos em caixa-alta), tabelas e rótulos 12,5px, corpo 13px, título de cartão 15px, título de página 20px. No celular e em telas de toque, um degrau acima em tudo (corpo 15px, tabelas 14px). Campos do celular em 16px.
- **Densidade por ponteiro:** computador com mouse usa controles de 32px (botões, campos, abas) e linhas de tabela de 26 a 32px; celular e toque mantêm 44px. É um único token (`--alvo-toque`), então toda tela nova já nasce certa.
- **Formas:** raios 8/10px, sem sombras pesadas; topo de 52px.
- **Cabeçalho de página** (`CabecalhoPagina`): título + subtítulo curto à esquerda, filtros no meio, ações à direita, na mesma faixa quando cabem. Páginas antigas ganham o mesmo efeito por CSS (o filtro que vem logo abaixo do título sobe para a faixa do título a partir de 900px).
- **Barra de filtros única:** rótulo ao lado do campo, sem cartão quando está ao lado do título.
- **Indicadores:** `Indicador` compacto (número em destaque, rótulo pequeno em caixa-alta) e `FaixaNumeros` (números do dia em linha, com tom de atenção/perigo/sucesso).
- **Tabela densa:** cabeçalho fixo (a tabela rola dentro da caixa no computador), números à direita com algarismos tabulares, zebra suave, botões de linha de 26px, e destaque de linha para o que exige ação: `linha--atencao` (âmbar), `linha--perigo` (vermelho), `linha--ok` (apagada). A cor nunca está sozinha: sempre há etiqueta ou texto.
- **Etiquetas de status** (`Etiqueta`): verde = ok, âmbar = atenção, vermelho = ação urgente, azul = informação, cinza = neutro, em todo o sistema.
- **Botões:** um primário por área; secundário com contorno; exclusão dentro de tabela só com contorno vermelho (vermelho cheio fica para a janela de confirmação).
- **Abas** (`AbasModulo`): mesmo componente em Financeiro e Frota, mesma altura e sublinhado em todas as demais.
- **Estados:** vazio e erro em caixa tracejada (erro em vermelho suave), carregamento centralizado, avisos compactos.
- **Celular:** as tabelas do dia (Listas, Saídas, Conferência) viram cartões de uma coluna com rótulo por linha; botões de ação em largura cheia com 44px; espaço no fim da página para o Turistinha.
- **Acessibilidade:** foco com anel duplo preservado, contraste dos tokens inalterado (AA), rótulos mantidos, tema escuro validado.

## 3. Verificação

- `pnpm -r typecheck` e testes do web (188) verdes.
- Demonstração gerada; todas as telas do menu nos dois tamanhos sem erro de console (fora os blocos de mapa do OpenStreetMap, sem internet no sandbox) e sem rolagem horizontal da página.
- Altura total da página (1440px, antes para depois): Conferência 9.945 para 981; Reservas 3.240 para 1.098; Escala 2.205 para 1.085; Saídas 1.597 para 932. (Nas tabelas longas, parte do conteúdo agora rola dentro da própria tabela, com o cabeçalho fixo.)
- No celular, a Visão Geral ficou um pouco mais alta (3.644 para 3.985) porque o texto subiu um degrau; é uma escolha para leitura ao sol.
- Impressão da lista de passageiros conferida (continua em A4, com a coluna de visto).

## 4. Consolidações propostas (para o dono decidir; nada foi removido)

| # | Proposta | Recomendação | Ganha | Perde / cuidado |
|---|---|---|---|---|
| 1 | **Saídas x Listas de passageiros x Conferência x Fechamento.** Hoje são 3 itens no menu (`/saidas`, `/listas`, `/conferencia`); o antigo Fechamento já redireciona para `/listas`. As três falam das mesmas saídas e reservas. | Manter **Listas de passageiros** como entrada do dia e fundir Saídas em uma aba "Todas as saídas" dentro dela; Conferência vira uma aba "A conferir" na mesma tela (filtrada por data). Menu Operação cai de 8 para 6 itens. | Um lugar só para "a lista de amanhã": conferir, fechar, enviar. Menos cliques; o atendente não precisa saber a diferença entre as três. | Muda o menu e os atalhos (`g s`, `g k`); a Saída individual continua como está. Exige decisão sobre quem usa Saídas para planejar semanas à frente. |
| 2 | **Vendas por canal (Marketing) x Visão Geral.** Os dois mostram reservas por canal. | Manter em Marketing só o que a Visão Geral não tem (participação por canal e por passeio/mês, origem) e trocar o gráfico de canal da Visão Geral por um link "ver vendas por canal". | Uma só fonte de números por canal; menos divergência entre telas. | A Visão Geral perde um gráfico; o dono precisa confirmar que as duas contam "reserva espelho" do mesmo jeito. |
| 3 | **Resumo financeiro x Visão Geral.** Faturamento do mês aparece nas duas. | Manter o faturamento só no Resumo financeiro (por competência) e deixar na Visão Geral apenas "vendas" (por data da compra), com rótulo claro de que não é o mesmo número. | Evita dois "faturamentos" diferentes na cabeça do dono. | Rótulos e uma nota explicativa; nenhuma tela some. |
| 4 | **Rastreamento x Rastreio do motorista.** Um é o mapa para a operação, o outro é a tela do motorista que transmite. | Manter as duas rotas (públicos diferentes), mas no menu mostrar "Rastreio do motorista" só para quem transmite e agrupar "Rastreamento" com "Transfer". Para a operação, renomear para "Ônibus no mapa". | Menu mais curto e rótulo que diz o que a tela faz. | Troca de nome; o motorista continua caindo direto na tela dele. |
| 5 | **Abas duplicadas no menu e nas telas.** Financeiro tem 6 itens no menu e 9 abas; Frota tem 2 itens no menu e 6 abas; Marketing tem 6 itens e nenhuma aba. | Regra única: o menu mostra a **área e o primeiro nível**, as abas fazem o resto. Financeiro e Frota: menu com 1 item cada (abre o módulo); Marketing passa a ter abas iguais. | Menu do topo enxuto; mesmo comportamento nos três módulos. | Quem usa atalhos do menu para "Contas a pagar" passa a ter um clique a mais (o atalho `g` continua). |
| 6 | **"Meu transfer" x "Rastreio do motorista" x "Checklist".** Três telas do motorista no menu. | Juntar numa única tela "Meu dia" do motorista com 3 blocos (transfer, rastreio, checklist) em cartões grandes. | Motorista abre uma tela só, com poucos toques. | Mais trabalho de desenvolvimento e teste em campo; fazer só depois de ouvir um motorista. |
| 7 | **Importar reservas (Reservas) x Integrações (Configurações).** Ambos tratam de onde vêm as reservas. | Manter separado, mas colocar um atalho "Integrações" dentro de Importar e vice-versa. | Descoberta sem mexer em permissões. | Nada. |
| 8 | **Passageiros e clientes / Empresas parceiras ("em breve").** Itens planejados aparecem para administradores no menu. | Esconder do menu até existirem e manter a lista de módulos planejados só na página "Em breve". | Menu sem itens que não abrem nada. | O dono deixa de ver o roteiro no menu. |

## 5. Não feito nesta rodada (e por quê)

- Nenhuma tela, rota ou item de menu foi removido ou renomeado.
- Telas com layout próprio e específico (mapa do Rastreamento, WhatsApp em duas colunas, gráficos da Visão Geral, Biblioteca) receberam só o padrão global; um redesenho interno delas dependeria de decisão do dono (itens 1, 2 e 6 acima).
- Páginas públicas (embarque e rastreio do cliente) não puderam ser conferidas com dados na demonstração (a API simulada não responde esses links); só o visual do erro e o tamanho de texto foram verificados.
- Não foi testado em aparelho real (Android/iOS) nem com leitor de tela; contraste e foco foram mantidos pelos tokens.

## 6. Decisões do dono (06/11/2026) e o que foi feito

Aprovadas as consolidações 1, 2 (menu enxuto por área, item 5 da tabela) e 3. Não aprovado: esconder os itens "em breve" (mantidos). Rastreamento, "Meu dia" do motorista e Importar x Integrações ficam como estão.

1. **Listas de passageiros com três abas.** `/listas` (Listas do dia), `/listas/saidas` (Todas as saídas, com período e filtros) e `/listas/conferir` (A conferir). `/saidas` e `/conferencia` redirecionam para a aba certa (mantendo parâmetros como `?acao=nova-reserva`); `/saidas/:id` segue sendo a tela da saída. Cada aba só aparece para quem tem a permissão dela (manifesto:ver; reservas:editar para A conferir). Atalhos `g m`, `g s` e `g k` levam às abas. O menu Operação não tem mais Saídas e Conferência.
2. **Um item por módulo no menu do topo:** Financeiro, Frota e Marketing viram link direto (como a Biblioteca), com as abas internas iguais (`AbasModulo`; Marketing ganhou `MarketingLayout`). Os endereços das abas e os atalhos continuam (`g q`, `g v`, `g o`, `g j`, `g t`, `g z`, `g h`, via `ATALHOS_ABAS`). Quem só faz o checklist da frota (sem frota:ver) continua vendo o item "Checklist do veículo".
3. **Faturamento num lugar só.** Visão Geral: "Vendas do mês · pela data da compra" e "Vendas por período", cada um com o link "Ver faturamento no Resumo financeiro" (só com financeiro:ver). O bloco por canal virou um resumo compacto ("Vendas por canal (resumo)") com link para Vendas por canal no Marketing (só com marketing:ver). O Resumo financeiro diz que é a fonte do faturamento, por competência.

**Reserva espelho: conferido.** Visão Geral (`canalGrafico` em `apps/api/src/rotas/visao-geral.ts`) e Vendas por canal (`coalesce(canalOrigem, canal)` em `marketing.ts`) usam o canal de origem quando a reserva é espelho de uma OTA (Viator, Decolar, Civitatis), então contam do mesmo jeito. A diferença que resta é de taxonomia nas reservas que não são de OTA: a Visão Geral separa pela forma de venda do pedido (site, admin, afiliado, balcão), e Vendas por canal pelo sistema de origem da reserva (ex.: Paytour). Não alterei nenhum dos dois; se o dono quiser os mesmos nomes nas duas telas, é decisão de negócio a tomar.
