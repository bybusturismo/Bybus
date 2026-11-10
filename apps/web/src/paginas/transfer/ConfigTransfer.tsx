import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import type { Passeio } from "../../api/tipos";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import type { ConfigPasseioTransfer } from "./tipos";
import "./transfer.css";

type Bairro = ConfigPasseioTransfer["bairros"][number];

/** Bairros de transfer (ordem de busca e horário de referência), taxa única por passageiro e padrões da van, por passeio. */
export function ConfigTransfer({ passeio }: { passeio: Passeio }) {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const editar = pode("transfer:gerenciar");
  const carga = useCarregar((s) => api.get<ConfigPasseioTransfer>(`/api/passeios/${passeio.id}/transfer`, s), [passeio.id]);
  const [cfg, setCfg] = useState<ConfigPasseioTransfer["config"] | null>(null);
  const [taxa, setTaxa] = useState("");
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!carga.dados) return;
    setCfg(carga.dados.config);
    setTaxa(textoDeCentavos(carga.dados.config.taxaPorPassageiroCentavos));
    setBairros(carga.dados.bairros.filter((b) => b.ativo));
  }, [carga.dados]);

  if (carga.carregando && !carga.dados) return <Carregando />;
  if (carga.erro) return <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} />;
  const d = carga.dados!;
  if (!cfg) return null;
  const muda = (i: number, p: Partial<Bairro>) => setBairros((l) => l.map((b, k) => (k === i ? { ...b, ...p } : b)));
  const mover = (i: number, delta: number) => setBairros((l) => {
    const j = i + delta;
    if (j < 0 || j >= l.length) return l;
    const c = [...l];
    [c[i], c[j]] = [c[j]!, c[i]!];
    return c;
  });

  async function salvar() {
    setErro(null);
    const c = centavosDeTexto(taxa);
    if (c === null || c < 0) return setErro("Taxa por passageiro inválida. Use, por exemplo, 40,00.");
    if (bairros.some((b) => b.nome.trim().length < 2)) return setErro("Dê um nome a todos os bairros.");
    setSalvando(true);
    try {
      await api.put(`/api/passeios/${passeio.id}/transfer`, {
        config: { ...cfg, taxaPorPassageiroCentavos: c, intervaloMinutos: Number(cfg!.intervaloMinutos) || 0 },
        bairros: bairros.map((b) => ({ id: b.id, nome: b.nome.trim(), horarioReferencia: b.horarioReferencia || null, horarioAConfirmar: b.horarioAConfirmar || !b.horarioReferencia, pontoEmbarqueId: b.pontoEmbarqueId || null, ativo: true })),
      });
      notificar("Configuração do transfer salva.");
      await carga.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="cartao transfer__config" aria-label="Transfer">
      <h3>Transfer (van que busca no hotel)</h3>
      <Aviso tipo="info">A taxa é única por passageiro, igual em todos os bairros (valor entre R$ 35 e R$ 45, a confirmar). A ordem de busca vai do bairro mais longe do centro para o mais perto.</Aviso>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="filtros">
        <div className="campo"><label htmlFor="cfg-taxa">Taxa por passageiro (R$)</label><input id="cfg-taxa" inputMode="decimal" disabled={!editar} value={taxa} onChange={(e) => setTaxa(e.target.value)} /></div>
        <label className="campo--caixa"><input type="checkbox" disabled={!editar} checked={cfg.taxaAConfirmar} onChange={(e) => setCfg({ ...cfg, taxaAConfirmar: e.target.checked })} /> valor ainda a confirmar</label>
        <div className="campo"><label htmlFor="cfg-intervalo">Minutos entre paradas do mesmo bairro</label><input id="cfg-intervalo" inputMode="numeric" disabled={!editar} value={cfg.intervaloMinutos} onChange={(e) => setCfg({ ...cfg, intervaloMinutos: Number(e.target.value.replace(/\D/g, "")) })} /></div>
        <div className="campo"><label htmlFor="cfg-ponto">Ponto de encontro com o ônibus</label>
          <select id="cfg-ponto" disabled={!editar} value={cfg.pontoEncontroId ?? ""} onChange={(e) => setCfg({ ...cfg, pontoEncontroId: e.target.value || null })}>
            <option value="">A definir</option>
            {d.pontos.filter((p) => !p.ehTransfer).map((p) => <option key={p.id} value={p.id}>{p.horario} — {p.nome}</option>)}
          </select></div>
        <div className="campo"><label htmlFor="cfg-chegada">Chegada prevista da van</label><input id="cfg-chegada" type="time" disabled={!editar} value={cfg.chegadaPrevista ?? ""} onChange={(e) => setCfg({ ...cfg, chegadaPrevista: e.target.value || null })} /></div>
        <div className="campo"><label htmlFor="cfg-motorista">Motorista padrão do transfer</label>
          <select id="cfg-motorista" disabled={!editar} value={cfg.motoristaPadraoId ?? ""} onChange={(e) => setCfg({ ...cfg, motoristaPadraoId: e.target.value || null })}>
            <option value="">Sem motorista fixo</option>
            {d.motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select></div>
        <div className="campo"><label htmlFor="cfg-veiculo">Van padrão (frota)</label>
          <select id="cfg-veiculo" disabled={!editar} value={cfg.veiculoPadraoId ?? ""} onChange={(e) => setCfg({ ...cfg, veiculoPadraoId: e.target.value || null })}>
            <option value="">Outra (digitar)</option>
            {d.veiculos.map((v) => <option key={v.id} value={v.id}>{v.apelido ? `${v.apelido} (${v.placa})` : v.placa}</option>)}
          </select></div>
        {!cfg.veiculoPadraoId && <div className="campo"><label htmlFor="cfg-veic-texto">Placa ou descrição da van</label><input id="cfg-veic-texto" disabled={!editar} maxLength={60} value={cfg.veiculoPadraoTexto ?? ""} onChange={(e) => setCfg({ ...cfg, veiculoPadraoTexto: e.target.value || null })} /></div>}
        <div className="campo"><label htmlFor="cfg-lugares">Lugares na van</label><input id="cfg-lugares" inputMode="numeric" disabled={!editar} value={cfg.lugaresPadrao ?? ""} onChange={(e) => setCfg({ ...cfg, lugaresPadrao: e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null })} /></div>
      </div>
      <p className="campo__ajuda">O motorista, a van e o ponto de encontro padrão valem para cada novo dia de transfer; dá para ajustar em cada dia na tela Transfer.</p>
      <div className="tabela-rolagem">
        <table className="tabela tabela--compacta">
          <caption className="visualmente-oculto">Bairros do transfer em ordem de busca</caption>
          <thead><tr><th>Busca</th><th>Bairro</th><th>Horário de referência</th><th>Ponto de transfer (Paytour)</th>{editar && <th>Ordem</th>}</tr></thead>
          <tbody>
            {bairros.map((b, i) => (
              <tr key={b.id ?? `novo-${i}`}>
                <td>{i + 1}º</td>
                <td><input aria-label={`Nome do bairro ${i + 1}`} disabled={!editar} value={b.nome} maxLength={80} onChange={(e) => muda(i, { nome: e.target.value })} /></td>
                <td>
                  <input aria-label={`Horário de ${b.nome || `bairro ${i + 1}`}`} type="time" disabled={!editar} value={b.horarioReferencia ?? ""} onChange={(e) => muda(i, { horarioReferencia: e.target.value || null })} />
                  <label className="campo--caixa"><input type="checkbox" disabled={!editar} checked={b.horarioAConfirmar || !b.horarioReferencia} onChange={(e) => muda(i, { horarioAConfirmar: e.target.checked })} /> a confirmar</label>
                </td>
                <td>
                  <select aria-label={`Ponto de transfer de ${b.nome || `bairro ${i + 1}`}`} disabled={!editar} value={b.pontoEmbarqueId ?? ""} onChange={(e) => muda(i, { pontoEmbarqueId: e.target.value || null })}>
                    <option value="">Nenhum</option>
                    {d.pontos.filter((p) => p.ehTransfer).map((p) => <option key={p.id} value={p.id}>{p.horario} — {p.nome}</option>)}
                  </select>
                </td>
                {editar && (
                  <td className="sem-quebra">
                    <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Subir ${b.nome}`} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                    <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Descer ${b.nome}`} disabled={i === bairros.length - 1} onClick={() => mover(i, 1)}>↓</button>
                    <button type="button" className="botao botao--fantasma botao--pequeno" aria-label={`Remover ${b.nome}`} onClick={() => setBairros((l) => l.filter((_, k) => k !== i))}>Remover</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editar && (
        <div className="barra-acoes">
          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setBairros((l) => [...l, { nome: "", ordemBusca: l.length + 1, horarioReferencia: null, horarioAConfirmar: true, pontoEmbarqueId: null, ativo: true }])}>Adicionar bairro</button>
          <button type="button" className="botao botao--primario botao--pequeno" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar transfer"}</button>
        </div>
      )}
    </section>
  );
}
