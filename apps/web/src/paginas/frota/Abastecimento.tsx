import { useMemo, useState } from "react";
import { ROTULO_TIPO_ABASTECIMENTO, TIPOS_ABASTECIMENTO, type TipoAbastecimento } from "@bybus/core";
import { aplicarColunas, CabecalhoFiltro, VAZIO, type DefinicaoColuna, type EstadoColunas } from "../../componentes/FiltroColuna";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, somarDias } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, FormModal, formatarKm, numeroDeTexto, SeletorVeiculo, useVeiculos } from "./comum";
import type { Abastecimento, ResumoAbastecimento, Veiculo } from "./tipos";

interface Resposta {
  itens: Abastecimento[];
  resumo: ResumoAbastecimento[];
}

const dec = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Filtro e classificação por coluna, como no Excel (dono, 13/11/2026). */
type ColunaAbast = "data" | "veiculo" | "servico" | "km" | "litros" | "valor" | "kml" | "posto";
const COLUNAS_ABAST: Record<ColunaAbast, DefinicaoColuna<Abastecimento>> = {
  data: { valor: (a) => formatarData(a.data), ordenar: (a) => a.data },
  veiculo: { valor: (a) => a.placa },
  servico: { valor: (a) => ROTULO_TIPO_ABASTECIMENTO[a.tipo ?? "COMBUSTIVEL"] },
  km: { valor: (a) => formatarKm(a.km), ordenar: (a) => a.km },
  litros: { valor: (a) => dec(a.litros), ordenar: (a) => a.litros },
  valor: { valor: (a) => formatarMoeda(a.valorCentavos), ordenar: (a) => a.valorCentavos },
  kml: { valor: (a) => (a.kml == null ? VAZIO : `${dec(a.kml)}${a.alerta ? (a.alerta === "ALTO" ? " · gasto alto" : " · conferir") : ""}`), ordenar: (a) => a.kml ?? -1 },
  posto: { valor: (a) => a.posto ?? VAZIO },
};
const NUMERO = { asc: "Do menor para o maior", desc: "Do maior para o menor" };

function FormAbastecimento({ veiculos, aoFechar, aoSalvo }: { veiculos: Veiculo[]; aoFechar: () => void; aoSalvo: (a: Abastecimento) => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(veiculos[0]?.id ?? "");
  const [data, setData] = useState(hojeIso());
  const [km, setKm] = useState("");
  const [litros, setLitros] = useState("");
  const [valor, setValor] = useState("");
  const [posto, setPosto] = useState("");
  const [cheio, setCheio] = useState(true);
  const [tipo, setTipo] = useState<TipoAbastecimento>("COMBUSTIVEL");
  const combustivel = tipo === "COMBUSTIVEL";
  const atual = veiculos.find((v) => v.id === veiculoId);
  async function enviar() {
    const k = numeroDeTexto(km);
    const l = numeroDeTexto(litros, true);
    const v = centavosDeTexto(valor);
    if (!veiculoId) throw new Error("Escolha o veículo.");
    if (k == null || Number.isNaN(k)) throw new Error("Informe o km do hodômetro.");
    if (l == null || Number.isNaN(l) || l <= 0) throw new Error(combustivel ? "Informe os litros abastecidos (ex.: 45,5)." : "Informe a quantidade em litros (ex.: 5).");
    if (v == null || Number.isNaN(v)) throw new Error("Informe o valor total em reais (ex.: 1.234,56).");
    const salvo = await api.post<Abastecimento>("/api/frota/abastecimentos", { veiculoId, data, km: k, litros: l, valorCentavos: v, posto: posto.trim() || null, tanqueCheio: combustivel ? cheio : false, tipo });
    await aoSalvo(salvo);
  }
  return (
    <FormModal titulo="Novo abastecimento" aoFechar={aoFechar} aoEnviar={enviar}>
      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="fa-tipo">Serviço</label>
          <select id="fa-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoAbastecimento)}>
            {TIPOS_ABASTECIMENTO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_ABASTECIMENTO[t]}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="fa-veiculo">Veículo</label><SeletorVeiculo id="fa-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} /></div>
        <div className="campo"><label htmlFor="fa-data">Data</label><input id="fa-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo">
          <label htmlFor="fa-km">Km do hodômetro</label>
          <input id="fa-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} />
          {atual && <span className="campo__ajuda">Km atual: {formatarKm(atual.kmAtual)}. Pode repetir o km de outro lançamento do mesmo cupom.</span>}
        </div>
        <div className="campo"><label htmlFor="fa-litros">{combustivel ? "Litros" : "Quantidade (litros)"}</label><input id="fa-litros" inputMode="decimal" value={litros} onChange={(e) => setLitros(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fa-valor">Valor total (R$)</label><input id="fa-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><label htmlFor="fa-posto">Posto</label><input id="fa-posto" value={posto} maxLength={120} onChange={(e) => setPosto(e.target.value)} /></div>
      </div>
      {combustivel && <label className="interruptor"><input type="checkbox" checked={cheio} onChange={(e) => setCheio(e.target.checked)} /> Completou o tanque (necessário para calcular km/l)</label>}
      {combustivel && <p className="texto-fraco">Cupom com duas linhas de combustível? Lance cada linha com o mesmo km: o km/l soma os litros.</p>}
    </FormModal>
  );
}

export function AbastecimentoPagina() {
  const { pode } = useSessao();
  const podeEditar = pode("frota:gerenciar");
  const notificar = useNotificar();
  const veiculos = useVeiculos();
  const [veiculoId, setVeiculoId] = useState("");
  const [de, setDe] = useState(somarDias(hojeIso(), -90));
  const [ate, setAte] = useState(hojeIso());
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const dados = useCarregar((sinal) => api.get<Resposta>(`/api/frota/abastecimentos${qs({ veiculoId, de, ate })}`, sinal), [veiculoId, de, ate]);
  const r = dados.dados;
  const [colunas, setColunas] = useState<EstadoColunas<ColunaAbast>>({ ordem: null, selecionados: {} });
  const visiveis = useMemo(() => (r ? aplicarColunas(r.itens, COLUNAS_ABAST, colunas) : []), [r, colunas]);
  const filtrando = Object.keys(colunas.selecionados).length > 0;

  async function excluir(a: Abastecimento) {
    if (!window.confirm(`Excluir o abastecimento de ${formatarData(a.data)} de ${a.placa}?`)) return;
    try {
      await api.delete(`/api/frota/abastecimentos/${a.id}`);
      notificar("Abastecimento excluído.");
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Abastecimento"
        descricao="Litros, valor e km de cada abastecimento. O km/l é calculado entre tanques cheios e o consumo fora da média gera alerta."
        acoes={podeEditar && <button type="button" className="botao botao--primario" onClick={() => setNovo(true)} disabled={!veiculos.dados?.length}><Icone nome="mais" /> Novo abastecimento</button>}
      />
      <div className="filtros">
        <div className="campo campo--linha"><label htmlFor="fab-veiculo">Veículo</label><SeletorVeiculo id="fab-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos.dados ?? []} vazio="Todos" /></div>
        <div className="campo campo--linha"><label htmlFor="fab-de">De</label><input id="fab-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div className="campo campo--linha"><label htmlFor="fab-ate">Até</label><input id="fab-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="atencao" titulo="Consumo fora da média">{aviso}</Aviso>}
      {dados.carregando && !r ? <Carregando /> : dados.erro ? <ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /> : r && (
        <>
          {r.resumo.length > 0 && (
            <section className="cartao" aria-labelledby="fab-resumo">
              <h2 id="fab-resumo">Resumo do período</h2>
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th>Veículo</th><th className="frota-numero">Litros</th><th className="frota-numero">Gasto</th><th className="frota-numero">Média km/l</th><th>Alertas</th></tr></thead>
                  <tbody>
                    {r.resumo.map((x) => (
                      <tr key={x.veiculoId}>
                        <td><strong>{x.placa}</strong>{x.apelido && <> · {x.apelido}</>}</td>
                        <td className="frota-numero">{dec(x.litros)}</td>
                        <td className="frota-numero">{formatarMoeda(x.valorCentavos)}</td>
                        <td className="frota-numero">{x.mediaKml == null ? "—" : dec(x.mediaKml)}</td>
                        <td>{x.alertas ? <span className="etiqueta etiqueta--atencao">{x.alertas} fora da média</span> : <span className="texto-fraco">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {r.itens.length === 0 ? <Vazio titulo="Nenhum abastecimento no período." /> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <caption className="visualmente-oculto">Abastecimentos</caption>
                <thead><tr>
                  <CabecalhoFiltro coluna="data" rotulo="Data" linhas={r.itens} definicao={COLUNAS_ABAST.data} estado={colunas} mudar={setColunas} textos={{ asc: "Mais antigo primeiro", desc: "Mais recente primeiro" }} />
                  <CabecalhoFiltro coluna="veiculo" rotulo="Veículo" linhas={r.itens} definicao={COLUNAS_ABAST.veiculo} estado={colunas} mudar={setColunas} />
                  <CabecalhoFiltro coluna="servico" rotulo="Serviço" linhas={r.itens} definicao={COLUNAS_ABAST.servico} estado={colunas} mudar={setColunas} />
                  <CabecalhoFiltro coluna="km" rotulo="Km" linhas={r.itens} definicao={COLUNAS_ABAST.km} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="litros" rotulo="Litros" linhas={r.itens} definicao={COLUNAS_ABAST.litros} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="valor" rotulo="Valor" linhas={r.itens} definicao={COLUNAS_ABAST.valor} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="kml" rotulo="km/l" linhas={r.itens} definicao={COLUNAS_ABAST.kml} estado={colunas} mudar={setColunas} className="frota-numero" textos={NUMERO} />
                  <CabecalhoFiltro coluna="posto" rotulo="Posto" linhas={r.itens} definicao={COLUNAS_ABAST.posto} estado={colunas} mudar={setColunas} />
                  {podeEditar && <th><span className="visualmente-oculto">Ações</span></th>}
                </tr></thead>
                <tbody>
                  {visiveis.map((a) => (
                    <tr key={a.id}>
                      <td className="sem-quebra">{formatarData(a.data)}</td>
                      <td><strong>{a.placa}</strong></td>
                      <td>{a.tipo && a.tipo !== "COMBUSTIVEL" ? <span className="etiqueta etiqueta--neutra">{ROTULO_TIPO_ABASTECIMENTO[a.tipo]}</span> : ROTULO_TIPO_ABASTECIMENTO.COMBUSTIVEL}</td>
                      <td className="frota-numero">{formatarKm(a.km)}</td>
                      <td className="frota-numero">{dec(a.litros)}{!a.tanqueCheio && <span className="texto-fraco"> (parcial)</span>}</td>
                      <td className="frota-numero">{formatarMoeda(a.valorCentavos)}</td>
                      <td className="frota-numero">
                        {a.kml == null ? "—" : dec(a.kml)}
                        {a.alerta && <> <span className={`etiqueta ${a.alerta === "ALTO" ? "etiqueta--perigo" : "etiqueta--atencao"}`}>{a.alerta === "ALTO" ? "Gasto alto" : "Conferir"}</span></>}
                      </td>
                      <td>{a.posto ?? <span className="texto-fraco">—</span>}</td>
                      {podeEditar && <td><button type="button" className="botao botao--perigo botao--pequeno" onClick={() => void excluir(a)} aria-label={`Excluir abastecimento de ${formatarData(a.data)} de ${a.placa}`}>Excluir</button></td>}
                    </tr>
                  ))}
                </tbody>
                {filtrando && (
                  <tfoot>
                    <tr className="fin-total">
                      <td colSpan={4}>{visiveis.length} de {r.itens.length} abastecimento(s) no filtro das colunas</td>
                      <td className="frota-numero">{dec(visiveis.reduce((t, a) => t + a.litros, 0))}</td>
                      <td className="frota-numero">{formatarMoeda(visiveis.reduce((t, a) => t + a.valorCentavos, 0))}</td>
                      <td colSpan={podeEditar ? 3 : 2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}
      {novo && veiculos.dados && (
        <FormAbastecimento
          veiculos={veiculos.dados.filter((v) => v.situacao !== "INATIVO")}
          aoFechar={() => setNovo(false)}
          aoSalvo={async (a) => {
            notificar("Abastecimento lançado.");
            if (a.alerta) setAviso(`${a.placa}: ${a.kml?.toLocaleString("pt-BR")} km/l ${a.alerta === "ALTO" ? "(consumo acima do normal do veículo)" : "(muito melhor que a média: confira km e litros)"}.`);
            await Promise.all([dados.recarregar(), veiculos.recarregar()]);
          }}
        />
      )}
    </div>
  );
}
