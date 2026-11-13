import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import { ROTULO_TIPO_AFILIADO } from "./comum";

interface Afiliado {
  id: string; unidadeId: string | null; nome: string; tipo: string; codigo: string; comissaoPontosBase: number | null; contato: string | null;
  paytourAfiliadoId: string | null; observacoes: string | null; ativo: boolean; link: string;
  /** Portal do afiliado (13/11/2026). */
  temAcesso?: boolean; temDadosBancarios?: boolean;
}

/** Cria (ou remove) o acesso do afiliado ao portal: e-mail próprio, link para criar a senha. */
function AcessoPortal({ afiliado, aoMudar }: { afiliado: Afiliado; aoMudar: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<{ link: string; emailEnviado: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      setLink(await api.post<{ link: string; emailEnviado: boolean }>(`/api/marketing/afiliados/${afiliado.id}/acesso`, { email }));
      await aoMudar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function remover() {
    try {
      await api.delete(`/api/marketing/afiliados/${afiliado.id}/acesso`);
      await aoMudar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  return (
    <div>
      <p className="texto-fraco">No portal, o afiliado vê só as próprias comissões, cadastra os dados bancários e pega o link e o QR code.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {link ? (
        <Aviso tipo="sucesso">
          Acesso criado. {link.emailEnviado ? "Enviamos ao afiliado o link para criar a senha." : "O e-mail não saiu: mande este link ao afiliado."} O link vale 72 horas:<br />
          <code className="frota-link">{link.link}</code>
        </Aviso>
      ) : afiliado.temAcesso ? (
        <p>Este afiliado já tem acesso ao portal. <button type="button" className="botao botao--pequeno botao--perigo-contorno" onClick={() => void remover()}>Remover acesso</button></p>
      ) : (
        <form className="filtros" onSubmit={(e) => void criar(e)}>
          <div className="campo campo--linha"><label htmlFor="ap-email">E-mail do afiliado</label><input id="ap-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button type="submit" className="botao botao--primario">Criar acesso</button>
        </form>
      )}
    </div>
  );
}
interface Resposta { urlLoja: string; ligacaoPaytour: { situacao: string; nota: string }; afiliados: Afiliado[] }

export function codigoSugerido(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}
const comissaoTexto = (pb: number | null) => (pb == null ? "a confirmar" : `${(pb / 100).toLocaleString("pt-BR")}%`);

function FormAfiliado({ afiliado, aoSalvar, aoCancelar }: { afiliado: Afiliado | null; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const { unidades, praca, usuario } = useSessao();
  const todas = !!usuario?.todasUnidades;
  const [nome, setNome] = useState(afiliado?.nome ?? "");
  const [tipo, setTipo] = useState(afiliado?.tipo ?? "HOTEL");
  const [codigo, setCodigo] = useState(afiliado?.codigo ?? "");
  const [codigoEditado, setCodigoEditado] = useState(!!afiliado);
  const [unidadeId, setUnidadeId] = useState(afiliado ? (afiliado.unidadeId ?? "") : (praca || (todas ? "" : (unidades[0]?.id ?? ""))));
  const [comissao, setComissao] = useState(afiliado?.comissaoPontosBase == null ? "" : String(afiliado.comissaoPontosBase / 100).replace(".", ","));
  const [contato, setContato] = useState(afiliado?.contato ?? "");
  const [paytourId, setPaytourId] = useState(afiliado?.paytourAfiliadoId ?? "");
  const [obs, setObs] = useState(afiliado?.observacoes ?? "");
  const [ativo, setAtivo] = useState(afiliado?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2) return setErro("Informe o nome.");
    const cod = codigo.trim().toUpperCase().replace(/\s+/g, "-");
    if (!/^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/.test(cod)) return setErro("Código com 3 a 24 caracteres: letras, números e hífen.");
    let pb: number | null = null;
    if (comissao.trim()) {
      const n = Number(comissao.replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 100) return setErro("Comissão: percentual de 0 a 100.");
      pb = Math.round(n * 100);
    }
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), tipo, codigo: cod, unidadeId: unidadeId || null, comissaoPontosBase: pb, contato: contato.trim() || null, paytourAfiliadoId: paytourId.trim() || null, observacoes: obs.trim() || null, ativo };
      if (afiliado) await api.patch(`/api/marketing/afiliados/${afiliado.id}`, corpo);
      else await api.post("/api/marketing/afiliados", corpo);
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="af-nome">Nome</label>
          <input id="af-nome" value={nome} maxLength={120} onChange={(e) => { setNome(e.target.value); if (!codigoEditado) setCodigo(codigoSugerido(e.target.value)); }} /></div>
        <div className="campo"><label htmlFor="af-tipo">Tipo</label><select id="af-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>{Object.entries(ROTULO_TIPO_AFILIADO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="af-codigo">Código</label><input id="af-codigo" value={codigo} maxLength={24} onChange={(e) => { setCodigo(e.target.value); setCodigoEditado(true); }} /></div>
        <div className="campo"><label htmlFor="af-praca">Praça</label><select id="af-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>{todas && <option value="">Todas as praças</option>}{unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="af-comissao">Comissão (%)</label><input id="af-comissao" inputMode="decimal" value={comissao} onChange={(e) => setComissao(e.target.value)} aria-describedby="af-comissao-ajuda" /><p id="af-comissao-ajuda" className="campo__ajuda">Regra de comissão a confirmar com o dono.</p></div>
        <div className="campo"><label htmlFor="af-paytour">Id do afiliado na Paytour</label><input id="af-paytour" value={paytourId} maxLength={60} onChange={(e) => setPaytourId(e.target.value)} aria-describedby="af-paytour-ajuda" /><p id="af-paytour-ajuda" className="campo__ajuda">Opcional. A ligação com a Paytour está pendente.</p></div>
        <div className="campo campo--largo"><label htmlFor="af-contato">Contato (empresa ou setor)</label><input id="af-contato" value={contato} maxLength={200} onChange={(e) => setContato(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="af-obs">Observações</label><textarea id="af-obs" rows={2} value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Afiliado ativo</label>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : afiliado ? "Salvar" : "Cadastrar afiliado"}</button>
      </div>
    </form>
  );
}

function Qr({ afiliado }: { afiliado: Afiliado }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    QRCode.toDataURL(afiliado.link, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then((u) => vivo && setSrc(u)).catch(() => vivo && setSrc(null));
    return () => { vivo = false; };
  }, [afiliado.link]);
  return (
    <div>
      {src ? <img className="qr-codigo" src={src} alt={`QR code do afiliado ${afiliado.nome}, código ${afiliado.codigo}`} /> : <Carregando texto="Gerando QR code…" />}
      <p className="texto-fraco" style={{ overflowWrap: "anywhere" }}>{afiliado.link}</p>
      {src && <a className="botao botao--secundario" href={src} download={`qr-${afiliado.codigo}.png`}><Icone nome="baixar" /> Baixar PNG</a>}
      <Aviso tipo="atencao">Confirmar com a Paytour se o endereço com “?ref=” atribui a venda ao afiliado antes de imprimir em larga escala.</Aviso>
    </div>
  );
}

export function Afiliados() {
  const { unidades, pode } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const r = useCarregar((s) => api.get<Resposta>("/api/marketing/afiliados", s), []);
  const [form, setForm] = useState<{ afiliado: Afiliado | null } | null>(null);
  const [qr, setQr] = useState<Afiliado | null>(null);
  const [portal, setPortal] = useState<Afiliado | null>(null);
  const [excluir, setExcluir] = useState<Afiliado | null>(null);
  const d = r.dados;

  async function confirmarExclusao() {
    if (!excluir) return;
    try {
      await api.delete(`/api/marketing/afiliados/${excluir.id}`);
      notificar("Afiliado excluído.");
      setExcluir(null);
      await r.recarregar();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    }
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Afiliados</h1>
          <p className="pagina__descricao">Hotéis, pousadas e parceiros que divulgam os passeios, com código e QR code.</p>
        </div>
        {podeGerenciar && <button type="button" className="botao botao--primario" onClick={() => setForm({ afiliado: null })}><Icone nome="mais" /> Novo afiliado</button>}
      </div>
      {d && <Aviso tipo="atencao" titulo="Ligação com a Paytour pendente">{d.ligacaoPaytour.nota}</Aviso>}
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && d.afiliados.length === 0 ? (
        <Vazio titulo="Nenhum afiliado cadastrado.">{podeGerenciar ? "Cadastre o primeiro hotel ou parceiro para gerar o QR code." : undefined}</Vazio>
      ) : d ? (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Afiliado</th><th>Código</th><th>Praça</th><th className="num">Comissão</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>
              {d.afiliados.map((a) => (
                <tr key={a.id} className={a.ativo ? "" : "linha--inativa"}>
                  <td><strong>{a.nome}</strong><div className="texto-fraco">{ROTULO_TIPO_AFILIADO[a.tipo] ?? a.tipo}{!a.ativo ? " · inativo" : ""}{a.paytourAfiliadoId ? ` · Paytour ${a.paytourAfiliadoId}` : ""}</div></td>
                  <td><code>{a.codigo}</code></td>
                  <td>{nomePraca(unidades, a.unidadeId)}</td>
                  <td className="num">{comissaoTexto(a.comissaoPontosBase)}</td>
                  <td className="sem-quebra">
                    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setQr(a)}>QR code</button>
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setPortal(a)}>Portal{a.temAcesso ? " ✓" : ""}</button>}
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ afiliado: a })}>Editar</button>}
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(a)}>Excluir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Modal aberto={!!form} titulo={form?.afiliado ? "Editar afiliado" : "Novo afiliado"} aoFechar={() => setForm(null)} largura="larga">
        {form && <FormAfiliado afiliado={form.afiliado} aoCancelar={() => setForm(null)} aoSalvar={async () => { setForm(null); notificar("Afiliado salvo."); await r.recarregar(); }} />}
      </Modal>
      <Modal aberto={!!portal} titulo={portal ? `Portal do afiliado — ${portal.nome}` : "Portal"} aoFechar={() => setPortal(null)}>{portal && <AcessoPortal afiliado={portal} aoMudar={async () => { await r.recarregar(); }} />}</Modal>
      <Modal aberto={!!qr} titulo={qr ? `QR code — ${qr.nome}` : "QR code"} aoFechar={() => setQr(null)}>{qr && <Qr afiliado={qr} />}</Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir afiliado" perigo textoConfirmar="Excluir" aoFechar={() => setExcluir(null)} aoConfirmar={() => void confirmarExclusao()} mensagem={<>Excluir <strong>{excluir?.nome}</strong> ({excluir?.codigo})? QR codes já impressos deixam de ser reconhecidos pelo cadastro.</>} />
    </div>
  );
}
