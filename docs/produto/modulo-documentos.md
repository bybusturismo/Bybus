# Documentos da empresa (11/11/2026)

Pedido do dono: área para contrato social, cartão CNPJ, contratos, certidões e documentos dos sócios, com acesso restrito ou não.
Decisão: área própria em **Gestão › Documentos da empresa** (não a Biblioteca, que é para manuais lidos por todos).

- **Pastas iniciais:** Societário (restrita), Contratos, Fiscal e licenças, Sócios (restrita). Restrita = só o administrador e os perfis/
  pessoas marcados pelo administrador em "Quem vê". Quem não vê a pasta recebe 404 (nem sabe que o documento existe).
- **Permissões:** `documentos:ver` (ver as pastas abertas) e `documentos:gerenciar` (enviar, editar, apagar, criar pastas abertas).
  Mudar o acesso de uma pasta: só o administrador. O ADMIN tem tudo; os outros perfis recebem as permissões em Perfis de acesso
  (decisão do dono a confirmar: quem mais deve ver).
- **Arquivos:** PDF, JPG, PNG, Word, Excel e PowerPoint (tipo conferido pelos bytes), até 15 MB, **cifrados no banco** (mesma chave da
  ficha dos usuários). Abrir/baixar fica na auditoria (`DOC_ABERTO`), assim como enviar, alterar, apagar e mudar acesso.
- **Validade:** campo opcional; o topo da área avisa 30 dias antes e quando vence.
- Código: `apps/api/src/rotas/documentos.ts`, `packages/core/src/documentos.ts`, `apps/web/src/paginas/DocumentosEmpresa.tsx`; migração 0041.
