# Visão do produto: Bybus Gestão

**Objetivo:** um sistema único (computador + aplicativo) que substitui planilhas, cadernos e lançamentos manuais e é a fonte oficial de produtos, saídas, reservas, frota, pessoas e financeiro da By Bus Turismo, com login, perfis de acesso e auditoria.

## Módulos (proposta — priorização a validar com o dono)
| # | Módulo | Resolve | Fase sugerida |
|---|---|---|---|
| 1 | **Acesso & Segurança** — login, senha, MFA, perfis, unidades, auditoria | Base de tudo; dados hoje espalhados em 7+ contas | MVP |
| 2 | **Cadastros mestres** — veículos, motoristas, guias, colaboradores, parceiros, clientes B2B, pontos de embarque | Não existe cadastro mestre | MVP |
| 3 | **Frota & Manutenção** — documentos com vencimento e alerta, plano preventivo km/tempo, ordens de serviço, abastecimento (km/l), pneus, checklist diário no app, bloqueio de veículo irregular | Vencimentos no nome do arquivo; sem preventiva; checklist irregular | MVP |
| 4 | **Catálogo & Saídas** — passeios, variações, tarifas por categoria e canal, calendário de saídas com veículo/motorista/guia/capacidade, mínimo para confirmar saída | Preços divergentes; sem fonte única | MVP |
| 5 | **Reservas & Embarque** — importação Paytour, lançamento único das OTAs com controle de capacidade, manifesto/lista de passageiros no app, check-in por QR, no-show | Lançamento manual com documento fictício, risco de overbooking, lista impressa | MVP / Fase 2 |
| 6 | **Escalas & Jornada** — escala de motoristas e guias, validação da Lei 13.103 (5h30 direção, 30 min/4h, 11h descanso), diárias de guia | Escalas em planilha; risco trabalhista | Fase 2 |
| 7 | **Comercial B2B** — grupos/escolas, fretamento/eventos, contratos (Oceanic, cruzeiros), publicidade nos ônibus, propostas e orçamentos | Propostas em documentos soltos | Fase 2 |
| 8 | **Revenda & Parceiros** — passeios de terceiros, comissões, afiliados (hotéis) | Planilhas mensais | Fase 2 |
| 9 | **Financeiro** — caixa diário do quiosque, contas a pagar/receber, conciliação por canal, centros de custo (unidade × veículo × linha), DRE, NFS-e | Caixa em 3 lugares; sem DRE; PF/PJ misturados | Fase 2 |
| 10 | **CRM & Pós-venda** — histórico de clientes, remarketing com consentimento, pedidos de avaliação | Planilhas de contatos manuais; Kommo parado | Fase 3 |
| 11 | **Painéis (BI)** — ocupação por saída, receita por assento, mix de canais, custo/km, disponibilidade da frota, margem por linha | Nenhum indicador hoje | Fase 2–3 |
| 12 | **Conformidade** — Cadastur, licenças SIE/ANTT/municipais, selos, seguros, tacógrafo, laudos do trenzinho | Sem controle centralizado | MVP (dentro de Frota) |

## Atualização 22/10/2026 (rodada 2)
Novos/ampliados: **Clientes & Origem** (cadastro com país/estado/cidade), **Afiliados & Comissões** (QR Code), **Guias** (banco + rodízio), **Escala de motoristas** (fretamento Oceanic), **dois tipos de operação** (City Tour × Fretamento). Detalhes em `requisitos-rodada-2.md`.

## Perfis de acesso iniciais
Diretoria · Administrador do sistema · Supervisor de operação · Atendente/vendedor (quiosque) · Comercial · Financeiro · Motorista supervisor/manutenção · Motorista · Guia · Parceiro/afiliado (portal restrito, fase futura) · Contador (somente leitura/exportação).

## Ambientes
- **Desenvolvimento** (local) → **Testes/Homologação** (dados fictícios; o dono valida aqui) → **Produção**.
- Nenhum dado real de cliente fora da produção.
