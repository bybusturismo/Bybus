import { useState } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, EtiquetaVencimento, FormModal, SeletorVeiculo, useVeiculos } from "./comum";
import { ROTULO_TIPO_DOC, TIPOS_DOC_VEICULO, type DocumentoVeiculo, type SituacaoVencimento, type TipoDocVeiculo, type Veiculo } from "./tipos";

function FormDocumento({ doc, veiculos, aoFechar, aoSalvo }: { doc: DocumentoVeiculo | null; veiculos: Veiculo[]; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(doc?.veiculoId ?? veiculos[0]?.id ?? "");
  const [tipo, setTipo] = useState<TipoDocVeiculo>(doc?.tipo ?? "CRLV");
  const [descricao, setDescricao] = useState(doc?.descricao ?? "");
  const [numero, setNumero] = useState(doc?.numero ?? "");
  const [vencimento, setVencimento] = useState(doc?.vencimento ?? "");
  const [observacao, setObservacao] = useState(doc?.observacao ?? "");
  async function enviar() {
    if (!veiculoId) throw new Error("Escolha o veículo.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) throw new Error("Informe a data de vencimento.");
    const corpo = { tipo, descricao: descricao.trim() || null, numero: numero.trim() || null, vencimento, observacao: observacao.trim() || null };
    if (doc) await api.patch(`/api/frota/documentos/${doc.id}`, corpo);
    else await api.post("/api/frota/documentos", { ...corpo, veiculoId });
    await aoSalvo();
  }
  return (
    <FormModal titulo={doc ? "Editar documento" : "Novo documento"} aoFechar={aoFechar} aoEnviar={enviar}>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="fd-veiculo">Veículo</label><SeletorVeiculo id="fd-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} desabilitado={!!doc} /></div>
        <div className="campo">
          <label htmlFor="fd-tipo">Tipo</label>
          <select id="fd-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocVeiculo)}>
            {TIPOS_DOC_VEICULO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_DOC[t]}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="fd-venc">Vencimento</label><input id="fd-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fd-numero">Número / apólice</label><input id="fd-numero" value={numero} maxLength={60} onChange={(e) => setNumero(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="fd-desc">Descrição</label><input id="fd-desc" value={descricao} maxLength={120} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Licença do City Tour de Florianópolis" /></div>
        <div className="campo campo--largo"><label htmlFor="fd-obs">Observação</label><input id="fd-obs" value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} /></div>
      </div>
    </FormModal>
  );
}

export function DocumentosPagina() {
  const { pode } = useSessao();
  const podeEditar = pode("frota:gerenciar");
  const notificar = useNotificar();
  const veiculos = useVeiculos();
  const [situacao, setSituacao] = useState<SituacaoVencimento | "">("");
  const [veiculoId, setVeiculoId] = useState("");
  const [editando, setEditando] = useState<DocumentoVeiculo | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const docs = useCarregar((sinal) => api.get<DocumentoVeiculo[]>(`/api/frota/documentos${qs({ situacao, veiculoId })}`, sinal), [situacao, veiculoId]);
  const lista = docs.dados ?? [];
  const vencidos = lista.filter((d) => d.situacao === "VENCIDO").length;

  async function excluir(d: DocumentoVeiculo) {
    if (!window.confirm(`Excluir ${d.descricao || ROTULO_TIPO_DOC[d.tipo]} de ${d.placa}?`)) return;
    try {
      await api.delete(`/api/frota/documentos/${d.id}`);
      notificar("Documento excluído.");
      await docs.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Documentos dos veículos"
        descricao="Alerta 30 dias antes do vencimento. Veículo com documento vencido fica bloqueado na escala."
        acoes={podeEditar && <button type="button" className="botao botao--primario" onClick={() => setEditando("novo")} disabled={!veiculos.dados?.length}><Icone nome="mais" /> Novo documento</button>}
      />
      <div className="filtros">
        <div className="campo campo--linha">
          <label htmlFor="fdoc-veiculo">Veículo</label>
          <SeletorVeiculo id="fdoc-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos.dados ?? []} vazio="Todos" />
        </div>
        <div className="campo campo--linha">
          <label htmlFor="fdoc-situacao">Situação</label>
          <select id="fdoc-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoVencimento | "")}>
            <option value="">Todas</option>
            <option value="VENCIDO">Vencidos</option>
            <option value="A_VENCER">A vencer em 30 dias</option>
            <option value="EM_DIA">Em dia</option>
          </select>
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {vencidos > 0 && <Aviso tipo="atencao" titulo="Documentos vencidos">{vencidos} documento(s) vencido(s): os veículos correspondentes estão bloqueados para escala.</Aviso>}
      {docs.carregando && !docs.dados ? <Carregando /> : docs.erro ? <ErroCarga mensagem={docs.erro} tentarDeNovo={docs.recarregar} /> : lista.length === 0 ? <Vazio titulo="Nenhum documento encontrado." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Documentos dos veículos</caption>
            <thead><tr><th>Veículo</th><th>Documento</th><th>Número</th><th>Vencimento</th><th>Situação</th>{podeEditar && <th><span className="visualmente-oculto">Ações</span></th>}</tr></thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.placa}</strong>{d.apelido && <> · {d.apelido}</>}</td>
                  <td>{ROTULO_TIPO_DOC[d.tipo]}{d.descricao && <><br /><span className="texto-fraco">{d.descricao}</span></>}</td>
                  <td>{d.numero ?? <span className="texto-fraco">—</span>}</td>
                  <td className="sem-quebra">{formatarData(d.vencimento)}</td>
                  <td><EtiquetaVencimento situacao={d.situacao} dias={d.dias} /></td>
                  {podeEditar && (
                    <td>
                      <span className="frota-acoes">
                        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditando(d)} aria-label={`Editar ${ROTULO_TIPO_DOC[d.tipo]} de ${d.placa}`}>Editar</button>
                        <button type="button" className="botao botao--perigo botao--pequeno" onClick={() => void excluir(d)} aria-label={`Excluir ${ROTULO_TIPO_DOC[d.tipo]} de ${d.placa}`}>Excluir</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando && veiculos.dados && (
        <FormDocumento doc={editando === "novo" ? null : editando} veiculos={veiculos.dados} aoFechar={() => setEditando(null)} aoSalvo={async () => { notificar("Documento salvo."); await docs.recarregar(); }} />
      )}
    </div>
  );
}
