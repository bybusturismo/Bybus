import { useState, type FormEvent } from "react";
import { ErroApi, requisitar } from "../api/cliente";
import { Aviso } from "../componentes/Estados";
import logoVertical from "../marca/bybus-vertical.png";

/** Página pública do link "Esqueci minha senha" (vale 1 hora, uma vez só). */
export function RedefinirSenha({ codigo }: { codigo: string }) {
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha !== repetir) return setErro("As duas senhas não são iguais.");
    setEnviando(true);
    try {
      await requisitar("/api/auth/redefinir", { metodo: "POST", corpo: { codigo, senha }, semAvisoSessao: true });
      setFeito(true);
    } catch (x) {
      setErro(x instanceof ErroApi ? x.message : "Não foi possível salvar a senha agora.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={82} height={120} />
          <h1>Criar senha nova</h1>
        </div>
        {feito ? (
          <>
            <Aviso tipo="sucesso">Senha criada. Agora é só entrar com o seu e-mail e a senha nova.</Aviso>
            <a className="botao botao--primario botao--bloco" href="/">Ir para o login</a>
          </>
        ) : (
          <form onSubmit={salvar} noValidate>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="campo"><label htmlFor="rs-senha">Senha nova</label><input id="rs-senha" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} aria-describedby="rs-ajuda" /></div>
            <p id="rs-ajuda" className="campo__ajuda">Pelo menos 10 caracteres, com letras e números.</p>
            <div className="campo"><label htmlFor="rs-repetir">Repita a senha nova</label><input id="rs-repetir" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} /></div>
            <button type="submit" className="botao botao--primario botao--bloco" disabled={enviando || !senha || !repetir}>{enviando ? "Salvando…" : "Salvar senha nova"}</button>
          </form>
        )}
      </main>
    </div>
  );
}
