import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, mensagemDeErro, qs } from "../api/cliente";
import type { DiaEscala, EquipeEscala, Passeio, RespostaEscala } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { formatarDataCurta, hojeIso } from "../util/formato";
import { useCarregar } from "../util/useCarregar";

type Plano = Record<string, { guiaId: string | null; motoristaId: string | null }>;

export function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nomeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  const t = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15)));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function Troca({ dia, passeioId, equipe, aoConcluir, aoFechar }: { dia: DiaEscala; passeioId: string; equipe: EquipeEscala; aoConcluir: () => Promise<void>; aoFechar: () => void }) {
  const [guiaId, setGuiaId] = useState(dia.guiaId ?? "");
  const [motoristaId, setMotoristaId] = useState(dia.motoristaId ?? "");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 5) return setErro("Descreva o motivo da troca (força maior).");
    setSalvando(true);
    setErro(null);
    try {
      await api.post("/api/escala/troca", { passeioId, data: dia.data, guiaId: guiaId || null, motoristaId: motoristaId || null, motivo: motivo.trim() });
      await aoConcluir();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal aberto titulo={`Trocar equipe — ${formatarDataCurta(dia.data)}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <p className="texto-fraco">A escala deste dia já foi publicada. A troca fica registrada com o motivo e vai para a saída do dia.</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="campo">
          <label htmlFor="troca-guia">Guia</label>
          <select id="troca-guia" value={guiaId} onChange={(e) => setGuiaId(e.target.value)}>
            <option value="">Sem guia</option>
            {equipe.guias.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="troca-motorista">Motorista</label>
          <select id="troca-motorista" value={motoristaId} onChange={(e) => setMotoristaId(e.target.value)}>
            <option value="">Motorista padrão</option>
            {equipe.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="troca-motivo">Motivo (força maior)</label>
          <textarea id="troca-motivo" rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: guia com atestado médico" />
        </div>
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Confirmar troca"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Escala() {
  const { pode, praca } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("escala:gerenciar");
  const [mes, setMes] = useState(() => hojeIso().slice(0, 7));
  const passeios = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const opcoes = (passeios.dados ?? []).filter((p) => p.ativo && (!praca || p.unidadeId === praca));
  const [passeioId, setPasseioId] = useState("");
  const atual = opcoes.find((p) => p.id === passeioId) ?? opcoes[0] ?? null;

  const escala = useCarregar((s) => (atual ? api.get<RespostaEscala>(`/api/escala${qs({ passeioId: atual.id, mes })}`, s) : Promise.resolve(null)), [atual?.id, mes]);
  const equipe = useCarregar((s) => (atual ? api.get<EquipeEscala>(`/api/escala/equipe${qs({ passeioId: atual.id })}`, s) : Promise.resolve(null)), [atual?.id]);

  const [plano, setPlano] = useState<Plano>({});
  const [motoristaPadrao, setMotoristaPadrao] = useState("");
  const [veiculo, setVeiculo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [troca, setTroca] = useState<DiaEscala | null>(null);

  useEffect(() => {
    const e = escala.dados;
    if (!e) return;
    setPlano(Object.fromEntries(e.dias.map((d) => [d.data, { guiaId: d.guiaId, motoristaId: d.motoristaId }])));
    setMotoristaPadrao(e.passeio.motoristaPadraoId ?? "");
    setVeiculo(e.passeio.veiculoPadrao ?? "");
  }, [escala.dados]);

  const alterados = useMemo(
    () => (escala.dados?.dias ?? []).filter((d) => !d.publicada && ((plano[d.data]?.guiaId ?? null) !== d.guiaId || (plano[d.data]?.motoristaId ?? null) !== d.motoristaId)),
    [escala.dados, plano],
  );
  const publicado = (escala.dados?.dias ?? []).some((d) => d.publicada);
  const semGuia = (escala.dados?.dias ?? []).filter((d) => d.data >= hojeIso() && !(plano[d.data]?.guiaId)).length;

  async function salvar(publicar: boolean) {
    if (!atual || !escala.dados) return;
    setSalvando(true);
    setErro(null);
    try {
      await api.put("/api/escala", {
        passeioId: atual.id, mes, publicar,
        motoristaPadraoId: motoristaPadrao || null, veiculoPadrao: veiculo.trim() || null,
        dias: alterados.map((d) => ({ data: d.data, guiaId: plano[d.data]?.guiaId ?? null, motoristaId: plano[d.data]?.motoristaId ?? null })),
      });
      notificar(publicar ? `Escala de ${nomeMes(mes)} publicada.` : "Escala salva.");
      await escala.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  function definir(data: string, campo: "guiaId" | "motoristaId", valor: string) {
    setPlano((p) => ({ ...p, [data]: { guiaId: p[data]?.guiaId ?? null, motoristaId: p[data]?.motoristaId ?? null, [campo]: valor || null } }));
  }

  if (passeios.carregando && !passeios.dados) return <Carregando />;
  if (passeios.erro) return <ErroCarga mensagem={passeios.erro} tentarDeNovo={passeios.recarregar} />;
  if (!atual) return <Vazio titulo="Nenhum passeio ativo nesta praça." />;

  const e = escala.dados;
  const eq = equipe.dados;
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Escala de guias</h1>
          <p className="pagina__descricao">Guia de cada dia pela escala do mês; motorista padrão do passeio. Depois de publicada, trocas só com motivo (força maior).</p>
        </div>
        <div className="barra-acoes">
          <button type="button" className="botao botao--secundario" onClick={() => setMes(somarMes(mes, -1))} aria-label="Mês anterior">←</button>
          <span className="escala__mes" aria-live="polite">{nomeMes(mes)}</span>
          <button type="button" className="botao botao--secundario" onClick={() => setMes(somarMes(mes, 1))} aria-label="Próximo mês">→</button>
        </div>
      </div>

      <div className="filtros">
        {opcoes.length > 1 && (
          <div className="campo campo--linha">
            <label htmlFor="escala-passeio">Passeio</label>
            <select id="escala-passeio" value={atual.id} onChange={(ev) => setPasseioId(ev.target.value)}>
              {opcoes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
        <div className="campo campo--linha">
          <label htmlFor="escala-motorista-padrao">Motorista padrão</label>
          <select id="escala-motorista-padrao" value={motoristaPadrao} disabled={!podeEditar} onChange={(ev) => setMotoristaPadrao(ev.target.value)}>
            <option value="">Nenhum</option>
            {eq?.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div className="campo campo--linha">
          <label htmlFor="escala-veiculo">Veículo padrão</label>
          <input id="escala-veiculo" value={veiculo} maxLength={40} disabled={!podeEditar} onChange={(ev) => setVeiculo(ev.target.value)} placeholder="Placa" />
        </div>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {escala.carregando && !e ? <Carregando /> : escala.erro ? <ErroCarga mensagem={escala.erro} tentarDeNovo={escala.recarregar} /> : equipe.erro ? <ErroCarga mensagem={equipe.erro} tentarDeNovo={equipe.recarregar} /> : e && eq && (
        <>
          <div className="escala__resumo">
            <span className={`etiqueta ${publicado ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{publicado ? "Publicada" : "Em planejamento"}</span>
            {semGuia > 0 && <span className="etiqueta etiqueta--atencao">{semGuia} dia(s) sem guia</span>}
            {e.dias.some((d) => d.origem === "TROCA") && <span className="etiqueta etiqueta--neutra">{e.dias.filter((d) => d.origem === "TROCA").length} troca(s) no mês</span>}
          </div>
          <div className="tabela-rolagem">
            <table className="tabela escala">
              <thead>
                <tr><th>Dia</th><th>Guia</th><th>Motorista</th><th>Situação</th><th>Saída</th></tr>
              </thead>
              <tbody>
                {e.dias.map((d) => {
                  const p = plano[d.data] ?? { guiaId: null, motoristaId: null };
                  const passado = d.data < hojeIso();
                  const fimDeSemana = [0, 6].includes(new Date(`${d.data}T12:00:00Z`).getUTCDay());
                  return (
                    <tr key={d.data} className={`${passado ? "linha--inativa" : ""}${fimDeSemana ? " escala__fds" : ""}`}>
                      <td className="sem-quebra">{formatarDataCurta(d.data)}</td>
                      <td>
                        {d.publicada || !podeEditar || passado ? (d.guia ?? <span className="texto-fraco">—</span>) : (
                          <select aria-label={`Guia em ${formatarDataCurta(d.data)}`} value={p.guiaId ?? ""} onChange={(ev) => definir(d.data, "guiaId", ev.target.value)}>
                            <option value="">Sem guia</option>
                            {eq.guias.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        {d.publicada || !podeEditar || passado ? (d.motorista ?? <span className="texto-fraco">{e.passeio.motoristaPadrao ? `${e.passeio.motoristaPadrao} (padrão)` : "—"}</span>) : (
                          <select aria-label={`Motorista em ${formatarDataCurta(d.data)}`} value={p.motoristaId ?? ""} onChange={(ev) => definir(d.data, "motoristaId", ev.target.value)}>
                            <option value="">{e.passeio.motoristaPadrao ? `Padrão (${e.passeio.motoristaPadrao})` : "Padrão"}</option>
                            {eq.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                          </select>
                        )}
                      </td>
                      <td>
                        {d.origem === "TROCA" ? <span className="etiqueta etiqueta--atencao" title={d.motivo ?? ""}>Troca: {d.motivo}</span> : d.publicada ? <span className="etiqueta etiqueta--sucesso">Publicada</span> : null}
                        {d.alertas.map((a) => <span key={a} className="etiqueta etiqueta--perigo">{a}</span>)}
                        {d.publicada && podeEditar && !passado && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setTroca(d)}>Trocar</button>}
                      </td>
                      <td>{d.saida ? <Link to={`/saidas/${d.saida.id}`}>Abrir</Link> : <span className="texto-fraco">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {podeEditar && (
            <div className="barra-acoes escala__acoes">
              <button type="button" className="botao botao--secundario" disabled={salvando} onClick={() => void salvar(false)}>Salvar rascunho</button>
              <button type="button" className="botao botao--primario" disabled={salvando} onClick={() => void salvar(true)}>Publicar escala de {nomeMes(mes)}</button>
            </div>
          )}
        </>
      )}
      {troca && atual && eq && (
        <Troca dia={troca} passeioId={atual.id} equipe={eq} aoFechar={() => setTroca(null)} aoConcluir={async () => { setTroca(null); notificar("Troca registrada."); await escala.recarregar(); }} />
      )}
    </div>
  );
}
