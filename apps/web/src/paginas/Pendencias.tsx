import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { Aviso, Carregando } from "../componentes/Estados";
import logoVertical from "../marca/bybus-vertical.png";

/** Política de senha (espelha o servidor): mínimo 10 caracteres, com letras e números. */
export function problemaSenha(senha: string): string | null {
  if (senha.length < 10) return "A senha deve ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "A senha deve ter letras e números.";
  if (senha.length > 200) return "Senha muito longa.";
  return null;
}

export function FormTrocarSenha({ aoConcluir, obrigatoria }: { aoConcluir: () => void | Promise<void>; obrigatoria?: boolean }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  const regraTamanho = nova.length >= 10;
  const regraMista = /[A-Za-z]/.test(nova) && /\d/.test(nova);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const p = problemaSenha(nova);
    if (p) return setErro(p);
    if (nova !== confirmacao) return setErro("A confirmação não confere com a nova senha.");
    if (nova === atual) return setErro("A nova senha deve ser diferente da atual.");
    setEnviando(true);
    try {
      await api.post("/api/auth/senha", { senhaAtual: atual, novaSenha: nova });
      setOk(true);
      setAtual("");
      setNova("");
      setConfirmacao("");
      await aoConcluir();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate>
      {obrigatoria && <Aviso tipo="atencao">Por segurança, troque a senha temporária antes de continuar.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ok && !obrigatoria && <Aviso tipo="sucesso">Senha alterada. As outras sessões abertas foram encerradas.</Aviso>}
      <div className="campo">
        <label htmlFor="senha-atual">Senha atual{obrigatoria ? " (temporária)" : ""}</label>
        <input id="senha-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required />
      </div>
      <div className="campo">
        <label htmlFor="senha-nova">Nova senha</label>
        <input id="senha-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} aria-describedby="senha-regras" required />
        <ul id="senha-regras" className="regras-senha">
          <li className={regraTamanho ? "ok" : ""}>
            <span aria-hidden="true">{regraTamanho ? "✓" : "•"}</span> Pelo menos 10 caracteres
          </li>
          <li className={regraMista ? "ok" : ""}>
            <span aria-hidden="true">{regraMista ? "✓" : "•"}</span> Letras e números
          </li>
        </ul>
      </div>
      <div className="campo">
        <label htmlFor="senha-confirmacao">Confirme a nova senha</label>
        <input id="senha-confirmacao" type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} required />
      </div>
      <button type="submit" className="botao botao--primario" disabled={enviando || !atual || !nova}>
        {enviando ? "Salvando…" : "Trocar senha"}
      </button>
    </form>
  );
}

export function ConfigurarMfa({ aoConcluir }: { aoConcluir: () => void | Promise<void> }) {
  const [dados, setDados] = useState<{ segredo: string; otpauth: string; qr: string } | null>(null);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function iniciar() {
    setErroInicio(null);
    try {
      const r = await api.post<{ segredo: string; otpauth: string }>("/api/auth/mfa/iniciar");
      const qr = await QRCode.toDataURL(r.otpauth, { margin: 1, width: 220, errorCorrectionLevel: "M" });
      setDados({ ...r, qr });
    } catch (e) {
      setErroInicio(mensagemDeErro(e));
    }
  }

  useEffect(() => {
    void iniciar();
  }, []);

  async function ativar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const c = codigo.replace(/\s/g, "");
    if (!/^\d{6}$/.test(c)) return setErro("O código tem 6 dígitos.");
    setEnviando(true);
    try {
      await api.post("/api/auth/mfa/ativar", { codigo: c });
      await aoConcluir();
    } catch (e) {
      setErro(mensagemDeErro(e));
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  if (erroInicio)
    return (
      <Aviso tipo="erro" titulo="Não foi possível iniciar a configuração">
        <p>{erroInicio}</p>
        <button type="button" className="botao botao--secundario" onClick={() => void iniciar()}>
          Tentar de novo
        </button>
      </Aviso>
    );
  if (!dados) return <Carregando texto="Gerando código QR…" />;

  const segredoAgrupado = dados.segredo.replace(/(.{4})/g, "$1 ").trim();
  return (
    <div className="mfa">
      <ol className="mfa__passos">
        <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, Authy…).</li>
        <li>No aplicativo, escolha “adicionar conta” e leia o código QR abaixo.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>
      <div className="mfa__qr">
        <img src={dados.qr} width={220} height={220} alt="Código QR para configurar o aplicativo autenticador" />
        <div>
          <p className="campo__ajuda">Não consegue ler o QR? Digite esta chave no aplicativo:</p>
          <code className="mfa__segredo" aria-label={`Chave: ${dados.segredo.split("").join(" ")}`}>
            {segredoAgrupado}
          </code>
        </div>
      </div>
      <form onSubmit={ativar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo">
          <label htmlFor="mfa-codigo">Código de 6 dígitos</label>
          <input
            id="mfa-codigo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            className="campo--codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ""))}
          />
        </div>
        <button type="submit" className="botao botao--primario" disabled={enviando}>
          {enviando ? "Verificando…" : "Ativar verificação em duas etapas"}
        </button>
      </form>
    </div>
  );
}

/** Tela cheia exibida enquanto houver pendência obrigatória após o login. */
export function TelaPendencia({ tipo, aoConcluir, aoSair }: { tipo: "TROCAR_SENHA" | "CONFIGURAR_MFA"; aoConcluir: () => Promise<void>; aoSair: () => void }) {
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={82} height={120} />
          <h1>{tipo === "TROCAR_SENHA" ? "Troque sua senha" : "Configure a verificação em duas etapas"}</h1>
        </div>
        {tipo === "TROCAR_SENHA" ? (
          <FormTrocarSenha obrigatoria aoConcluir={aoConcluir} />
        ) : (
          <>
            <p className="cartao-acesso__subtitulo">Seu perfil exige um código do celular além da senha para entrar.</p>
            <ConfigurarMfa aoConcluir={aoConcluir} />
          </>
        )}
        <button type="button" className="botao botao--fantasma botao--bloco" onClick={aoSair}>
          Sair
        </button>
      </main>
    </div>
  );
}
