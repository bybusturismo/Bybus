import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErroApi, mensagemDeErro, requisitar } from "../../api/cliente";
import logo from "../../marca/bybus-vertical.png";

interface Formulario { token: string; passeios: string[]; tipos: string[] }
const TIPOS: Record<string, string> = { ESCOLA: "Escola", EMPRESA: "Empresa", EXCURSAO: "Excursão", EVENTO: "Evento", OUTRO: "Outro" };
const param = (n: string) => { try { return new URLSearchParams(window.location.search).get(n) ?? undefined; } catch { return undefined; } };

/** Página pública /orcamento: pedido de orçamento para grupos (escolas, empresas, excursões, eventos). */
export function OrcamentoPublico({ incorporado = false }: { incorporado?: boolean }) {
  const [form, setForm] = useState<Formulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [campoErro, setCampoErro] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const [v, setV] = useState({ nome: "", organizacao: "", tipoGrupo: "ESCOLA", telefone: "", email: "", dataPretendida: "", pessoas: "", servico: "", cidadeOrigem: "", mensagem: "", consentimento: false, site: "" });
  const campo = useRef<HTMLFormElement>(null);
  const set = (k: keyof typeof v, valor: string | boolean) => setV((x) => ({ ...x, [k]: valor }));

  async function abrir() {
    try { setForm(await requisitar<Formulario>("/api/publico/orcamento/formulario", { semAvisoSessao: true })); setErro(null); } catch (e) { setErro(mensagemDeErro(e)); }
  }
  useEffect(() => { void abrir(); }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCampoErro({});
    if (!form) return;
    const pessoas = Number(v.pessoas);
    const falta: Record<string, string> = {};
    if (v.nome.trim().length < 2) falta.nome = "Informe o seu nome.";
    if (v.organizacao.trim().length < 2) falta.organizacao = "Informe a escola, empresa ou grupo.";
    if (!Number.isInteger(pessoas) || pessoas < 1) falta.pessoas = "Informe quantas pessoas.";
    if (v.servico.trim().length < 2) falta.servico = "Informe o passeio ou serviço.";
    if (v.telefone.replace(/\D/g, "").length < 8 && !v.email.trim()) falta.telefone = "Informe um telefone (com DDD) ou um e-mail.";
    if (!v.consentimento) falta.consentimento = "É preciso concordar para receber o orçamento.";
    if (Object.keys(falta).length) return setCampoErro(falta);
    setEnviando(true);
    try {
      const r = await requisitar<{ protocolo: string }>("/api/publico/orcamento", {
        metodo: "POST", semAvisoSessao: true,
        corpo: {
          nome: v.nome.trim(), organizacao: v.organizacao.trim(), tipoGrupo: v.tipoGrupo, telefone: v.telefone.trim() || undefined, email: v.email.trim() || undefined,
          dataPretendida: v.dataPretendida || null, pessoas, servico: v.servico.trim(), cidadeOrigem: v.cidadeOrigem.trim() || undefined, mensagem: v.mensagem.trim() || undefined,
          consentimento: true, site: v.site, formToken: form.token, utmSource: param("utm_source"), utmMedium: param("utm_medium"), utmCampaign: param("utm_campaign"),
        },
      });
      setProtocolo(r.protocolo);
    } catch (x) {
      if (x instanceof ErroApi && x.codigo === "FORMULARIO_EXPIRADO") await abrir(); // novo token; a pessoa só reenvia
      if (x instanceof ErroApi && x.detalhes.length) setCampoErro(Object.fromEntries(x.detalhes.map((d) => [d.campo, d.mensagem])));
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }

  const Erro = ({ c }: { c: string }) => (campoErro[c] ? <p className="campo__erro" role="alert">{campoErro[c]}</p> : null);
  return (
    <div className={incorporado ? "" : "tela-acesso"}>
      <main className="cartao-acesso cartao-acesso--largo pub-form" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logo} alt="By Bus Turismo" width={66} height={96} />
          <h1>Orçamento para grupos</h1>
        </div>
        {protocolo ? (
          <div className="aviso aviso--sucesso" role="status">
            <strong>Pedido recebido!</strong> Seu protocolo é <strong>{protocolo}</strong>. Nossa equipe responde em até 1 dia útil, pelo contato que você informou.
          </div>
        ) : (
          <form ref={campo} onSubmit={(e) => void enviar(e)} noValidate>
            <p className="cartao-acesso__subtitulo">Escolas, empresas, excursões e eventos: conte o que você precisa e enviamos uma proposta.</p>
            {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
            <div className="grade-campos">
              <div className="campo"><label htmlFor="o-nome">Seu nome *</label><input id="o-nome" value={v.nome} maxLength={120} autoComplete="name" onChange={(e) => set("nome", e.target.value)} /><Erro c="nome" /></div>
              <div className="campo"><label htmlFor="o-org">Escola, empresa ou grupo *</label><input id="o-org" value={v.organizacao} maxLength={160} autoComplete="organization" onChange={(e) => set("organizacao", e.target.value)} /><Erro c="organizacao" /></div>
              <div className="campo"><label htmlFor="o-tipo">Tipo de grupo</label><select id="o-tipo" value={v.tipoGrupo} onChange={(e) => set("tipoGrupo", e.target.value)}>{Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
              <div className="campo"><label htmlFor="o-tel">Telefone com DDD (WhatsApp)</label><input id="o-tel" type="tel" inputMode="tel" value={v.telefone} maxLength={30} autoComplete="tel" onChange={(e) => set("telefone", e.target.value)} /><Erro c="telefone" /></div>
              <div className="campo"><label htmlFor="o-email">E-mail</label><input id="o-email" type="email" value={v.email} maxLength={160} autoComplete="email" onChange={(e) => set("email", e.target.value)} /><Erro c="email" /></div>
              <div className="campo"><label htmlFor="o-data">Data pretendida</label><input id="o-data" type="date" value={v.dataPretendida} onChange={(e) => set("dataPretendida", e.target.value)} /></div>
              <div className="campo"><label htmlFor="o-pessoas">Número de pessoas *</label><input id="o-pessoas" inputMode="numeric" value={v.pessoas} maxLength={5} onChange={(e) => set("pessoas", e.target.value)} /><Erro c="pessoas" /></div>
              <div className="campo"><label htmlFor="o-servico">Passeio ou serviço *</label>
                <input id="o-servico" list="o-passeios" value={v.servico} maxLength={200} onChange={(e) => set("servico", e.target.value)} placeholder="Ex.: City Tour, fretamento…" />
                <datalist id="o-passeios">{form?.passeios.map((p) => <option key={p} value={p} />)}</datalist><Erro c="servico" /></div>
              <div className="campo"><label htmlFor="o-cidade">Cidade de origem</label><input id="o-cidade" value={v.cidadeOrigem} maxLength={100} onChange={(e) => set("cidadeOrigem", e.target.value)} /></div>
              <div className="campo campo--largo"><label htmlFor="o-msg">Mensagem</label><textarea id="o-msg" rows={4} value={v.mensagem} maxLength={1500} onChange={(e) => set("mensagem", e.target.value)} /></div>
            </div>
            {/* Campo isca: invisível para pessoas; robôs costumam preenchê-lo. */}
            <div className="pub-isca" aria-hidden="true"><label>Não preencha este campo<input tabIndex={-1} autoComplete="off" value={v.site} onChange={(e) => set("site", e.target.value)} /></label></div>
            <label className="interruptor"><input type="checkbox" checked={v.consentimento} onChange={(e) => set("consentimento", e.target.checked)} /> Concordo que a By Bus Turismo use estes dados apenas para responder ao meu pedido de orçamento. Posso pedir a exclusão a qualquer momento.</label>
            <Erro c="consentimento" />
            <button type="submit" className="botao botao--primario botao--bloco" disabled={enviando || !form}>{enviando ? "Enviando…" : "Pedir orçamento"}</button>
          </form>
        )}
      </main>
    </div>
  );
}
