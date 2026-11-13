import { useEffect, useState, type FormEvent } from "react";
import { ROTULO_PAPEL_SIGNATARIO, type PapelSignatario } from "@bybus/core";
import { mensagemDeErro, requisitar } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import logoVertical from "../../marca/bybus-vertical.png";

interface Info {
  documento: { titulo: string; status: "PENDENTE" | "CONCLUIDO" | "CANCELADO"; hash: string; codigoVerificacao: string; criadoEm: string };
  signatario: { nome: string; papel: PapelSignatario; email: string; assinadoEm: string | null };
  signatarios: Array<{ papel: PapelSignatario; nome: string; assinado: boolean }>;
}

/** Página de quem assina (link individual, sem login): lê o contrato, recebe o código por e-mail e assina (13/11/2026). */
export function AssinarPublico({ token }: { token: string }) {
  const base = `/api/publico/assinar/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [codigoEnviado, setCodigoEnviado] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [aceite, setAceite] = useState(false);
  const [leu, setLeu] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<{ concluido: boolean } | null>(null);
  const carregar = () => requisitar<Info>(base, { semAvisoSessao: true }).then(setInfo, (e) => setErro(mensagemDeErro(e)));
  useEffect(() => { void carregar(); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pedirCodigo() {
    setErro(null);
    setOcupado(true);
    try {
      const r = await requisitar<{ enviadoPara: string; validoMinutos: number }>(`${base}/codigo`, { metodo: "POST", corpo: {}, semAvisoSessao: true });
      setCodigoEnviado(`Enviamos um código de 6 números para ${r.enviadoPara}. Ele vale ${r.validoMinutos} minutos (confira também o spam).`);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }
  async function assinar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!aceite) return setErro("Marque que leu e concorda com o documento.");
    setOcupado(true);
    try {
      const r = await requisitar<{ concluido: boolean }>(`${base}/assinar`, { metodo: "POST", corpo: { codigo: codigo.trim(), nome, cpf, aceite: true }, semAvisoSessao: true });
      setFeito(r);
      await carregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }
  const d = info?.documento;
  const s = info?.signatario;
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>Assinatura eletrônica</h1>
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {!info && !erro && <p className="texto-fraco">Carregando…</p>}
        {d && s && info && (
          <>
            <p className="cartao-acesso__subtitulo"><strong>{d.titulo}</strong></p>
            <p>Assinante: <strong>{s.nome}</strong> ({ROTULO_PAPEL_SIGNATARIO[s.papel]})</p>
            <ul className="lista-simples">
              {info.signatarios.map((x, i) => <li key={i}>{ROTULO_PAPEL_SIGNATARIO[x.papel]}: {x.nome} — {x.assinado ? "✓ assinou" : "aguardando"}</li>)}
            </ul>
            <p>
              <a className="botao botao--secundario" href={`${base}/pdf`} target="_blank" rel="noopener noreferrer" onClick={() => setLeu(true)}>
                {d.status === "CONCLUIDO" ? "Baixar o documento assinado (PDF)" : "Ler o documento (PDF)"}
              </a>
            </p>
            {d.status === "CONCLUIDO" ? (
              <Aviso tipo="sucesso">Documento assinado por todas as partes. Código de verificação: <strong>{d.codigoVerificacao}</strong> (confira em <a href={`/verificar/${d.codigoVerificacao}`}>/verificar/{d.codigoVerificacao}</a>).</Aviso>
            ) : s.assinadoEm || feito ? (
              <Aviso tipo="sucesso">Sua assinatura foi registrada. Quando todos assinarem, você recebe o documento final por e-mail.</Aviso>
            ) : (
              <form onSubmit={(e) => void assinar(e)}>
                {!leu && <p className="texto-fraco">Abra e leia o documento antes de assinar.</p>}
                {!codigoEnviado ? (
                  <button type="button" className="botao botao--primario" disabled={ocupado} onClick={() => void pedirCodigo()}>Receber código de confirmação por e-mail</button>
                ) : (
                  <>
                    <Aviso tipo="info">{codigoEnviado} <button type="button" className="botao botao--pequeno botao--fantasma" disabled={ocupado} onClick={() => void pedirCodigo()}>Enviar de novo</button></Aviso>
                    <div className="grade-campos">
                      <div className="campo"><label htmlFor="as-codigo">Código recebido</label><input id="as-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} /></div>
                      <div className="campo"><label htmlFor="as-nome">Seu nome completo</label><input id="as-nome" value={nome} maxLength={160} onChange={(e) => setNome(e.target.value)} /></div>
                      <div className="campo"><label htmlFor="as-cpf">Seu CPF</label><input id="as-cpf" inputMode="numeric" value={cpf} maxLength={14} onChange={(e) => setCpf(e.target.value)} /></div>
                    </div>
                    <label className="interruptor">
                      <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
                      Li e concordo com o documento e assino eletronicamente. Sei que ficam registrados data, hora, IP e navegador.
                    </label>
                    <button type="submit" className="botao botao--primario botao--grande" disabled={ocupado}>{ocupado ? "Assinando…" : "Assinar"}</button>
                  </>
                )}
              </form>
            )}
            <p className="texto-fraco">Integridade: hash SHA-256 do documento {d.hash.slice(0, 16)}…</p>
          </>
        )}
      </main>
    </div>
  );
}

interface Verificacao { titulo: string; status: string; enviadoEm: string; concluidoEm: string | null; hashOriginal: string; hashFinal: string | null; signatarios: Array<{ papel: PapelSignatario; nome: string; assinadoEm: string | null }> }

/** Página pública de verificação: confere se um documento assinado pela By Bus é autêntico (código BB-XXXX-XXXX). */
export function VerificarPublico({ codigo }: { codigo: string }) {
  const [v, setV] = useState<Verificacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { requisitar<Verificacao>(`/api/publico/verificar/${encodeURIComponent(codigo)}`, { semAvisoSessao: true }).then(setV, (e) => setErro(mensagemDeErro(e))); }, [codigo]);
  const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>Verificação de documento</h1>
        </div>
        <p className="cartao-acesso__subtitulo">Código <strong>{codigo}</strong></p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {v && (
          <>
            <Aviso tipo={v.status === "CONCLUIDO" ? "sucesso" : "atencao"}>{v.status === "CONCLUIDO" ? "Documento autêntico, assinado por todas as partes." : v.status === "CANCELADO" ? "Este envio foi cancelado." : "Documento aguardando assinaturas."}</Aviso>
            <p><strong>{v.titulo}</strong> · enviado em {quando(v.enviadoEm)}{v.concluidoEm ? ` · concluído em ${quando(v.concluidoEm)}` : ""}</p>
            <ul className="lista-simples">{v.signatarios.map((s, i) => <li key={i}>{ROTULO_PAPEL_SIGNATARIO[s.papel]}: {s.nome} — {s.assinadoEm ? `assinou em ${quando(s.assinadoEm)}` : "não assinou"}</li>)}</ul>
            <p className="texto-fraco">Hash SHA-256 do original: <code className="frota-link">{v.hashOriginal}</code></p>
            {v.hashFinal && <p className="texto-fraco">Hash SHA-256 do documento assinado: <code className="frota-link">{v.hashFinal}</code></p>}
          </>
        )}
      </main>
    </div>
  );
}
