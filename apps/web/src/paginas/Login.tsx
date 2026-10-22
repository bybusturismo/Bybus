import { useRef, useState, type FormEvent } from "react";
import { ErroApi, requisitar } from "../api/cliente";
import { Aviso } from "../componentes/Estados";
import logoVertical from "../marca/bybus-vertical.png";

interface Props {
  aviso?: string;
  aoEntrar: () => void | Promise<void>;
}

/** Traduz o erro de login em mensagem clara, sem revelar se o e-mail existe. */
export function mensagemLogin(e: unknown): string {
  if (!(e instanceof ErroApi)) return "Erro inesperado. Tente novamente.";
  switch (e.status) {
    case 423: // versões antigas da API; hoje conta bloqueada responde 401 genérico
      return "Muitas tentativas. Aguarde alguns minutos ou peça ao administrador para redefinir a senha.";
    case 429:
      return "Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.";
    case 400:
      return "Informe um e-mail válido e a senha.";
    case 0:
      return e.message;
  }
  if (e.codigo === "MFA_INVALIDO") return "Código de verificação inválido. Confira o aplicativo autenticador e o horário do celular.";
  if (e.codigo === "CREDENCIAIS_INVALIDAS") return "E-mail ou senha incorretos. Após várias tentativas, o acesso fica bloqueado por alguns minutos.";
  return e.message;
}

export function Login({ aviso, aoEntrar }: Props) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [pedirCodigo, setPedirCodigo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoCodigo = useRef<HTMLInputElement>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (pedirCodigo && !/^\d{6}$/.test(codigo.replace(/\s/g, ""))) {
      setErro("O código tem 6 dígitos.");
      campoCodigo.current?.focus();
      return;
    }
    setEnviando(true);
    try {
      await requisitar("/api/auth/login", {
        metodo: "POST",
        corpo: { email: email.trim(), senha, ...(pedirCodigo ? { codigo: codigo.replace(/\s/g, "") } : {}) },
        semAvisoSessao: true,
      });
      await aoEntrar();
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === "MFA_NECESSARIO") {
        setPedirCodigo(true);
        setTimeout(() => campoCodigo.current?.focus(), 0);
      } else {
        setErro(mensagemLogin(e));
        if (e instanceof ErroApi && e.codigo === "MFA_INVALIDO") {
          setCodigo("");
          campoCodigo.current?.focus();
        }
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-acesso">
      <main className="cartao-acesso" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={82} height={120} />
          <h1>Bybus Gestão</h1>
        </div>
        <p className="cartao-acesso__subtitulo">{pedirCodigo ? "Verificação em duas etapas" : "Entre com seu e-mail e senha"}</p>

        {aviso && !erro && <Aviso tipo="info">{aviso}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <form onSubmit={enviar} noValidate>
          {!pedirCodigo ? (
            <>
              <div className="campo">
                <label htmlFor="login-email">E-mail</label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="campo">
                <label htmlFor="login-senha">Senha</label>
                <input id="login-senha" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="campo">
              <label htmlFor="login-codigo">Código de 6 dígitos do aplicativo autenticador</label>
              <input
                id="login-codigo"
                ref={campoCodigo}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={7}
                className="campo--codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ""))}
                aria-describedby="login-codigo-ajuda"
              />
              <p id="login-codigo-ajuda" className="campo__ajuda">
                Abra o Google Authenticator, Microsoft Authenticator ou similar e digite o código de “Bybus Gestão”.
              </p>
            </div>
          )}
          <button type="submit" className="botao botao--primario botao--bloco" disabled={enviando || !email || !senha}>
            {enviando ? "Entrando…" : pedirCodigo ? "Verificar e entrar" : "Entrar"}
          </button>
          {pedirCodigo && (
            <button
              type="button"
              className="botao botao--fantasma botao--bloco"
              onClick={() => {
                setPedirCodigo(false);
                setCodigo("");
                setErro(null);
              }}
            >
              Voltar
            </button>
          )}
        </form>
        <p className="cartao-acesso__rodape">Esqueceu a senha? Peça ao administrador para redefini-la.</p>
      </main>
    </div>
  );
}
