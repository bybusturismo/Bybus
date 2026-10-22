# Jurídico e regulatório (mapa inicial)

> Pesquisa de 22/10/2026 a partir de trechos de buscadores. **Não substitui parecer do advogado/contador da empresa.** [NÃO CONFIRMADO] = validar.

## Licenciamento por modalidade
| Modalidade | Norma / órgão | O sistema deve controlar |
|---|---|---|
| Prestador turístico | Cadastur — Lei 11.771/2008 art. 21–22 (validade 2 anos); Lei 14.978/2024: plataformas digitais exigem Cadastur | Vencimento do Cadastur |
| Interestadual (saindo de SC) | ANTT — Res. 4.777/2015: TAF (3 anos), **licença por viagem**, relação de passageiros, NF, seguro RC | Manifesto exportável, licença por viagem, apólice |
| Intermunicipal em SC (ex.: Floripa↔BC, BC↔Blumenau, Beto Carrero) | **SIE/SC** — Decreto 1.342/2021 (alt. 1.576/2026), IN SIE 2/2025 | Registro SIE, licença de fretamento eventual com motorista/veículo/datas |
| Balneário Camboriú | Decreto 12.918/2025 — Sistema de Rotas, cadastro no **PIT** e **selo de turismo** | Selo/PIT por veículo |
| Florianópolis | Decreto 5.651/2008 — **Licença de Tráfego e Selo de Vistoria**; Lei 10.194/2017 e Decreto 26.787/2024 (selo SIVETUR) | Licença/selo por veículo |
| Trenzinho | **Res. CONTRAN 813/2020** — autorização e vistoria municipal, bancos com encosto e cinto, proteção lateral, laudo de segurança; inspeção periódica | Laudo, vistoria, checklist de engate/freios/cintos |

## Segurança do veículo e do motorista
- **Tacógrafo** obrigatório em veículos de passageiros com mais de 10 lugares (CTB art. 105, II; Res. CONTRAN 938/2022); aferição periódica [NÃO CONFIRMADO: 2 anos].
- **Seguros:** RC obrigatório na ANTT; tratar **RC + APP** como obrigatórios na prática. **Não escalar veículo sem apólice válida.**
- **Jornada (Lei 13.103/2015 / CTB art. 67-C):** 8h/dia, 44h/semana, até 2h extras (4h com acordo coletivo); 1h de refeição; **máx. 5h30 de direção ininterrupta**; **30 min de descanso a cada 4h** (passageiros); 11h de descanso por 24h. A escala do sistema deve validar isso. ADI 5322 afetou partes da lei [alcance NÃO CONFIRMADO].

## Consumidor
- **CDC art. 49:** 7 dias de arrependimento em compras online. Recomendação: reembolso integral se cancelado em até 7 dias da compra **e** antes do passeio; fora disso, política clara aceita no checkout.
- **Meia-entrada:** a Lei 12.933/2013 cobre espetáculos e esportes, não passeios. SC tem a Lei 16.995/2016 [conteúdo NÃO CONFIRMADO]. Tratar descontos e gratuidades como **política comercial configurável**, validada pelo advogado.

## LGPD
- Bases legais: execução de contrato (reserva/manifesto), obrigação legal (listas ANTT/SIE), exercício regular de direitos (guarda pós-serviço), **consentimento só para marketing**.
- Retenção sugerida: 5 anos (CDC art. 27 / fiscal) [validar].
- Minimizar dados (documento só quando exigido), acesso por perfil, contratos com operadores (Paytour, OTAs, gateways), nomear encarregado (DPO).
- ⚠️ Hoje há planilhas com nomes e telefones de clientes compartilhadas entre contas Gmail diferentes — migrar para o sistema com controle de acesso.

## Tributário
- NFS-e: **Emissor Nacional** em Florianópolis (desde 01/12/2025) e Balneário Camboriú (desde 01/01/2026).
- **Ponto crítico:** transporte **intermunicipal** de pessoas é fato gerador de **ICMS**, não ISS; city tour municipal → ISS (LC 116 item 9.02). Passeio entre cidades depende do contrato → **parecer contábil**.
- **Reforma Tributária (LC 214/2025, alterada pela LC 227/2026):** 2026 é ano-teste (CBS 0,9% + IBS 0,1% destacados). Transporte coletivo intermunicipal: redução de 40%; agências de turismo: regime específico (art. 288). O sistema precisa classificar cada serviço e destacar CBS/IBS.

## Riscos prioritários
1. Licenciamento de cada modalidade (risco de apreensão e de recusa pelas OTAs).
2. Jornada do motorista e tacógrafo aferido.
3. Seguros RC/APP vigentes por veículo.
4. Classificação tributária ISS × ICMS + CBS/IBS.
5. CDC (arrependimento) e política de cancelamento.
6. LGPD (planilhas de contatos espalhadas).
7. Cadastur ativo.
