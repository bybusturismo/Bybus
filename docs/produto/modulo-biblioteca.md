# Módulo Biblioteca (atualizado em 05/11/2026)

Manuais e procedimentos da operação em páginas com subpáginas. Em 05/11/2026 o dono pediu "aos moldes da TOMA": a Biblioteca ganhou editor visual, árvore com arrastar, lixeira, anexos, gravar tela, PDF e acesso por pessoa, adaptados do APP TOMA (`docs/outros-modulos.md`, seções "Biblioteca" e "Biblioteca: editor visual e nome editável") sem copiar o estilo nem a estrutura.

## Permissões e acesso
| Permissão | O que libera |
|---|---|
| `biblioteca:ver` | Ler as páginas liberadas e buscar nelas. Exigida por todas as rotas. |
| `biblioteca:editar` | "Editor geral": vê e edita tudo, cria páginas na raiz, restringe páginas, define o acesso por pessoa, usa a lixeira. |

**Regra de acesso a cada página** (`calcularAcesso`, `packages/core/src/biblioteca/acesso.ts`; toda rota que recebe um id a confere, e página sem acesso responde 404):
- Editor geral: vê e edita tudo.
- **Lista de pessoas** (Ver / Editar): vale para a página e para as subpáginas; a lista mais próxima (da própria página para cima) é a que vale. Quem está na lista lê (e, com *Editar*, edita), mesmo se a página for restrita.
- Quem não está na lista: lê se nenhuma página do caminho for **restrita**; nunca edita.
- Quem tem *Editar* numa página: edita o texto, título e ícone, cria e move subpáginas dentro dela, duplica, exclui e anexa arquivos. **Não** muda o acesso (restringir e lista de pessoas) nem cria/exclui/move páginas na raiz.
- A busca, o PDF e o download de anexos usam a mesma regra.

## O que veio da TOMA
1. **Árvore** com arrastar (`@dnd-kit/core` 6.3.1): soltar no terço de cima ou de baixo muda a ordem (linha laranja); soltar no meio vira subpágina (destaque azul); no celular, segurar um instante. O servidor (`PATCH { paiId, antesDe }`) recusa ciclo (`CICLO`), exige que a irmã de referência esteja no destino (`IRMA_INVALIDA`) e **renumera as irmãs 1, 2, 3…**, inclusive as que a pessoa não vê. Sem `antesDe`, vai para o fim. **Largura da coluna ajustável** (arrastar a barra ou setas do teclado), guardada no navegador. Para quem não usa mouse há "Mover para…" no menu.
2. **Cabeçalho** com ícone (emoji), **título editável no lugar** (clicar; Enter salva, Esc desiste), autor, "Atualizado por último" (data e pessoa) e tabela de **subpáginas com proprietário e colaboradores** (quem já editou: tabela `biblioteca_colaboradores`).
3. **Menu ⋯** da árvore: nova subpágina, duplicar (com subpáginas, anexos, lista de pessoas; as imagens do texto passam a apontar para as cópias dos anexos), mover para…, copiar link, renomear, ícone, restringir/liberar, acesso por pessoa, baixar PDF e excluir. Os itens só aparecem para quem pode usá-los.
4. **Excluir** manda a página **e as subpáginas para a lixeira** (`excluida_em`), com aviso "Desfazer" na própria tela por 12 s. A **Lixeira** (editor geral) lista, restaura ou apaga de vez. Se a página de cima foi excluída em outra ocasião, a restaurada volta para a raiz. Não há esvaziamento automático (a confirmar: prazo de 30 dias).
5. **Editor visual** sem pacote de editor (`contentEditable` + `execCommand` do navegador): desfazer/refazer; parágrafo, títulos 1–3 e citação; negrito, itálico, sublinhado, tachado e cor; listas; alinhamento; link; imagem; tabela com +/− linha e coluna e apagar tabela; linha horizontal; **quebra de página**; limpar formatação; atalhos Ctrl/⌘ + S, B, I, U.
6. **HTML limpo**: o texto novo é guardado em HTML (começa por `<!--html-->`), limpo pelo **DOMPurify 3.2.4 no servidor (sobre jsdom 25.0.1) e no navegador**, com as mesmas listas (`packages/core/src/biblioteca/html.ts`): tags e atributos em lista branca; `style` só com cor, fundo, alinhamento, tamanho e destaque do texto (nunca `url()`); classes só `quebra-pagina`; `img` e `video` só apontam para anexos da própria Biblioteca (`/api/biblioteca/anexos/<id>`); links só `http(s)`, `mailto`, `tel` ou caminho interno, sempre com `target="_blank" rel="noopener noreferrer"`. Testado: `<script>`, `onerror`, `onclick`, `javascript:`, `style` com `url()`, `<iframe>`, `<svg>`, `<style>` e imagem externa saem. **Páginas antigas em Markdown continuam abrindo** (analisador próprio `markdown.ts`, sem `innerHTML`) e viram HTML na primeira vez que forem salvas pelo editor; a API também aceita `formato: "markdown"`.
7. **Anexos** (imagens no texto, vídeos e arquivos da página): enviados no corpo da requisição (`POST /api/biblioteca/paginas/:id/anexos?nome=`, com o tipo do arquivo no `Content-Type`; **sem pacote de upload**). Aceitos: PNG, JPEG, GIF, WebP (até 8 MB); WebM e MP4 (até 100 MB); PDF, TXT, CSV, DOCX, XLSX (até 25 MB); até 100 anexos por página. O servidor **confere o conteúdo** (assinatura do arquivo) e recusa se não bater com o tipo declarado; SVG, HTML e executáveis nunca passam; o tamanho é checado antes de ler o corpo; o nome é limpo (sem caminho). Quem baixa precisa poder ler a página; a resposta leva `nosniff` e `Content-Security-Policy: sandbox`, imagens e vídeos abrem na página e os demais baixam (`Content-Disposition`), com suporte a `Range` para o vídeo.
8. **Gravar a tela** (`getDisplayMedia` + microfone opcional + `MediaRecorder`): o `.webm` vira anexo da página e entra no texto como bloco de vídeo (`<video controls>`). Na demonstração avisa que não grava.
9. **PDF da página** (`GET /api/biblioteca/paginas/:id/pdf`): título, texto (negrito, itálico, sublinhado, tachado, links), títulos, listas, tabelas, imagens PNG/JPEG da página, linha horizontal e **quebras de página**. Vídeo e imagens de outros formatos viram um aviso. Emoji do ícone não entra (fontes padrão do PDF).

## Decisões
- **Anexos no banco (`bytea`), não em pasta.** Não exige volume extra no Docker, entra no backup do banco e herda o controle de acesso da página sem caminho previsível em disco. Custo: o banco cresce; com vídeos grandes (limite de 100 MB cada) vale acompanhar o tamanho. **Se o volume de vídeos crescer**, a evolução é mover os vídeos para armazenamento de objetos ou para um volume (`/var/lib/bybus/biblioteca`), mantendo a mesma rota. **Pacote de implantação:** nada a configurar; `bodyLimit` da rota de envio é de 100 MB (o proxy à frente da API, no pacote de implantação, precisa aceitar corpo de até 100 MB nessa rota — a conferir no Caddy antes de publicar).
- **PDF no servidor (pdfkit), não no navegador.** Gera o mesmo arquivo em qualquer aparelho (inclusive celular), confere o acesso à página no servidor e respeita as quebras de página sem depender da impressão do navegador. Custo: um pacote novo e fonte padrão (sem emoji; cor, tamanho e alinhamento da tela não aparecem no PDF).
- **Sem `marked`/`dompurify` no Markdown antigo:** a leitura do Markdown continua pelo analisador próprio.
- **Busca** usa a coluna `texto_busca` (texto puro, sem marcas de HTML), preenchida ao salvar; páginas sem ela caem no conteúdo.
- A auditoria registra criar, editar, mover, excluir, restaurar, duplicar, anexar, excluir anexo, gerar PDF e mudar acesso por pessoa — nunca o texto da página.

## O que ficou de fora (e por quê)
| Item da TOMA | Situação |
|---|---|
| Extensão do Chrome (gravador de passos estilo Scribe) | **Próxima etapa possível.** Pedido do dono para não trazer agora; exige extensão instalada em cada computador e chaves pessoais. |
| Compartilhamento público por link (`/p/doc/:token`) | **Próxima etapa possível.** Abre página sem login: exige revisão de segurança própria (token imprevisível, o que expõe, limite por IP) e decisão do dono. |
| Botão "Gravar" no topo do sistema (gravação global) | **Próxima etapa possível.** Só a gravação dentro da página foi trazida. |
| Tamanho da letra e PDF com cor/alinhamento | Fora: o PDF mantém o essencial; tamanho da letra não está no editor (títulos 1–3 cobrem). |
| Guias passo a passo (`doc_guia_passos`) | Dependem do gravador de passos. |
| Histórico de versões da página | Fora (a auditoria registra quem editou e quando; o texto antigo não é guardado). A considerar. |

## Banco (`apps/api/src/db/esquemas/biblioteca.ts`) — esquema para a migração única
- `biblioteca_paginas` (já existia): **novas colunas** `icone text`, `texto_busca text`, `excluida_em timestamptz`.
- `biblioteca_acessos`: `id`, `pagina_id` → páginas (cascade), `usuario_id` → usuários (cascade), `nivel` (`VER`/`EDITAR`); único (`pagina_id`, `usuario_id`).
- `biblioteca_colaboradores`: `pagina_id`, `usuario_id`, `ultima_edicao_em`; chave primária composta.
- `biblioteca_anexos`: `id`, `pagina_id` (cascade), `nome`, `tipo`, `uso` (`IMAGEM`/`VIDEO`/`ARQUIVO`), `tamanho`, `dados bytea`, `criado_por`, `criado_em`; índice por `pagina_id`.
- A migração gerada para os testes foi `ALTER TABLE ... ADD COLUMN` (3) e `CREATE TABLE` (3) com chaves e índices; **não foi commitada**.

## Rotas (`apps/api/src/rotas/biblioteca.ts`)
`GET /api/biblioteca/paginas` · `GET|PATCH|DELETE /api/biblioteca/paginas/:id` · `POST /api/biblioteca/paginas` · `POST …/:id/duplicar` · `GET …/:id/pdf` · `GET|PUT …/:id/pessoas` · `POST …/:id/anexos` · `GET|DELETE /api/biblioteca/anexos/:id` · `GET /api/biblioteca/busca` · `GET /api/biblioteca/usuarios` · `GET /api/biblioteca/lixeira` · `POST /api/biblioteca/lixeira/:id/restaurar` · `DELETE /api/biblioteca/lixeira/:id`.

## Pacotes novos (versão fixa; todos com mais de 2 semanas)
| Pacote | Versão | Lançamento | Onde |
|---|---|---|---|
| dompurify | 3.2.4 | 30/01/2025 | api e web |
| jsdom | 25.0.1 | 22/09/2024 | api (já era dev do web) |
| pdfkit | 0.20.2 | 30/08/2026 | api |
| @dnd-kit/core | 6.3.1 | 05/12/2024 | web |
| @types/jsdom (dev) | 21.1.7 | 30/05/2024 | api |
| @types/pdfkit (dev) | 0.17.6 | 16/04/2026 | api (a 0.17.7 tem só 13 dias) |

As dependências indiretas foram conferidas; `@swc/helpers` (dependência indireta) tinha uma versão de 04/11/2026, então a raiz do repositório passou a fixá-la em 0.5.23 (`pnpm.overrides`).

## Semente (manuais operacionais)
`apps/api/src/db/biblioteca-seed.ts`, idempotente (uma chave por página; nunca sobrescreve edições). Conteúdo só do que está em `docs/conhecimento` e no plano da Fase 2, com "a confirmar" onde não está validado: City Tour Toda Ilha (com os pontos oficiais gerados de `PONTOS_TODA_ILHA`), BC By Bus, regras de embarque e confirmação, fluxo da lista das 21h, reservas de Viator/Decolar/Civitatis e quiosque do Villa Romana. As páginas semeadas continuam em Markdown até alguém editá-las.

## Pendências e "a confirmar"
1. Lista oficial das 6 paradas do City Tour e coordenadas dos pontos; pontos, horários e capacidade de Balneário Camboriú; política de chuva, cancelamento e idade.
2. **Perfis padrão:** conceder `biblioteca:ver` a guias, motoristas e atendentes e `biblioteca:editar` à supervisão (decisão do dono).
3. Prazo de esvaziamento automático da lixeira.
4. Acompanhar o tamanho do banco (anexos) e decidir se vídeos grandes passam para armazenamento próprio.
5. Próximas etapas possíveis: extensão de gravação de passos, compartilhamento público por link, botão "Gravar" no topo, histórico de versões.
