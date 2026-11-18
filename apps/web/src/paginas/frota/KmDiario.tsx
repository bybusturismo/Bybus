import { useEffect, useMemo, useState } from "react";
import { api, ErroApi, mensagemDeErro, qs } from "../../api/cliente";
import { aplicarColunas, CabecalhoFiltro, VAZIO, type DefinicaoColuna, type EstadoColunas } from "../../componentes/FiltroColuna";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, hojeIso, somarDias } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, FormModal, formatarKm, numeroDeTexto, SeletorVeiculo } from "./comum";
import type { VeiculoChecklist } from "./tipos";

/** Diário de km (dono, 18/11/2026): DATA › PLACA › KM INICIAL › KM FINAL › CONSUMO. */
export interface RegistroKmDiario {
  id: string;
  veiculoId: string;
  placa: string;
  apelido: string | null;
  data: string;
  kmInicial: number;
  kmFinal: number;
  consumoLitros: number | null;
  observacao: string | null;
  lancadoPor: string | null;
  kmRodado: number;
  kml: number | null;
  diferencaAnterior: number | null;
}
interface ResumoKmDiario { veiculoId: string; placa: string; apelido: string | null; dias: number; kmRodado: number; litros: number; mediaKml: number | null }
interface Resposta { itens: RegistroKmDiario[]; resumo: ResumoKmDiario[] }

const dec = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const km = (n: number) => new Intl.NumberFormat("pt-BR").format(n);

type Coluna = "data" | "placa" | "kmInicial" | "kmFinal" | "kmRodado" | "consumo" | "kml";
const COLUNAS: Record<Coluna, DefinicaoColuna<RegistroKmDiario>> = {
  data: { valor: (r) => formatarData(r.data), ordenar: (r) => r.data },
  placa: { valor: (r) => r.placa },
  kmInicial: { valor: (r) => km(r.kmInicial), ordenar: (r) => r.kmInicial },
  kmFinal: { valor: (r) => km(r.kmFinal), ordenar: (r) => r.kmFinal },
  kmRodado: { valor: (r) => km(r.kmRodado), ordenar: (r) => r.kmRodado },
  consumo: { valor: (r) => (r.consumoLitros == null ? VAZIO : dec(r.consumoLitros)), ordenar: (r) => r.consumoLitros ?? -1 },
  kml: { valor: (r) => (r.kml == null ? VAZIO : dec(r.kml)), ordenar: (r) => r.kml ?? -1 },
};
const NUMERO = { asc: "Do menor para o maior", desc: "Do maior para o menor" };

/** Aviso da sequência com o registro anterior do mesmo veículo. */
function Sequencia({ dif }: { dif: number | null }) {
  if (dif == null || dif === 0) return null;
  return dif > 0
    ? <span className="etiqueta etiqueta--atencao" title="O km inicial deste dia é maior que o km final do registro anterior: algum trecho ficou sem registro.">{km(dif)} km sem registro antes</span>
    : <span className="etiqueta etiqueta--perigo" title="O km inicial deste dia é menor que o km final do registro anterior: confira a digitação.">km inicial {km(-dif)} abaixo do dia anterior</span>;
}

function FormKmDiario({ veiculos, registro, aoFechar, aoSalvo }: { veiculos: VeiculoChecklist[]; registro: RegistroKmDiario | null; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(registro?.veiculoId ?? veiculos[0]?.id ?? "");
  const [data, setData] = useState(registro?.data ?? hojeIso());
  const [kmInicial, setKmInicial] = useState(registro ? km(registro.kmInicial) : "");
  const [kmFinal, setKmFinal] = useState(registro ? km(registro.kmFinal) : "");
  const [consumo, setConsumo] = useState(registro?.consumoLitros == null ? "" : String(registro.consumoLitros).replace(".", ","));
  const [observacao, setObservacao] = useState(registro?.observacao ?? "");
  const [sugestao, setSugestao] = useState<{ kmInicial: number; origem: string; jaRegistrado: boolean } | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  // Conta nova: o km inicial vem do km final do dia anterior (ou do km atual do veículo); a pessoa pode mudar.
  useEffect(() => {
    if (registro || !veiculoId || !data) return;
    let vivo = true;
    api.get<{ kmInicial: number; origem: string; jaRegistrado: boolean }>(`/api/frota/km-diario/sugestao${qs({ veiculoId, data })}`)
      .then((s) => { if (!vivo) return; setSugestao(s); setKmInicial(km(s.kmInicial)); })
      .catch(() => { if (vivo) setSugestao(null); });
    return () => { vivo = false; };
  }, [registro, veiculoId, data]);
  useEffect(() => setConfirmar(false), [veiculoId, data, kmInicial, kmFinal]);

  const ini = numeroDeTexto(kmInicial);
  const fim = numeroDeTexto(kmFinal);
  const lit = numeroDeTexto(consumo, true);
  const rodado = ini != null && fim != null && !Number.isNaN(ini) && !Number.isNaN(fim) && fim >= ini ? fim - ini : null;
  const kml = rodado && lit && !Number.isNaN(lit) && lit > 0 ? rodado / lit : null;

  async function enviar() {
    if (!veiculoId) throw new Error("Escolha a placa.");
    if (ini == null || Number.isNaN(ini)) throw new Error("Informe o km inicial (só números, ex.: 10.250).");
    if (fim == null || Number.isNaN(fim)) throw new Error("Informe o km final (só números, ex.: 10.480).");
    if (fim < ini) throw new Error("O km final não pode ser menor que o km inicial.");
    if (lit != null && (Number.isNaN(lit) || lit < 0)) throw new Error("Consumo em litros: use números, ex.: 45,5.");
    const corpo = { data, kmInicial: ini, kmFinal: fim, consumoLitros: lit, observacao: observacao.trim() || null, ...(confirmar ? { confirmarRecuo: true } : {}) };
    try {
      if (registro) await api.patch(`/api/frota/km-diario/${registro.id}`, corpo);
      else await api.post("/api/frota/km-diario", { ...corpo, veiculoId });
    } catch (x) {
      if (x instanceof ErroApi && x.codigo === "KM_FORA_DE_SEQUENCIA") {
        setConfirmar(true);
        throw new Error(`${x.message} Se estiver certo, clique em "Confirmar e salvar".`);
      }
      throw x;
    }
    await aoSalvo();
  }

  return (
    <FormModal titulo={registro ? `Corrigir km de ${formatarData(registro.data)} · ${registro.placa}` : "Lançar km do dia"} aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar={confirmar ? "Confirmar e salvar" : "Salvar"}>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="kd-data">Data</label><input id="kd-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo"><label htmlFor="kd-placa">Placa</label><SeletorVeiculo id="kd-placa" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} desabilitado={!!registro} /></div>
        <div className="campo">
          <label htmlFor="kd-inicial">Km inicial</label>
          <input id="kd-inicial" inputMode="numeric" value={kmInicial} onChange={(e) => setKmInicial(e.target.value)} />
          {!registro && sugestao && <span className="campo__ajuda">Sugerido: {sugestao.origem} ({formatarKm(sugestao.kmInicial)}).</span>}
        </div>
        <div className="campo"><label htmlFor="kd-final">Km final</label><input id="kd-final" inputMode="numeric" value={kmFinal} onChange={(e) => setKmFinal(e.target.value)} /></div>
        <div className="campo">
          <label htmlFor="kd-consumo">Consumo (litros)</label>
          <input id="kd-consumo" inputMode="decimal" value={consumo} placeholder="opcional" onChange={(e) => setConsumo(e.target.value)} />
          <span className="campo__ajuda">Litros gastos no dia. Com ele, o sistema calcula o km/l.</span>
        </div>
        <div className="campo"><label htmlFor="kd-obs">Observação</label><input id="kd-obs" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} placeholder="opcional" /></div>
      </div>
      {!registro && sugestao?.jaRegistrado && <Aviso tipo="atencao">Esta placa já tem registro nesta data. Para mudar, use "Corrigir" na lista.</Aviso>}
      <p aria-live="polite">Km rodado: <strong>{rodado == null ? "—" : formatarKm(rodado)}</strong>{kml != null && <> · <strong>{dec(kml)} km/l</strong></>}</p>
    </FormModal>
  );
}

export function KmDiarioPagina() {
  const { pode } = useSessao();
  const podeLancar = pode("frota:gerenciar") || pode("frota:checklist");
  const podeCorrigir = pode("frota:gerenciar");
  const notificar = useNotificar();
  const veiculos = useCarregar((sinal) => api.get<VeiculoChecklist[]>("/api/frota/checklist/veiculos", sinal), []);
  const [veiculoId, setVeiculoId] = useState("");
  const [de, setDe] = useState(somarDias(hojeIso(), -30));
  const [ate, setAte] = useState(hojeIso());
  const [form, setForm] = useState<RegistroKmDiario | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const dados = useCarregar((sinal) => api.get<Resposta>(`/api/frota/km-diario${qs({ veiculoId, de, ate })}`, sinal), [veiculoId, de, ate]);
  const r = dados.dados;
  const [colunas, setColunas] = useState<EstadoColunas<Coluna>>({ ordem: null, selecionados: {} });
  const visiveis = useMemo(() => (r ? aplicarColunas(r.itens, COLUNAS, colunas) : []), [r, colunas]);
  const filtrando = Object.keys(colunas.selecionados).length > 0;

  async function excluir(x: RegistroKmDiario) {
    if (!window.confirm(`Excluir o km de ${formatarData(x.data)} de ${x.placa}?`)) return;
    setErro(null);
    try {
      await api.delete(`/api/frota/km-diario/${x.id}`);
      notificar("Registro excluído.");
      await dados.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Diário de km"
        descricao="Km inicial, km final e consumo de cada veículo por dia. O km final atualiza o km do veículo e os planos de manutenção."
        acoes={podeLancar && <button type="button" className="botao botao--primario" onClick={() => setForm("novo")} disabled={!veiculos.dados?.length}><Icone nome="mais" /> Lançar km do dia</button>}
      />
      <div className="filtros">
        <div className="campo campo--linha"><label htmlFor="kdf-veiculo">Placa</label><SeletorVeiculo id="kdf-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos.dados ?? []} vazio="Todas" /></div>
        <div className="campo campo--linha"><label htmlFor="kdf-de">De</label><input id="kdf-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div className="campo campo--linha"><label htmlFor="kdf-ate">Até</label><input id="kdf-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.carregando && !r ? <Carregando /> : dados.erro ? <ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /> : r && (
        <>
          {r.resumo.length > 0 && (
            <section className="cartao" aria-labelledby="kd-resumo">
              <h2 id="kd-resumo">Resumo do período</h2>
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th>Placa</th><th className="frota-numero">Dias</th><th className="frota-numero">Km rodado</th><th className="frota-numero">Consumo (L)</th><th className="frota-numero">Média km/l</th></tr></thead>
                  <tbody>
                    {r.resumo.map((x) => (
                      <tr key={x.veiculoId}>
                        <td><strong>{x.placa}</strong>{x.apelido && <> · {x.apelido}</>}</td>
                        <td className="frota-numero">{x.dias}</td>
                        <td className="frota-numero">{formatarKm(x.kmRodado)}</td>
                        <td className="frota-numero">{x.litros ? dec(x.litros) : "—"}</td>
                        <td className="frota-numero">{x.mediaKml == null ? "—" : dec(x.mediaKml)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {r.itens.length === 0 ? <Vazio titulo="Nenhum km lançado no período." /> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <caption className="visualmente-oculto">Diário de km</caption>
                <thead><tr>
                  <CabecalhoFiltro coluna="data" rotulo="Data" linhas={r.itens} definicao={COLUNAS.data} estado={colunas} mudar={setColunas} textos={{ asc: "Mais antigo primeiro", desc: "Mais recente primeiro" }} />
                  <CabecalhoFiltro coluna="placa" rotulo="Placa" linhas={r.itens} definicao={COLUNAS.placa} estado={colunas} mudar={setColunas} />
                  <CabecalhoFiltro coluna="kmInicial" rotulo="Km inicial" linhas={r.itens} definicao={COLUNAS.kmInicial} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="kmFinal" rotulo="Km final" linhas={r.itens} definicao={COLUNAS.kmFinal} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="kmRodado" rotulo="Km rodado" linhas={r.itens} definicao={COLUNAS.kmRodado} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="consumo" rotulo="Consumo (L)" linhas={r.itens} definicao={COLUNAS.consumo} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="kml" rotulo="km/l" linhas={r.itens} definicao={COLUNAS.kml} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  {podeCorrigir && <th><span className="visualmente-oculto">Ações</span></th>}
                </tr></thead>
                <tbody>
                  {visiveis.map((x) => (
                    <tr key={x.id}>
                      <td className="sem-quebra">{formatarData(x.data)}</td>
                      <td>
                        <strong>{x.placa}</strong>
                        <div><Sequencia dif={x.diferencaAnterior} /></div>
                        {x.observacao && <div className="texto-fraco">{x.observacao}</div>}
                        {x.lancadoPor && <div className="texto-fraco">por {x.lancadoPor}</div>}
                      </td>
                      <td className="frota-numero">{km(x.kmInicial)}</td>
                      <td className="frota-numero">{km(x.kmFinal)}</td>
                      <td className="frota-numero"><strong>{km(x.kmRodado)}</strong></td>
                      <td className="frota-numero">{x.consumoLitros == null ? "—" : dec(x.consumoLitros)}</td>
                      <td className="frota-numero">{x.kml == null ? "—" : dec(x.kml)}</td>
                      {podeCorrigir && (
                        <td className="sem-quebra">
                          <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setForm(x)} aria-label={`Corrigir km de ${formatarData(x.data)} de ${x.placa}`}>Corrigir</button>{" "}
                          <button type="button" className="botao botao--perigo botao--pequeno" onClick={() => void excluir(x)} aria-label={`Excluir km de ${formatarData(x.data)} de ${x.placa}`}>Excluir</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                {filtrando && (
                  <tfoot>
                    <tr className="fin-total">
                      <td colSpan={4}>{visiveis.length} de {r.itens.length} registro(s) no filtro das colunas</td>
                      <td className="frota-numero">{km(visiveis.reduce((t, x) => t + x.kmRodado, 0))}</td>
                      <td className="frota-numero">{dec(visiveis.reduce((t, x) => t + (x.consumoLitros ?? 0), 0))}</td>
                      <td colSpan={podeCorrigir ? 2 : 1} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
      {form && veiculos.dados && (
        <FormKmDiario
          veiculos={veiculos.dados}
          registro={form === "novo" ? null : form}
          aoFechar={() => setForm(null)}
          aoSalvo={async () => {
            notificar(form === "novo" ? "Km do dia lançado." : "Registro corrigido.");
            await Promise.all([dados.recarregar(), veiculos.recarregar()]);
          }}
        />
      )}
    </div>
  );
}
