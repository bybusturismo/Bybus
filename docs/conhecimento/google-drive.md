# Mapa do Google Drive (conta admbybus@gmail.com)

> Levantamento somente leitura em 22/10/2026. **Sem dados pessoais** — listas de passageiros/clientes/funcionários descritas só pela estrutura.

## Estrutura principal
- **BY BUS** (desde 2017): `1-BC BY BUS`, `2-FLORIPA BY BUS`, `3-Comercial` (propostas, publicidade, contratos), `4-Financeiro` (vendas externas, abastecimento, impostos, PagSeguro, Pagar.me/Decolar, Manual do Financeiro), `5-Comunicação e Marketing`, `7-Documentação`, `Manuais e Treinamentos`, `Contratos` (2016–2020), `Passeios Temáticos`, `Ofícios`, `ÔNIBUS` (uma subpasta por placa), `Colaboradores` (dados pessoais sensíveis).
- Pastas vazias criadas em 07/2024: DOCUMENTOS, FICHA DE MANUTENÇÃO, ABASTECIMENTO.
- Muitos arquivos soltos na raiz e duplicados ("sem título", dois Manuais do Financeiro/Atendente).
- **Compartilhadas de outras contas:** supervisorbybus@ (tutoriais, "CRM - KOMMO"), caubybus@ (boletos, fluxo de caixa 2025), contatofbyb@ (abastecimentos, passeios de parceiros 2026, lista de reservas), financeirobyb@ (frota), consultoria Farol da Liderança (documentos da empresa, colaboradores, financeiro, entrevistas), agências Toma e Ribcom, parceiros (Grupo Oceanic, Havan, Destino Floripa).

## Documentos-chave para o sistema
| Documento | Uso no sistema |
|---|---|
| Novo Manual do Atendente (2025/26) | Regras de operação do quiosque, mínimo para confirmar saída, embarques, uso da Paytour, objeções, afiliados |
| Regimento Interno / Cartilha do Motorista / Cartilha do Guia | Checklists e regras de conduta no app |
| Funções do Supervisor / Atividades do Supervisor | Tarefas diárias → rotinas e alertas no sistema |
| chekin list / Abastecimentos | Modelo de dados de manutenção, checklist e combustível |
| Passeios de Parceiros 2026 / Passeios Parceiros e Comissões | Revenda e comissões |
| Programação de grupos / Passeios escolares | Módulo de grupos/fretamento |
| Fluxo de Caixa 2025 / Nrs ByBUS / Controle Diário | Plano de contas e caixa |
| Transporte Grupo Oceanic / Nova Operação / Propostas | Contratos B2B, modelo de custo por ônibus |
| Lista hotéis e pousadas | Prospecção de afiliados |

Os documentos podem ser localizados no Drive pelo título. Links não foram versionados aqui porque o repositório não deve apontar para pastas com dados pessoais.

## Regras operacionais extraídas
- **Confirmação de saída:** mínimo de 10–12 pessoas; com 8–9, a supervisão decide.
- **Transfer/embarque Floripa:** 12 pontos de embarque entre 6h50 e 10h.
- **Lista de passageiros:** gerada na Paytour, impressa e levada ao ônibus.
- **OTAs (Tripadvisor/Viator, Decolar):** lançadas **manualmente** na Paytour com documento fictício (1111/2222/3333) e "afiliado interno"; Civitatis entra integrada. À noite: pedir avaliações e **bloquear o dia seguinte nas OTAs**.
- **Quiosque Villa Romana (L2):** seg–sáb 10h–22h, dom 14h–20h; pagamento em dinheiro no quiosque.
- **Passeio Oceanic:** proibido comer a bordo, pets até 25 kg, cinto obrigatório.

## Problemas de dados e riscos encontrados
1. **Dados pessoais expostos:** documentos de funcionários em pastas de consultoria externa; listas de reservas com CPF em planilha compartilhada; **senha de equipamento escrita no manual do atendente**; recebimento de parceiros em chave PIX de pessoa física.
2. **Fragmentação:** ≥ 7 contas Google, sem cadastro mestre de frota, motoristas, guias, clientes ou parceiros.
3. **Vencimentos de documentos** da frota só no nome dos arquivos.
4. **Manutenção sem plano preventivo**; checklist irregular.
5. **Financeiro:** categorias digitadas à mão com erros, despesas pessoais misturadas às da empresa, caixa em dinheiro controlado em três lugares, sem DRE nem resultado por linha de negócio, sem conciliação de recebíveis das OTAs.
6. **Reservas:** lançamento manual das OTAs → risco de overbooking e de erro na lista de embarque.
7. **Regulatório:** classificação "transporte recreativo" no CRLV de um ônibus; veículo sem acessibilidade; concessões contestadas no passado (BC 2016, Blumenau 2025).
8. **Qualidade:** telefones aparentemente fictícios em lista de hotéis; datas e telefones inválidos em planilhas de contatos.
9. **Não encontrado:** trenzinho, ANTT, alvarás organizados, escala de guias, tabela de preços oficial consolidada, indicadores (ocupação, ticket médio, custo/km).
