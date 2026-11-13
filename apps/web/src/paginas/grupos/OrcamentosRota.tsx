import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ROTULO_VEICULO_ORCAMENTO, VEICULOS_ORCAMENTO, horasTexto, type PontoOrcamento, type TabelaPrecos, type TabelaVeiculo, type VeiculoOrcamento,
} from "@bybus/core";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";

interface Orcamento {
  id: string; numero: string; unidadeId: string | null; cliente: string; contato: string | null; grupoId: string | null; dataPasseio: string | null; horarioInicio: string | null;
  veiculo: VeiculoOrcamento; pessoas: number | null; pontos: PontoOrcamento[]; distanciaKm: number | null; duracaoRotaMin: number | null; folgaMin: number;
  cargaHorariaMin: number | null; valorCalculadoCentavos: number | null; valorFinalCentavos: number | null; validadeDias: number; observacoes: string | null; criadoEm: string;
}
interface Calculo {
  distanciaKm: number; duracaoMin: number; cargaHorariaMin: number; fonte: "OPENROUTESERVICE" | "ESTIMATIVA" | "SEM_ROTA";
  preco: { porKmCentavos: number; porHoraCentavos: number; horasCobradas: number; totalCentavos: number; aplicouMinimo: boolean };
}
interface Local { nome: string; lat: number; lng: number; fonte: "CADASTRO" | "MAPA" }

const valorDe = (o: Orcamento) => o.valorFinalCentavos ?? o.valorCalculadoCentavos;

export function OrcamentosRota() {
  const lista = useCarregar((s) => api.get<Orcamento[]>("/api/orcamentos-rota", s), []);
  const { pode } = useSessao();
  const [tabela, setTabela] = useState(false);
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Orçamento com rota</h1>
          <p className="pagina__descricao">Pontos de visitação, rota pelas ruas, veículo, carga horária e valor pela tabela — com PDF no papel timbrado. Fechou? Vira grupo fechado.</p>
        </div>
        <div className="barra-acoes">
          <button type="button" className="botao botao--secundario" onClick={() => setTabela(true)}><Icone nome="engrenagem" /> Tabela de preços</button>
          <Link className="botao botao--primario" to="/orcamentos-rota/novo"><Icone nome="mais" /> Novo orçamento</Link>
        </div>
      </div>
      {tabela && <TabelaPrecosModal podeEditar={pode("financeiro:gerenciar")} aoFechar={() => setTabela(false)} />}
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : !lista.dados?.length ? <Vazio titulo="Nenhum orçamento ainda." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th scope="col">Nº</th><th scope="col">Cliente</th><th scope="col">Passeio</th><th scope="col">Veículo</th><th scope="col" className="num">Km</th><th scope="col" className="num">Valor</th><th scope="col">Grupo</th></tr></thead>
            <tbody>
              {lista.dados.map((o) => (
                <tr key={o.id}>
                  <td className="sem-quebra"><Link to={`/orcamentos-rota/${o.id}`}><strong>{o.numero}</strong></Link></td>
                  <td>{o.cliente}{o.contato && <div className="texto-fraco">{o.contato}</div>}</td>
                  <td className="sem-quebra">{o.dataPasseio ? formatarData(o.dataPasseio) : "A definir"}</td>
                  <td>{ROTULO_VEICULO_ORCAMENTO[o.veiculo]}{o.pessoas ? <div className="texto-fraco">{o.pessoas} pessoas</div> : null}</td>
                  <td className="num">{o.distanciaKm != null ? String(o.distanciaKm).replace(".", ",") : "—"}</td>
                  <td className="num">{valorDe(o) != null ? formatarMoeda(valorDe(o)!) : "—"}</td>
                  <td>{o.grupoId ? <Link to={`/grupos/${o.grupoId}`}>Ver grupo</Link> : <span className="texto-fraco">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Tabela por veículo (dono, 13/11/2026): valor por km, por hora, horas mínimas e valor mínimo. Só o financeiro altera. */
function TabelaPrecosModal({ podeEditar, aoFechar }: { podeEditar: boolean; aoFechar: () => void }) {
  const notificar = useNotificar();
  const dados = useCarregar((s) => api.get<TabelaPrecos>("/api/orcamentos-rota/tabela", s), []);
  const [f, setF] = useState<Record<string, Record<keyof TabelaVeiculo, string>> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!dados.dados) return;
    const t = dados.dados;
    setF(Object.fromEntries(VEICULOS_ORCAMENTO.map((v) => [v, {
      valorKmCentavos: textoDeCentavos(t[v].valorKmCentavos), valorHoraCentavos: textoDeCentavos(t[v].valorHoraCentavos),
      horasMinimas: String(t[v].horasMinimas).replace(".", ","), minimoCentavos: textoDeCentavos(t[v].minimoCentavos),
    }])));
  }, [dados.dados]);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    try {
      await api.put("/api/orcamentos-rota/tabela", Object.fromEntries(VEICULOS_ORCAMENTO.map((v) => [v, {
        valorKmCentavos: centavosDeTexto(f[v]!.valorKmCentavos) ?? 0, valorHoraCentavos: centavosDeTexto(f[v]!.valorHoraCentavos) ?? 0,
        horasMinimas: Number(f[v]!.horasMinimas.replace(",", ".")) || 0, minimoCentavos: centavosDeTexto(f[v]!.minimoCentavos) ?? 0,
      }])));
      notificar("Tabela de preços salva.");
      aoFechar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  const campo = (v: string, k: keyof TabelaVeiculo, rotulo: string) => (
    <div className="campo"><label htmlFor={`tp-${v}-${k}`}>{rotulo}</label>
      <input id={`tp-${v}-${k}`} inputMode="decimal" value={f?.[v]?.[k] ?? ""} disabled={!podeEditar} onChange={(e) => f && setF({ ...f, [v]: { ...f[v]!, [k]: e.target.value } })} />
    </div>
  );
  return (
    <Modal aberto titulo="Tabela de preços por veículo" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!f ? <Carregando /> : (
        <form onSubmit={(e) => void salvar(e)}>
          <p className="texto-fraco">Valor = km × valor por km + horas (no mínimo as horas mínimas) × valor por hora, nunca abaixo do valor mínimo. {!podeEditar && "Só o financeiro altera."}</p>
          {VEICULOS_ORCAMENTO.map((v) => (
            <fieldset key={v} className="grupo-campos">
              <legend>{ROTULO_VEICULO_ORCAMENTO[v]}</legend>
              <div className="grade-campos">
                {campo(v, "valorKmCentavos", "R$ por km")}
                {campo(v, "valorHoraCentavos", "R$ por hora")}
                {campo(v, "horasMinimas", "Horas mínimas")}
                {campo(v, "minimoCentavos", "Valor mínimo (R$)")}
              </div>
            </fieldset>
          ))}
          {podeEditar && <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button><button type="submit" className="botao botao--primario">Salvar</button></div>}
        </form>
      )}
    </Modal>
  );
}

interface Form {
  unidadeId: string; cliente: string; contato: string; dataPasseio: string; horarioInicio: string; veiculo: VeiculoOrcamento; pessoas: string;
  folgaMin: string; valorFinal: string; validadeDias: string; observacoes: string; pontos: PontoOrcamento[];
}
const formVazio = (): Form => ({ unidadeId: "", cliente: "", contato: "", dataPasseio: "", horarioInicio: "", veiculo: "ONIBUS", pessoas: "", folgaMin: "30", valorFinal: "", validadeDias: "15", observacoes: "", pontos: [] });

export function OrcamentoRotaFicha() {
  const { id } = useParams();
  const novo = id === "novo";
  const navegar = useNavigate();
  const notificar = useNotificar();
  const { unidades } = useSessao();
  const atual = useCarregar((s) => (novo ? Promise.resolve(null) : api.get<Orcamento>(`/api/orcamentos-rota/${id}`, s)), [id]);
  const [f, setF] = useState<Form>(formVazio);
  const [calc, setCalc] = useState<Calculo | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Local[] | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const o = atual.dados;
    if (!o) return;
    setF({
      unidadeId: o.unidadeId ?? "", cliente: o.cliente, contato: o.contato ?? "", dataPasseio: o.dataPasseio ?? "", horarioInicio: o.horarioInicio ?? "", veiculo: o.veiculo,
      pessoas: o.pessoas ? String(o.pessoas) : "", folgaMin: String(o.folgaMin), valorFinal: textoDeCentavos(o.valorFinalCentavos), validadeDias: String(o.validadeDias),
      observacoes: o.observacoes ?? "", pontos: o.pontos,
    });
  }, [atual.dados]);

  // Recalcula a rota e o valor quando mudam os pontos, o veículo ou a folga (o servidor confere de novo ao salvar).
  const chave = JSON.stringify([f.pontos, f.veiculo, f.folgaMin]);
  useEffect(() => {
    if (f.pontos.length < 2) { setCalc(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setCalculando(true);
      api.post<Calculo>("/api/orcamentos-rota/calcular", { pontos: f.pontos, veiculo: f.veiculo, folgaMin: Number(f.folgaMin) || 0 })
        .then((r) => { if (!ctl.signal.aborted) setCalc(r); })
        .catch((x) => { if (!ctl.signal.aborted) setErro(mensagemDeErro(x)); })
        .finally(() => { if (!ctl.signal.aborted) setCalculando(false); });
    }, 500);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const mudar = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const mudarPonto = (i: number, p: Partial<PontoOrcamento>) => mudar("pontos", f.pontos.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const mover = (i: number, d: -1 | 1) => {
    const p = [...f.pontos];
    const j = i + d;
    if (j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j]!, p[i]!];
    mudar("pontos", p);
  };

  async function procurar(e: FormEvent) {
    e.preventDefault();
    if (busca.trim().length < 3) return;
    setProcurando(true);
    try {
      setAchados(await api.post<Local[]>("/api/orcamentos-rota/localizar", { texto: busca.trim() }));
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setProcurando(false);
    }
  }
  function adicionar(l: Local) {
    const nome = l.fonte === "MAPA" ? l.nome.split(",").slice(0, 2).join(",").trim() : l.nome;
    mudar("pontos", [...f.pontos, { nome: nome.slice(0, 160), lat: l.lat, lng: l.lng, permanenciaMin: f.pontos.length ? 30 : 0 }]);
    setAchados(null);
    setBusca("");
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (f.pontos.length < 2) { setErro("Inclua pelo menos dois pontos (saída e um destino)."); return; }
    const corpo = {
      unidadeId: f.unidadeId || null, cliente: f.cliente, contato: f.contato || null, dataPasseio: f.dataPasseio || null, horarioInicio: f.horarioInicio || null,
      veiculo: f.veiculo, pessoas: f.pessoas ? Number(f.pessoas) : null, pontos: f.pontos, folgaMin: Number(f.folgaMin) || 0,
      valorFinalCentavos: f.valorFinal.trim() ? centavosDeTexto(f.valorFinal) : null, validadeDias: Number(f.validadeDias) || 15, observacoes: f.observacoes || null,
    };
    setSalvando(true);
    try {
      if (novo) {
        const r = await api.post<{ id: string; numero: string }>("/api/orcamentos-rota", corpo);
        notificar(`Orçamento ${r.numero} criado.`);
        navegar(`/orcamentos-rota/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/orcamentos-rota/${id}`, corpo);
        notificar("Orçamento salvo.");
        atual.recarregar();
      }
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  async function virarGrupo() {
    try {
      const r = await api.post<{ grupoId: string }>(`/api/orcamentos-rota/${id}/grupo`, {});
      notificar("Grupo fechado criado a partir do orçamento.");
      navegar(`/grupos/${r.grupoId}`);
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  if (!novo && atual.carregando && !atual.dados) return <div className="pagina"><Carregando /></div>;
  if (!novo && atual.erro) return <div className="pagina"><ErroCarga mensagem={atual.erro} tentarDeNovo={atual.recarregar} /></div>;
  const o = atual.dados;
  const valorFinal = f.valorFinal.trim() ? centavosDeTexto(f.valorFinal) : null;
  const pessoas = Number(f.pessoas) || 0;
  const total = valorFinal ?? calc?.preco.totalCentavos ?? null;

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <p><Link to="/orcamentos-rota">← Orçamentos com rota</Link></p>
          <h1>{novo ? "Novo orçamento com rota" : `Orçamento ${o?.numero ?? ""}`}</h1>
        </div>
        {!novo && o && (
          <div className="barra-acoes">
            <a className="botao botao--secundario" href={`/api/orcamentos-rota/${o.id}/pdf`} target="_blank" rel="noreferrer"><Icone nome="baixar" /> PDF do orçamento</a>
            {o.grupoId
              ? <Link className="botao botao--secundario" to={`/grupos/${o.grupoId}`}><Icone nome="pessoas" /> Ver grupo</Link>
              : <button type="button" className="botao botao--primario" onClick={() => void virarGrupo()}><Icone nome="pessoas" /> Fechou: virar grupo</button>}
          </div>
        )}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <form onSubmit={(e) => void salvar(e)}>
        <div className="grade-campos">
          <div className="campo campo--largo"><label htmlFor="or-cliente">Cliente (escola, empresa, grupo)</label><input id="or-cliente" required minLength={2} value={f.cliente} onChange={(e) => mudar("cliente", e.target.value)} /></div>
          <div className="campo campo--largo"><label htmlFor="or-contato">Contato</label><input id="or-contato" value={f.contato} onChange={(e) => mudar("contato", e.target.value)} placeholder="Nome e telefone ou e-mail" /></div>
          {unidades.length > 1 && <div className="campo"><label htmlFor="or-praca">Praça</label><select id="or-praca" value={f.unidadeId} onChange={(e) => mudar("unidadeId", e.target.value)}><option value="">Todas</option>{unidades.map((u) => <option key={u.id} value={u.id}>{nomePraca(unidades, u.id)}</option>)}</select></div>}
          <div className="campo"><label htmlFor="or-data">Data do passeio</label><input id="or-data" type="date" value={f.dataPasseio} onChange={(e) => mudar("dataPasseio", e.target.value)} /></div>
          <div className="campo"><label htmlFor="or-hora">Saída</label><input id="or-hora" type="time" value={f.horarioInicio} onChange={(e) => mudar("horarioInicio", e.target.value)} /></div>
          <div className="campo"><label htmlFor="or-veiculo">Veículo</label><select id="or-veiculo" value={f.veiculo} onChange={(e) => mudar("veiculo", e.target.value as VeiculoOrcamento)}>{VEICULOS_ORCAMENTO.map((v) => <option key={v} value={v}>{ROTULO_VEICULO_ORCAMENTO[v]}</option>)}</select></div>
          <div className="campo"><label htmlFor="or-pessoas">Pessoas</label><input id="or-pessoas" type="number" min={1} value={f.pessoas} onChange={(e) => mudar("pessoas", e.target.value)} /></div>
        </div>

        <h2>Roteiro</h2>
        <p className="texto-fraco">O primeiro ponto é a saída. Procure cada local pelo nome ou endereço e informe quanto tempo o grupo fica em cada parada.</p>
        <div className="campo campo--linha campo--busca">
          <label htmlFor="or-busca">Adicionar ponto</label>
          <input id="or-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: Ponte Hercílio Luz, Lagoa da Conceição"
            onKeyDown={(e) => { if (e.key === "Enter") void procurar(e); }} />
          <button type="button" className="botao botao--secundario" disabled={procurando || busca.trim().length < 3} onClick={(e) => void procurar(e)}><Icone nome="mapa" /> {procurando ? "Procurando…" : "Procurar"}</button>
        </div>
        {achados && (
          achados.length ? (
            <ul className="lista-simples" aria-label="Locais encontrados">
              {achados.map((l, i) => (
                <li key={i}><button type="button" className="botao botao--link" onClick={() => adicionar(l)}><Icone nome="mais" /> {l.nome}</button> <span className="texto-fraco">{l.fonte === "CADASTRO" ? "ponto cadastrado" : "mapa"}</span></li>
              ))}
            </ul>
          ) : <p className="texto-fraco">Nada encontrado. Tente outro nome ou o endereço.</p>
        )}
        {f.pontos.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th scope="col">#</th><th scope="col">Ponto</th><th scope="col" className="num">Permanência (min)</th><th scope="col"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {f.pontos.map((p, i) => (
                  <tr key={`${i}-${p.lat}-${p.lng}`}>
                    <td>{i === 0 ? "Saída" : String.fromCharCode(96 + i)}</td>
                    <td><input aria-label={`Nome do ponto ${i + 1}`} value={p.nome} maxLength={160} onChange={(e) => mudarPonto(i, { nome: e.target.value })} /></td>
                    <td className="num"><input aria-label={`Permanência no ponto ${i + 1}`} type="number" min={0} max={600} step={5} value={p.permanenciaMin} onChange={(e) => mudarPonto(i, { permanenciaMin: Math.max(0, Number(e.target.value) || 0) })} /></td>
                    <td className="sem-quebra">
                      <button type="button" className="botao botao--icone" aria-label={`Subir ${p.nome}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                      <button type="button" className="botao botao--icone" aria-label={`Descer ${p.nome}`} disabled={i === f.pontos.length - 1} onClick={() => mover(i, 1)}>↓</button>
                      <button type="button" className="botao botao--icone" aria-label={`Tirar ${p.nome}`} onClick={() => mudar("pontos", f.pontos.filter((_, j) => j !== i))}><Icone nome="x" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>Rota e valor</h2>
        {f.pontos.length < 2 ? <p className="texto-fraco">Inclua pelo menos dois pontos para calcular.</p> : calculando && !calc ? <Carregando /> : calc && (
          <section className="resumo" aria-label="Rota e valor" aria-live="polite">
            <dl className="resumo__grade">
              <div className="resumo__item"><dt>Percurso</dt><dd className="resumo__numero">{String(calc.distanciaKm).replace(".", ",")} km</dd><dd className="texto-fraco">{calc.fonte === "OPENROUTESERVICE" ? "pelas ruas (OpenRouteService)" : "estimativa (sem chave do mapa)"}</dd></div>
              <div className="resumo__item"><dt>Deslocamento</dt><dd className="resumo__numero">{horasTexto(calc.duracaoMin)}</dd></div>
              <div className="resumo__item"><dt>Carga horária</dt><dd className="resumo__numero">{horasTexto(calc.cargaHorariaMin)}</dd><dd className="texto-fraco">deslocamento + paradas + folga</dd></div>
              <div className="resumo__item"><dt>Valor pela tabela</dt><dd className="resumo__numero">{formatarMoeda(calc.preco.totalCentavos)}</dd>
                <dd className="texto-fraco">{calc.preco.aplicouMinimo ? "valor mínimo do veículo" : `${formatarMoeda(calc.preco.porKmCentavos)} km + ${formatarMoeda(calc.preco.porHoraCentavos)} (${String(calc.preco.horasCobradas).replace(".", ",")} h)`}</dd>
              </div>
            </dl>
          </section>
        )}
        <div className="grade-campos">
          <div className="campo"><label htmlFor="or-folga">Folga (min)</label><input id="or-folga" type="number" min={0} max={600} value={f.folgaMin} onChange={(e) => mudar("folgaMin", e.target.value)} /></div>
          <div className="campo"><label htmlFor="or-valor">Valor final (R$)</label><input id="or-valor" inputMode="decimal" value={f.valorFinal} onChange={(e) => mudar("valorFinal", e.target.value)} placeholder={calc ? textoDeCentavos(calc.preco.totalCentavos) : "pela tabela"} /></div>
          <div className="campo"><label htmlFor="or-validade">Validade (dias)</label><input id="or-validade" type="number" min={1} max={120} value={f.validadeDias} onChange={(e) => mudar("validadeDias", e.target.value)} /></div>
        </div>
        {total != null && <p><strong>Total do orçamento: {formatarMoeda(total)}</strong>{pessoas > 0 && ` · ${formatarMoeda(Math.round(total / pessoas))} por pessoa`}{valorFinal != null && " (ajustado à mão)"}</p>}
        <div className="campo campo--largo"><label htmlFor="or-obs">Observações (saem no PDF)</label><textarea id="or-obs" rows={4} value={f.observacoes} onChange={(e) => mudar("observacoes", e.target.value)} /></div>
        <div className="barra-acoes"><button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : novo ? "Criar orçamento" : "Salvar"}</button></div>
      </form>
    </div>
  );
}
