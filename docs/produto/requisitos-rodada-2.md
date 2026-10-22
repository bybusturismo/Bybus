# Requisitos — rodada 2 (ditados pelo dono em 22/10/2026)

> Registrado como foi dito; itens marcados ❓ aguardam confirmação. Ver perguntas no fim.

## 1. Cadastro de passageiros / clientes (base de dados)
- Toda pessoa que viaja precisa ser **identificada** e ficar num **banco de cadastro** (não só na lista do dia).
- Classificar por **categoria** (adulto, sênior, infantil/criança, colo, cortesia) e por **origem**: **país, estado e cidade** — para análises de "de onde vêm nossos clientes".
- **Importar** esse cadastro das plataformas: principal a **Paytour** ❓(ditado como "Baidu"), depois **Decolar**, Viator/Tripadvisor (Bókun) e Civitatis.
- Implica: entidade **Cliente/Pessoa** separada da reserva (um cliente pode ter várias viagens), com deduplicação por documento/e-mail/telefone, consentimento LGPD para marketing separado, painel de origem (país/estado/cidade × período × passeio × canal).

## 2. Afiliados
- Pessoas/empresas que **revendem** os passeios pela Paytour ❓; cada uma gera um **QR Code próprio** no sistema; toda venda nesse QR gera **comissão automaticamente**.
- A Paytour já faz isso; precisamos **incorporar**: cadastro de afiliados, vendas por afiliado, comissão calculada, extrato/pagamento de comissões.
- Do Drive: hotéis afiliados com link comissionado; Inzama (fluxo próprio, PIX + cupom); afiliados internos de OTA (tripadvisorinternobybus@ etc.) — esses não são comissionados.

## 3. Gestão de frota
- Manutenção, documentação, **quilometragem** e demais informações (ver `docs/conhecimento/frota.md` e agente `frota-manutencao`).
- **Rastreador** instalado no ônibus da empresa ❓ (a frase foi interrompida — integrar posição/km do rastreador?).

## 4. Dois tipos de operação
| | **City Tour** (Florianópolis — Floripa by Bus) | **Fretamento** (Balneário Camboriú — Grupo Oceanic) |
|---|---|---|
| Venda | Ingresso individual (Paytour, OTAs, quiosque) | Contrato fixo B2B |
| Veículos | Ônibus de dois andares | **3 ônibus fixos** no contrato; no verão o Oceanic contrata **um 4º** |
| Equipe | **Motorista + guia de turismo** | **Equipe fixa de motoristas**, sem guia |
| Frequência | Só sai com mínimo de passageiros ❓(10 dito agora × 12 no Manual) | **Todos os dias** |
| Lista de passageiros | Sim, por ponto de embarque, com check-in pela guia | ❓ (há lista no fretamento?) |

## 5. Guias de turismo
- **Banco de guias** (cadastro, documentos, Cadastur do guia ❓, idiomas, diária).
- **Calendário/rodízio**: cada dia uma guia; como nem todo dia tem passeio, o sistema alterna as guias.
- No dia, a guia controla os passageiros pelo celular: **embarcou, não embarcou (no-show), atrasado**.

## 6. Escala de motoristas
- Especialmente no fretamento Oceanic (ônibus rodando todos os dias, equipe fixa) — escala integrada ao sistema, respeitando a jornada (Lei 13.103: 5h30 de direção contínua, 30 min a cada 4h, 11h de descanso).

## Impacto no que já existe
- Embarque ganha o status **ATRASADO** (além de PENDENTE, EMBARCOU, NO_SHOW).
- Saída ganha **tipo de operação** (CITY_TOUR × FRETAMENTO), **guia** e **motorista** passam a ser pessoas cadastradas (hoje são texto).
- Passageiro ganha **cliente** vinculado com **país/estado/cidade**.
