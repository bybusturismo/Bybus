# ADR 0011 — Diagnóstico só de leitura para o assistente acompanhar a produção

- Data: 19/11/2026
- Situação: aceita (dono)

## Contexto
O assistente (Claude Code na nuvem) não conseguia confirmar se uma publicação entrou no ar nem ver erros: o dono tinha de entrar no
servidor pelo PowerShell e mandar fotos do log. O SSH a partir da sessão na nuvem é bloqueado pela rede da sessão, e dar acesso
de administrador ao servidor (banco com dados reais, chaves) é um risco grande. O acesso por uma pasta do computador do dono
(Remote Control) não estava liberado para a conta.

## Decisão
Endereço `GET /api/diagnostico`, só de leitura, que só existe com `DIAGNOSTICO_TOKEN` no `.env` (gerado por
`implantacao/ligar-diagnostico.sh`) e exige `Authorization: Bearer <senha>`; senha errada responde 404, como se a rota não
existisse. Devolve: versão no ar (commit passado na construção da imagem pelo atualizador), últimas linhas do atualizador (pasta
`implantacao/estado`, montada só para leitura), banco (latência, migrações aplicadas × esperadas, tamanho), integrações só como
ligada/desligada (nunca chaves), rotinas (avaliações online, fila de mensagens, abastecimentos pendentes), requisições por hora e
os últimos 50 erros do servidor e das rotinas, **mascarados** (e-mails, números longos, textos entre aspas, valores do banco e
chaves). Nenhum dado de cliente. A senha fica nas configurações da sessão do assistente (formulário seguro), nunca no chat.

## Consequências
- O assistente confere sozinho cada publicação e vê erros; mexer no servidor continua com o dono (comandos passados por ele).
- Desligar: `bash /opt/bybus/implantacao/ligar-diagnostico.sh desligar` (o endereço deixa de existir); trocar a senha: rodar de novo.
- A lista de erros fica só na memória da API (some ao reiniciar).
