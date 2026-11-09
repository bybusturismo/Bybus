import { describe, expect, it } from "vitest";
import { gerarSenhaForte, lerColado, montarImportacaoCofre, separarAcesso } from "../src/index.js";

describe("cofre: importar a planilha de senhas colada", () => {
  it("lê colunas, célula de várias linhas entre aspas e categoria mesclada", () => {
    const colado = 'Bancos\tBanco Fictício\t"Agência 0001\nUsuário: empresa.ficticia\nSenha: Segredo-123"\n\tCartão Fictício\tLogin: cartao@exemplo.test senha: Outra-456\nFiscal\tPortal Fictício\thttps://portal.exemplo.test\nSenha - abc123';
    const itens = montarImportacaoCofre(lerColado(colado), { cabecalho: false });
    expect(itens).toHaveLength(3);
    expect(itens[0]).toMatchObject({ categoria: "Bancos", titulo: "Banco Fictício", usuario: "empresa.ficticia", senha: "Segredo-123" });
    expect(itens[1]).toMatchObject({ categoria: "Bancos", titulo: "Cartão Fictício", usuario: "cartao@exemplo.test", senha: "Outra-456" });
    // "Senha - abc123" veio numa linha solta (Excel sem aspas): junta no item de cima.
    expect(itens[2]).toMatchObject({ categoria: "Fiscal", url: "https://portal.exemplo.test", senha: "abc123" });
  });
  it("variações de rótulo e gerador de senha", () => {
    expect(separarAcesso("Senha do app: x9")).toMatchObject({ senha: "x9" });
    expect(separarAcesso("senha y8")).toMatchObject({ senha: "y8" });
    const s = gerarSenhaForte(24);
    expect(s).toHaveLength(24);
    expect(s).not.toMatch(/[O0Il1]/);
  });
});
