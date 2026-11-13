import { useEffect, useState, type FormEvent } from "react";
import { PAPEIS_SIGNATARIO, ROTULO_PAPEL_SIGNATARIO, type PapelSignatario } from "@bybus/core";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";

interface Signatario { id: string; papel: PapelSignatario; nome: string; email: string; visualizadoEm: string | null; assinadoEm: string | null }
interface DocAssinatura { id: string; titulo: string; status: "PENDENTE" | "CONCLUIDO" | "CANCELADO"; codigoVerificacao: string; criadoEm: string; concluidoEm: string | null; signatarios: Signatario[] }
interface Linha { papel: PapelSignatario; nome: string; email: string; cpf: string }

/**
 * Assinatura eletrônica do contrato do grupo (13/11/2026): escolhe quem assina, envia (e-mail com link individual) e
 * acompanha quem já viu e assinou. Links aparecem uma vez para copiar e mandar pelo WhatsApp, se preciso.
 */
export function AssinaturaGrupo({ grupoId, representante, empresa }: {
  grupoId: string;
  representante: { nome: string | null; email: string | null; cpf: string | null };
  empresa: { nome: string | null };
}) {
  const notificar = useNotificar();
  const docs = useCarregar((s) => api.get<DocAssinatura[]>(`/api/grupos/${grupoId}/assinaturas`, s), [grupoId]);
  const [enviando, setEnviando] = useState(false);
  const [form, setForm] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([
    { papel: "CONTRATANTE", nome: representante.nome ?? "", email: representante.email ?? "", cpf: representante.cpf ?? "" },
    { papel: "CONTRATADA", nome: empresa.nome ?? "", email: "", cpf: "" },
  ]);
  const [links, setLinks] = useState<Array<{ nome: string; link: string; emailEnviado?: boolean }>>([]);
  const [erro, setErro] = useState<string | null>(null);
  // Quem assina pela By Bus: dos "Dados do contrato".
  const empresaCfg = useCarregar((s) => api.get<{ assinanteNome: string | null }>("/api/configuracoes/contrato", s).catch(() => ({ assinanteNome: null })), []);
  useEffect(() => {
    const n = empresaCfg.dados?.assinanteNome;
    if (n) setLinhas((ls) => ls.map((l) => (l.papel === "CONTRATADA" && !l.nome ? { ...l, nome: n } : l)));
  }, [empresaCfg.dados]);
  const pendente = (docs.dados ?? []).find((d) => d.status === "PENDENTE");
  const alterar = (i: number, k: keyof Linha, v: string) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await api.post<{ links: Array<{ nome: string; link: string; emailEnviado: boolean }> }>(`/api/grupos/${grupoId}/assinatura`, { signatarios: linhas.map((l) => ({ ...l, cpf: l.cpf || null })) });
      setLinks(r.links);
      setForm(false);
      notificar("Contrato enviado para assinatura.");
      await docs.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }
  async function novoLink(d: DocAssinatura, s: Signatario) {
    try {
      const r = await api.post<{ link: string; emailEnviado: boolean }>(`/api/assinaturas/${d.id}/signatarios/${s.id}/link`, {});
      setLinks([{ nome: s.nome, link: r.link, emailEnviado: r.emailEnviado }]);
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function cancelar(d: DocAssinatura) {
    try {
      await api.post(`/api/assinaturas/${d.id}/cancelar`, {});
      notificar("Envio cancelado: os links deixaram de valer.");
      await docs.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  const copiar = (t: string) => void navigator.clipboard.writeText(t).then(() => notificar("Link copiado."), () => setErro("Selecione o link e copie à mão."));

  return (
    <section className="cartao nao-imprimir" aria-labelledby="g-tit-assinatura">
      <h2 id="g-tit-assinatura">Assinatura eletrônica do contrato</h2>
      <p className="texto-fraco">Cada pessoa recebe um link por e-mail, lê o contrato, confirma um código enviado ao e-mail, nome e CPF, e assina. No fim, o contrato assinado (com a folha de assinaturas e o código de verificação) entra nos anexos do grupo.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {links.length > 0 && (
        <Aviso tipo="sucesso">
          Links de assinatura (aparecem só agora; copie se quiser mandar também pelo WhatsApp):
          <ul className="lista-simples">
            {links.map((l) => (
              <li key={l.link}><strong>{l.nome}</strong>{l.emailEnviado === false ? " (e-mail não enviado: mande o link)" : ""}: <code className="frota-link">{l.link}</code> <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => copiar(l.link)}>Copiar</button></li>
            ))}
          </ul>
        </Aviso>
      )}
      {docs.carregando && !docs.dados ? <Carregando /> : (
        <>
          {(docs.dados ?? []).map((d) => (
            <div key={d.id} className="assinatura-doc">
              <p>
                <strong>{d.status === "CONCLUIDO" ? "Assinado por todos" : d.status === "CANCELADO" ? "Cancelado" : "Aguardando assinaturas"}</strong>
                {" · "}enviado em {formatarDataHora(d.criadoEm)}{d.concluidoEm ? ` · concluído em ${formatarDataHora(d.concluidoEm)}` : ""} · código {d.codigoVerificacao}{" "}
                <a className="botao botao--pequeno botao--secundario" href={`/api/assinaturas/${d.id}/pdf`} target="_blank" rel="noopener noreferrer"><Icone nome="imprimir" tamanho={14} /> {d.status === "CONCLUIDO" ? "Contrato assinado" : "Ver contrato"}</a>
                {d.status === "PENDENTE" && <> <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void cancelar(d)}>Cancelar envio</button></>}
              </p>
              <ul className="lista-simples">
                {d.signatarios.map((s) => (
                  <li key={s.id}>
                    {ROTULO_PAPEL_SIGNATARIO[s.papel]}: <strong>{s.nome}</strong> ({s.email}) —{" "}
                    {s.assinadoEm ? <span className="etiqueta etiqueta--sucesso">assinou em {formatarDataHora(s.assinadoEm)}</span> : s.visualizadoEm ? <span className="etiqueta etiqueta--atencao">abriu, ainda não assinou</span> : <span className="etiqueta etiqueta--neutra">ainda não abriu</span>}
                    {d.status === "PENDENTE" && !s.assinadoEm && <> <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void novoLink(d, s)}>Reenviar / novo link</button></>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!pendente && !form && <button type="button" className="botao botao--primario" onClick={() => setForm(true)}>Enviar contrato para assinatura</button>}
          {form && (
            <form onSubmit={(e) => void enviar(e)}>
              {linhas.map((l, i) => (
                <fieldset key={i} className="assinatura-signatario">
                  <legend>{ROTULO_PAPEL_SIGNATARIO[l.papel]}</legend>
                  <div className="grade-campos">
                    <div className="campo"><label htmlFor={`as-papel-${i}`}>Papel</label><select id={`as-papel-${i}`} value={l.papel} onChange={(e) => alterar(i, "papel", e.target.value)}>{PAPEIS_SIGNATARIO.map((p) => <option key={p} value={p}>{ROTULO_PAPEL_SIGNATARIO[p]}</option>)}</select></div>
                    <div className="campo"><label htmlFor={`as-nome-${i}`}>Nome completo</label><input id={`as-nome-${i}`} value={l.nome} maxLength={160} onChange={(e) => alterar(i, "nome", e.target.value)} /></div>
                    <div className="campo"><label htmlFor={`as-email-${i}`}>E-mail</label><input id={`as-email-${i}`} type="email" value={l.email} maxLength={160} onChange={(e) => alterar(i, "email", e.target.value)} /></div>
                    <div className="campo"><label htmlFor={`as-cpf-${i}`}>CPF (opcional: se informado, tem que bater)</label><input id={`as-cpf-${i}`} inputMode="numeric" value={l.cpf} maxLength={20} onChange={(e) => alterar(i, "cpf", e.target.value)} /></div>
                  </div>
                  {i > 1 && <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>Remover</button>}
                </fieldset>
              ))}
              <div className="modal__acoes">
                {linhas.length < 6 && <button type="button" className="botao botao--secundario" onClick={() => setLinhas([...linhas, { papel: "TESTEMUNHA", nome: "", email: "", cpf: "" }])}>+ Testemunha</button>}
                <button type="button" className="botao botao--secundario" onClick={() => setForm(false)}>Cancelar</button>
                <button type="submit" className="botao botao--primario" disabled={enviando}>{enviando ? "Enviando…" : "Enviar para assinatura"}</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
