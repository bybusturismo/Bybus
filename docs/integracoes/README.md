# Mapa de acessos e integrações (22/10/2026)

| Fonte | O que traz | Acesso hoje | Como o sistema usa agora | Próximo passo |
|---|---|---|---|---|
| **Paytour** | Vendas do site/loja, quiosque, afiliados; Civitatis integrada | ❌ API sem documentação pública; domínio bloqueado na rede do ambiente; sem credenciais | Importação do **CSV** exportado da Paytour | Pedir à Paytour: documentação da API, sandbox, webhooks e confirmar plano (Premium?) |
| **Viator / Tripadvisor** | Reservas do "Floripa City Tour by Bus – Whole Island" (produto 165696P2) | ✅ Chegam pela **Bókun** (`bybusturismo1.bokun.io`) com e-mail "New booking" no Gmail admbybus@ | Colar e-mails na tela de importação | Gerar **chave de API da Bókun** (Settings → Connections → API keys) e liberar `api.bokun.io` na rede → sincronização automática |
| **Civitatis** | Reservas Civitatis | ✅ Integrada à Paytour (entra no CSV) | Via CSV da Paytour | Confirmar se ainda usam documento 3333 manual |
| **Decolar** | Reservas Decolar | ❌ Nenhum e-mail de reserva no Gmail admbybus@ (provavelmente em outra caixa ou painel) | Lançamento manual na tela | Descobrir onde chegam as reservas (e-mail/painel) |
| **Gmail** (admbybus@) | Notificações Bókun, Viator, Paytour, Civitatis | ✅ Leitura via conector | Fonte dos e-mails Bókun | Automatizar leitura periódica após aprovação |
| **Google Drive** | Manuais, planilhas, frota | ✅ Leitura via conector | Base de conhecimento | Migrar planilhas de frota no módulo Frota |
| **Site bybusturismo.com.br** | Roteiro e pontos de embarque | ❌ Bloqueado na rede do ambiente | Pontos vieram do Manual do Atendente (mesma ordem do site) | Liberar domínio para conferir |

## Domínios a liberar no acesso de rede do ambiente
`bybusturismo.com.br`, `loja.bybusturismo.com.br`, `paytour.com.br`, `api.paytour.com.br` (se existir), `api.bokun.io`, `extranet.bokun.io`.
