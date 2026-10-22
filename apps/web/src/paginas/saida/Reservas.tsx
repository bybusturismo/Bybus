import { useMemo, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { CANAIS, type Canal, type PassageiroReserva, type PontoEmbarque, type Reserva } from "../../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { ROTULO_CANAL, ROTULO_CATEGORIA, ROTULO_DOCUMENTO, ROTULO_EMBARQUE, ROTULO_STATUS_RESERVA } from "../../util/rotulos";
import { useCarregar } from "../../util/useCarregar";
import { CamposPassageiro, corpoPassageiro, errosPassageiro, novoPassageiro, type PassageiroRascunho } from "./CamposPassageiro";
import { useSaida } from "./SaidaLayout";

function ordenarPontos(pontos: PontoEmbarque[]): PontoEmbarque[] {
  return pontos.filter((p) => p.ativo !== false).sort((a, b) => a.horario.localeCompare(b.horario) || a.ordem - b.ordem);
}

function SelectPonto({ id, valor, aoMudar, pontos, rotuloVazio = "A definir" }: { id: string; valor: string; aoMudar: (v: string) => void; pontos: PontoEmbarque[]; rotuloVazio?: string }) {
  return (
    <select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)}>
      <option value="">{rotuloVazio}</option>
      {pontos.map((p) => (
        <option key={p.id} value={p.id}>
          {p.horario} — {p.nome}
        </option>
      ))}
    </select>
  );
}

const emailValido = (v: string) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// ---------------------------------------------------------------- Nova reserva
export function FormNovaReserva({ saidaId, pontos, aoSalvar, aoCancelar }: { saidaId: string; pontos: PontoEmbarque[]; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const notificar = useNotificar();
  const [canal, setCanal] = useState<Canal>("BALCAO");
  const [codigo, setCodigo] = useState("");
  const [titular, setTitular] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [ponto, setPonto] = useState("");
  const [obs, setObs] = useState("");
  const [pax, setPax] = useState<PassageiroRascunho[]>(() => [novoPassageiro()]);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const errosGerais: string[] = [];
  if (titular.trim().length < 2) errosGerais.push("Informe o nome do titular (mínimo 2 letras).");
  if (!emailValido(email)) errosGerais.push("E-mail do titular inválido.");
  if (pax.length === 0) errosGerais.push("Inclua pelo menos um passageiro.");
  const temErroPax = pax.some((p) => Object.keys(errosPassageiro(p)).length > 0);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setMostrarErros(true);
    setErro(null);
    if (errosGerais.length || temErroPax) {
      setErro("Corrija os campos destacados.");
      return;
    }
    setSalvando(true);
    try {
      await api.post(`/api/saidas/${saidaId}/reservas`, {
        canal,
        codigoExterno: codigo.trim() || null,
        contatoNome: titular.trim(),
        contatoTelefone: telefone.trim() || null,
        contatoEmail: email.trim() || null,
        pontoEmbarqueId: ponto || null,
        observacoes: obs.trim() || null,
        passageiros: pax.map(corpoPassageiro),
      });
      notificar(`Reserva de ${titular.trim()} incluída (${pax.length} passageiro${pax.length > 1 ? "s" : ""}).`);
      await aoSalvar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate className="form-reserva">
      {erro && (
        <Aviso tipo="erro" titulo={erro}>
          {mostrarErros && errosGerais.length > 0 && (
            <ul>
              {errosGerais.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </Aviso>
      )}
      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="nr-canal">Canal</label>
          <select id="nr-canal" value={canal} onChange={(e) => setCanal(e.target.value as Canal)}>
            {CANAIS.map((c) => (
              <option key={c} value={c}>
                {ROTULO_CANAL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="nr-codigo">Código no canal (opcional)</label>
          <input id="nr-codigo" maxLength={60} value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ex.: VIA-123456789" />
        </div>
        <div className="campo campo--largo">
          <label htmlFor="nr-titular">Titular da reserva</label>
          <input
            id="nr-titular"
            required
            maxLength={150}
            value={titular}
            onChange={(e) => setTitular(e.target.value)}
            aria-invalid={mostrarErros && titular.trim().length < 2}
          />
        </div>
        <div className="campo">
          <label htmlFor="nr-telefone">Telefone / WhatsApp</label>
          <input id="nr-telefone" type="tel" maxLength={40} autoComplete="off" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="+55 48 90000-0000" />
        </div>
        <div className="campo">
          <label htmlFor="nr-email">E-mail</label>
          <input id="nr-email" type="email" maxLength={200} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={mostrarErros && !emailValido(email)} />
        </div>
        <div className="campo campo--largo">
          <label htmlFor="nr-ponto">Ponto de embarque</label>
          <SelectPonto id="nr-ponto" valor={ponto} aoMudar={setPonto} pontos={pontos} rotuloVazio="A definir (contatar o cliente)" />
        </div>
        <div className="campo campo--largo">
          <label htmlFor="nr-obs">Observações</label>
          <textarea id="nr-obs" rows={2} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
      </div>

      <h3 className="subtitulo">Passageiros ({pax.length})</h3>
      {pax.map((p, i) => (
        <div key={p.chave} className="passageiro-linha">
          <CamposPassageiro valor={p} indice={i} mostrarErros={mostrarErros} aoMudar={(v) => setPax((l) => l.map((x) => (x.chave === v.chave ? v : x)))} />
          <div className="passageiro-linha__acoes">
            {i === 0 && titular.trim() && p.nome !== titular.trim() && (
              <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setPax((l) => l.map((x, k) => (k === 0 ? { ...x, nome: titular.trim() } : x)))}>
                Usar nome do titular
              </button>
            )}
            {pax.length > 1 && (
              <button type="button" className="botao botao--fantasma botao--pequeno texto-perigo" onClick={() => setPax((l) => l.filter((x) => x.chave !== p.chave))}>
                Remover passageiro {i + 1}
              </button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="botao botao--secundario" onClick={() => setPax((l) => [...l, novoPassageiro()])} disabled={pax.length >= 80}>
        <Icone nome="mais" /> Adicionar passageiro
      </button>

      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar reserva"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Editar reserva
function FormEditarReserva({ reserva, pontos, verContatos, aoSalvar, aoCancelar }: { reserva: Reserva; pontos: PontoEmbarque[]; verContatos: boolean; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const notificar = useNotificar();
  const [titular, setTitular] = useState(reserva.contatoNome);
  const [telefone, setTelefone] = useState(reserva.contatoTelefone ?? "");
  const [email, setEmail] = useState(reserva.contatoEmail ?? "");
  const [ponto, setPonto] = useState(reserva.pontoEmbarqueId ?? "");
  const [obs, setObs] = useState(reserva.observacoes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (titular.trim().length < 2) return setErro("Informe o nome do titular.");
    if (!emailValido(email)) return setErro("E-mail inválido.");
    // Envia só o que mudou (contatos ocultos para o perfil nunca são sobrescritos).
    const corpo: Record<string, unknown> = {};
    if (titular.trim() !== reserva.contatoNome) corpo.contatoNome = titular.trim();
    if (verContatos && telefone.trim() !== (reserva.contatoTelefone ?? "")) corpo.contatoTelefone = telefone.trim() || null;
    if (verContatos && email.trim() !== (reserva.contatoEmail ?? "")) corpo.contatoEmail = email.trim() || null;
    if (ponto !== (reserva.pontoEmbarqueId ?? "")) corpo.pontoEmbarqueId = ponto || null;
    if (obs.trim() !== (reserva.observacoes ?? "")) corpo.observacoes = obs.trim() || null;
    if (Object.keys(corpo).length === 0) return aoCancelar();
    setSalvando(true);
    try {
      await api.patch(`/api/reservas/${reserva.id}`, corpo);
      notificar("Reserva atualizada.");
      await aoSalvar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo">
          <label htmlFor="er-titular">Titular</label>
          <input id="er-titular" maxLength={150} value={titular} onChange={(e) => setTitular(e.target.value)} />
        </div>
        {verContatos && (
          <>
            <div className="campo">
              <label htmlFor="er-telefone">Telefone / WhatsApp</label>
              <input id="er-telefone" type="tel" maxLength={40} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="er-email">E-mail</label>
              <input id="er-email" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </>
        )}
        <div className="campo campo--largo">
          <label htmlFor="er-ponto">Ponto de embarque</label>
          <SelectPonto id="er-ponto" valor={ponto} aoMudar={setPonto} pontos={pontos} />
        </div>
        <div className="campo campo--largo">
          <label htmlFor="er-obs">Observações</label>
          <textarea id="er-obs" rows={3} maxLength={2000} value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Passageiro (incluir/editar)
function FormPassageiro({ reserva, passageiro, pontos, aoSalvar, aoCancelar }: { reserva: Reserva; passageiro: PassageiroReserva | null; pontos: PontoEmbarque[]; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const notificar = useNotificar();
  const [rascunho, setRascunho] = useState<PassageiroRascunho>(() =>
    novoPassageiro(
      passageiro
        ? { nome: passageiro.nome, categoria: passageiro.categoria, documentoTipo: passageiro.documentoTipo ?? "", documento: "", documentoPais: passageiro.documentoPais ?? "" }
        : {},
    ),
  );
  const [ponto, setPonto] = useState(passageiro?.pontoEmbarqueId ?? "");
  const [removerDoc, setRemoverDoc] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mostrarErros, setMostrarErros] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setMostrarErros(true);
    setErro(null);
    if (Object.keys(errosPassageiro(rascunho)).length) return setErro("Corrija os campos destacados.");
    const base = corpoPassageiro(rascunho);
    setSalvando(true);
    try {
      if (!passageiro) {
        await api.post(`/api/reservas/${reserva.id}/passageiros`, { ...base, pontoEmbarqueId: ponto || null });
        notificar("Passageiro incluído.");
      } else {
        const corpo: Record<string, unknown> = {};
        if (base.nome !== passageiro.nome) corpo.nome = base.nome;
        if (base.categoria !== passageiro.categoria) corpo.categoria = base.categoria;
        if (base.documentoPais !== (passageiro.documentoPais ?? null)) corpo.documentoPais = base.documentoPais;
        if (ponto !== (passageiro.pontoEmbarqueId ?? "")) corpo.pontoEmbarqueId = ponto || null;
        if (removerDoc) Object.assign(corpo, { documentoTipo: null, documento: null });
        else if (base.documento) Object.assign(corpo, { documentoTipo: base.documentoTipo, documento: base.documento });
        else if ((rascunho.documentoTipo || null) !== (passageiro.documentoTipo ?? null) && passageiro.documento) {
          setSalvando(false);
          return setErro("Para trocar o tipo do documento, digite também o número.");
        }
        if (Object.keys(corpo).length === 0) return aoCancelar();
        await api.patch(`/api/passageiros/${passageiro.id}`, corpo);
        notificar("Passageiro atualizado.");
      }
      await aoSalvar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <CamposPassageiro
        valor={rascunho}
        aoMudar={setRascunho}
        indice={0}
        mostrarErros={mostrarErros}
        ajudaDocumento={passageiro?.documento ? `Atual: ${passageiro.documento}. Deixe vazio para manter.` : undefined}
      />
      {passageiro?.documento && (
        <label className="caixa">
          <input type="checkbox" checked={removerDoc} onChange={(e) => setRemoverDoc(e.target.checked)} /> Remover o documento cadastrado
        </label>
      )}
      <div className="campo">
        <label htmlFor="fp-ponto">Ponto de embarque deste passageiro</label>
        <SelectPonto id="fp-ponto" valor={ponto} aoMudar={setPonto} pontos={pontos} rotuloVazio="O mesmo da reserva" />
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : passageiro ? "Salvar passageiro" : "Incluir passageiro"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Página
type Dialogo =
  | { tipo: "nova" }
  | { tipo: "editar"; reserva: Reserva }
  | { tipo: "status"; reserva: Reserva; status: "CANCELADA" | "CONFIRMADA" }
  | { tipo: "passageiro"; reserva: Reserva; passageiro: PassageiroReserva | null }
  | { tipo: "remover"; reserva: Reserva; passageiro: PassageiroReserva };

export function Reservas() {
  const { id, dados, carga } = useSaida();
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("reservas:editar");
  const verContatos = pode("manifesto:contatos");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [busca, setBusca] = useState("");
  const [verCanceladas, setVerCanceladas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const reservas = useCarregar((s) => api.get<Reserva[]>(`/api/saidas/${id}/reservas`, s), [id]);
  const pontosCarga = useCarregar((s) => api.get<PontoEmbarque[]>(`/api/passeios/${dados.saida.passeioId}/pontos`, s), [dados.saida.passeioId]);
  const pontos = useMemo(() => ordenarPontos(pontosCarga.dados ?? []), [pontosCarga.dados]);
  const nomePonto = (pid: string | null) => {
    const p = pontos.find((x) => x.id === pid);
    return p ? `${p.horario} — ${p.nome}` : null;
  };

  async function atualizarTudo() {
    setDialogo(null);
    await Promise.all([reservas.recarregar(), carga.recarregar()]);
  }

  async function executar(fn: () => Promise<unknown>, msg: string) {
    setOcupado(true);
    setErroAcao(null);
    try {
      await fn();
      notificar(msg);
      await atualizarTudo();
    } catch (e) {
      setErroAcao(mensagemDeErro(e));
      setDialogo(null);
    } finally {
      setOcupado(false);
    }
  }

  const termo = busca.trim().toLowerCase();
  const lista = (reservas.dados ?? []).filter((r) => {
    if (!verCanceladas && r.status === "CANCELADA") return false;
    if (!termo) return true;
    return [r.contatoNome, r.codigoExterno ?? "", ...r.referencias, ...r.passageiros.map((p) => p.nome)].some((x) => x.toLowerCase().includes(termo));
  });
  const canceladas = (reservas.dados ?? []).filter((r) => r.status === "CANCELADA").length;

  return (
    <div className="reservas">
      <div className="barra-ferramentas">
        <div className="campo campo--busca">
          <label htmlFor="busca-reservas" className="visualmente-oculto">
            Buscar reserva
          </label>
          <input id="busca-reservas" type="search" placeholder="Buscar titular, código ou passageiro" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="caixa">
          <input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} /> Mostrar canceladas ({canceladas})
        </label>
        {podeEditar && (
          <button type="button" className="botao botao--primario" onClick={() => setDialogo({ tipo: "nova" })} disabled={!pontosCarga.dados}>
            <Icone nome="mais" /> Incluir reserva
          </button>
        )}
      </div>

      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {pontosCarga.erro && <Aviso tipo="erro">Não foi possível carregar os pontos de embarque: {pontosCarga.erro}</Aviso>}

      {reservas.carregando && !reservas.dados ? (
        <Carregando texto="Carregando reservas…" />
      ) : reservas.erro ? (
        <ErroCarga mensagem={reservas.erro} tentarDeNovo={reservas.recarregar} />
      ) : lista.length === 0 ? (
        <Vazio titulo={termo ? "Nenhuma reserva encontrada para a busca." : "Nenhuma reserva nesta saída."}>
          {podeEditar && !termo && "Use “Incluir reserva” ou importe da Bókun/Paytour."}
        </Vazio>
      ) : (
        <ul className="lista-reservas">
          {lista.map((r) => (
            <li key={r.id} className={`reserva${r.status === "CANCELADA" ? " reserva--cancelada" : ""}`}>
              <div className="reserva__cabecalho">
                <div>
                  <h2 className="reserva__titular">{r.contatoNome}</h2>
                  <p className="reserva__meta">
                    <span className="etiqueta etiqueta--neutra">{ROTULO_CANAL[r.canal]}</span>
                    {r.codigoExterno && <span className="mono">{r.codigoExterno}</span>}
                    {r.status === "CANCELADA" && <span className="etiqueta etiqueta--perigo">{ROTULO_STATUS_RESERVA[r.status]}</span>}
                    <span>{nomePonto(r.pontoEmbarqueId) ?? <strong className="texto-atencao">Ponto a definir</strong>}</span>
                  </p>
                  {verContatos && (r.contatoTelefone || r.contatoEmail) && (
                    <p className="reserva__contato">
                      {r.contatoTelefone && <span>Tel.: {r.contatoTelefone}</span>}
                      {r.contatoEmail && <span>E-mail: {r.contatoEmail}</span>}
                    </p>
                  )}
                  {r.observacoes && <p className="reserva__obs">Obs.: {r.observacoes}</p>}
                </div>
                {podeEditar && (
                  <div className="reserva__acoes">
                    <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setDialogo({ tipo: "editar", reserva: r })} aria-label={`Editar reserva de ${r.contatoNome}`}>
                      Editar
                    </button>
                    {r.status === "CONFIRMADA" ? (
                      <button type="button" className="botao botao--perigo-contorno botao--pequeno" onClick={() => setDialogo({ tipo: "status", reserva: r, status: "CANCELADA" })} aria-label={`Cancelar reserva de ${r.contatoNome}`}>
                        Cancelar reserva
                      </button>
                    ) : (
                      <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setDialogo({ tipo: "status", reserva: r, status: "CONFIRMADA" })} aria-label={`Reativar reserva de ${r.contatoNome}`}>
                        Reativar
                      </button>
                    )}
                  </div>
                )}
              </div>
              <table className="tabela tabela--compacta">
                <caption className="visualmente-oculto">Passageiros da reserva de {r.contatoNome}</caption>
                <thead>
                  <tr>
                    <th scope="col">Passageiro</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Documento</th>
                    <th scope="col">Embarque</th>
                    {podeEditar && <th scope="col"><span className="visualmente-oculto">Ações</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {r.passageiros.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.nome.trim() || <em className="texto-fraco">(a informar)</em>}
                        {p.pontoEmbarqueId && p.pontoEmbarqueId !== r.pontoEmbarqueId && <span className="texto-fraco"> · embarca em {nomePonto(p.pontoEmbarqueId)}</span>}
                      </td>
                      <td>{ROTULO_CATEGORIA[p.categoria]}</td>
                      <td>
                        {p.documento ? (
                          <>
                            {p.documentoTipo && `${ROTULO_DOCUMENTO[p.documentoTipo]} `}
                            <span className="mono">{p.documento}</span>
                            {p.documentoValido === false && <span className="etiqueta etiqueta--perigo">inválido</span>}
                          </>
                        ) : (
                          <span className="texto-fraco">—</span>
                        )}
                      </td>
                      <td>{ROTULO_EMBARQUE[p.embarque]}</td>
                      {podeEditar && (
                        <td className="celula-acoes">
                          <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setDialogo({ tipo: "passageiro", reserva: r, passageiro: p })} aria-label={`Editar passageiro ${p.nome || "sem nome"}`}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="botao botao--fantasma botao--pequeno texto-perigo"
                            onClick={() => setDialogo({ tipo: "remover", reserva: r, passageiro: p })}
                            aria-label={`Remover passageiro ${p.nome || "sem nome"}`}
                          >
                            Remover
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {podeEditar && r.status === "CONFIRMADA" && (
                <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setDialogo({ tipo: "passageiro", reserva: r, passageiro: null })}>
                  <Icone nome="mais" tamanho={16} /> Adicionar passageiro
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal aberto={dialogo?.tipo === "nova"} titulo="Incluir reserva" aoFechar={() => setDialogo(null)} largura="larga">
        {dialogo?.tipo === "nova" && <FormNovaReserva saidaId={id} pontos={pontos} aoSalvar={atualizarTudo} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "editar"} titulo="Editar reserva" aoFechar={() => setDialogo(null)}>
        {dialogo?.tipo === "editar" && <FormEditarReserva reserva={dialogo.reserva} pontos={pontos} verContatos={verContatos} aoSalvar={atualizarTudo} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      <Modal aberto={dialogo?.tipo === "passageiro"} titulo={dialogo?.tipo === "passageiro" && dialogo.passageiro ? "Editar passageiro" : "Adicionar passageiro"} aoFechar={() => setDialogo(null)} largura="larga">
        {dialogo?.tipo === "passageiro" && <FormPassageiro reserva={dialogo.reserva} passageiro={dialogo.passageiro} pontos={pontos} aoSalvar={atualizarTudo} aoCancelar={() => setDialogo(null)} />}
      </Modal>
      {dialogo?.tipo === "status" && (
        <Confirmar
          aberto
          titulo={dialogo.status === "CANCELADA" ? "Cancelar reserva?" : "Reativar reserva?"}
          textoConfirmar={dialogo.status === "CANCELADA" ? "Cancelar reserva" : "Reativar reserva"}
          perigo={dialogo.status === "CANCELADA"}
          ocupado={ocupado}
          aoFechar={() => setDialogo(null)}
          aoConfirmar={() =>
            void executar(
              () => api.patch(`/api/reservas/${dialogo.reserva.id}`, { status: dialogo.status }),
              dialogo.status === "CANCELADA" ? "Reserva cancelada." : "Reserva reativada.",
            )
          }
          mensagem={
            <p>
              Reserva de <strong>{dialogo.reserva.contatoNome}</strong> ({dialogo.reserva.passageiros.length} passageiro(s)).
              {dialogo.status === "CANCELADA" && " Os passageiros saem da lista de embarque. Se a reserva veio de uma OTA, cancele também no canal."}
            </p>
          }
        />
      )}
      {dialogo?.tipo === "remover" && (
        <Confirmar
          aberto
          titulo="Remover passageiro?"
          textoConfirmar="Remover"
          perigo
          ocupado={ocupado}
          aoFechar={() => setDialogo(null)}
          aoConfirmar={() => void executar(() => api.delete(`/api/passageiros/${dialogo.passageiro.id}`), "Passageiro removido.")}
          mensagem={
            <p>
              Remover <strong>{dialogo.passageiro.nome || "(passageiro sem nome)"}</strong> da reserva de {dialogo.reserva.contatoNome}? Esta ação não pode ser desfeita.
            </p>
          }
        />
      )}
    </div>
  );
}
