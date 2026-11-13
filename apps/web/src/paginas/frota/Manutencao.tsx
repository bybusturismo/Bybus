import { useState } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, formatarNumero, hojeIso, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CabecalhoFrota, EtiquetaPlano, FormModal, formatarKm, numeroDeTexto, SeletorVeiculo, useVeiculos } from "./comum";
import { lerBase64 } from "../../util/foto";
import { ROTULO_ANEXO_ORDEM, ROTULO_STATUS_ORDEM, type OrdemManutencao, type PlanoManutencao, type StatusOrdem, type TipoAnexoOrdem, type Veiculo } from "./tipos";

/** Arquivos escolhidos para anexar à ordem (enviados depois de a ordem existir). */
type ArquivosOrdem = Partial<Record<TipoAnexoOrdem, File | null>>;
const MAX_ANEXO = 15 * 1024 * 1024;

async function enviarAnexos(ordemId: string, arquivos: ArquivosOrdem) {
  for (const [tipo, f] of Object.entries(arquivos) as Array<[TipoAnexoOrdem, File | null | undefined]>) {
    if (!f) continue;
    await api.post(`/api/frota/ordens/${ordemId}/anexos`, { tipo, nome: f.name, base64: await lerBase64(f) });
  }
}

/** Valores, km e anexos da ordem (13/11/2026): peças, serviço, km atual, km da revisão/garantia, OS, NF e NFS-e. */
function CamposValoresEAnexos(p: {
  pecasValor: string; setPecasValor: (v: string) => void; servicoValor: string; setServicoValor: (v: string) => void;
  km: string; setKm: (v: string) => void; kmRevisao: string; setKmRevisao: (v: string) => void;
  arquivos: ArquivosOrdem; setArquivos: (a: ArquivosOrdem) => void; prefixo: string;
}) {
  const pc = centavosDeTexto(p.pecasValor), sv = centavosDeTexto(p.servicoValor);
  const total = (Number.isNaN(pc) ? 0 : pc ?? 0) + (Number.isNaN(sv) ? 0 : sv ?? 0);
  return (
    <>
      <div className="grade-campos">
        <div className="campo"><label htmlFor={`${p.prefixo}-vpecas`}>Valor das peças (R$)</label><input id={`${p.prefixo}-vpecas`} inputMode="decimal" value={p.pecasValor} onChange={(e) => p.setPecasValor(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><label htmlFor={`${p.prefixo}-vservico`}>Valor do serviço (R$)</label><input id={`${p.prefixo}-vservico`} inputMode="decimal" value={p.servicoValor} onChange={(e) => p.setServicoValor(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><span>Total (peças + serviço)</span><strong aria-live="polite">{formatarMoeda(total)}</strong></div>
        <div className="campo"><label htmlFor={`${p.prefixo}-km`}>KM atual</label><input id={`${p.prefixo}-km`} inputMode="numeric" value={p.km} onChange={(e) => p.setKm(e.target.value)} /></div>
        <div className="campo"><label htmlFor={`${p.prefixo}-kmrev`}>KM da revisão / garantia</label><input id={`${p.prefixo}-kmrev`} inputMode="numeric" value={p.kmRevisao} onChange={(e) => p.setKmRevisao(e.target.value)} placeholder="Ex.: próxima revisão" /></div>
      </div>
      <fieldset className="frota-anexos">
        <legend>Anexos (PDF, foto ou XML da nota; até 15 MB)</legend>
        <div className="grade-campos">
          {(["OS", "NF", "NFSE"] as const).map((t) => (
            <div className="campo" key={t}>
              <label htmlFor={`${p.prefixo}-anexo-${t}`}>{ROTULO_ANEXO_ORDEM[t]}</label>
              <input id={`${p.prefixo}-anexo-${t}`} type="file" accept=".pdf,.jpg,.jpeg,.png,.xml,.doc,.docx,.xls,.xlsx" onChange={(e) => p.setArquivos({ ...p.arquivos, [t]: e.target.files?.[0] ?? null })} />
            </div>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function valoresDaOrdem(pecasValor: string, servicoValor: string, km: string, kmRevisao: string, arquivos: ArquivosOrdem) {
  const vp = centavosDeTexto(pecasValor), vs = centavosDeTexto(servicoValor);
  const k = numeroDeTexto(km), kr = numeroDeTexto(kmRevisao);
  if (Number.isNaN(vp) || Number.isNaN(vs)) throw new Error("Valores de peças e serviço: use o formato 1.234,56.");
  if (Number.isNaN(k) || Number.isNaN(kr)) throw new Error("KM atual e KM da revisão devem ser números.");
  if (k != null && kr != null && kr < k) throw new Error("O KM da revisão/garantia deve ser maior que o KM atual.");
  if (Object.values(arquivos).some((f) => f && f.size > MAX_ANEXO)) throw new Error("Cada anexo pode ter até 15 MB.");
  return { valorPecasCentavos: vp ?? 0, valorServicoCentavos: vs ?? 0, km: k, kmRevisao: kr };
}

function FormOrdem({ veiculos, planos, aoFechar, aoSalvo }: { veiculos: Veiculo[]; planos: PlanoManutencao[]; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(veiculos[0]?.id ?? "");
  const [tipo, setTipo] = useState<"PREVENTIVA" | "CORRETIVA">("CORRETIVA");
  const [planoId, setPlanoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [oficina, setOficina] = useState("");
  const [abertaEm, setAbertaEm] = useState(hojeIso());
  const [imobiliza, setImobiliza] = useState(false);
  const [pecasValor, setPecasValor] = useState("");
  const [servicoValor, setServicoValor] = useState("");
  const [km, setKm] = useState("");
  const [kmRevisao, setKmRevisao] = useState("");
  const [arquivos, setArquivos] = useState<ArquivosOrdem>({});
  const planosDoVeiculo = planos.filter((p) => p.veiculoId === veiculoId && p.ativo);
  async function enviar() {
    if (!veiculoId) throw new Error("Escolha o veículo.");
    if (descricao.trim().length < 3) throw new Error("Descreva o serviço.");
    const valores = valoresDaOrdem(pecasValor, servicoValor, km, kmRevisao, arquivos);
    const o = await api.post<{ id: string }>("/api/frota/ordens", { veiculoId, tipo, planoId: tipo === "PREVENTIVA" && planoId ? planoId : null, descricao: descricao.trim(), oficina: oficina.trim() || null, abertaEm, imobiliza, ...valores });
    try {
      await enviarAnexos(o.id, arquivos);
    } finally {
      await aoSalvo();
    }
  }
  return (
    <FormModal titulo="Nova ordem de manutenção" aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar="Abrir ordem">
      <div className="grade-campos">
        <div className="campo"><label htmlFor="fo-veiculo">Veículo</label><SeletorVeiculo id="fo-veiculo" valor={veiculoId} aoMudar={(v) => { setVeiculoId(v); setPlanoId(""); }} veiculos={veiculos} /></div>
        <div className="campo">
          <label htmlFor="fo-tipo">Tipo</label>
          <select id="fo-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "PREVENTIVA" | "CORRETIVA")}>
            <option value="CORRETIVA">Corretiva (quebra, defeito)</option>
            <option value="PREVENTIVA">Preventiva</option>
          </select>
        </div>
        {tipo === "PREVENTIVA" && (
          <div className="campo">
            <label htmlFor="fo-plano">Plano atendido</label>
            <select id="fo-plano" value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
              <option value="">Nenhum (avulsa)</option>
              {planosDoVeiculo.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
        )}
        <div className="campo"><label htmlFor="fo-data">Aberta em</label><input id="fo-data" type="date" value={abertaEm} onChange={(e) => setAbertaEm(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fo-oficina">Oficina / fornecedor</label><input id="fo-oficina" value={oficina} maxLength={120} onChange={(e) => setOficina(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="fo-desc">Descrição do serviço</label><textarea id="fo-desc" rows={10} value={descricao} maxLength={5000} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva o serviço: o que foi feito, peças trocadas, diagnóstico, observações da oficina…" /></div>
      </div>
      <CamposValoresEAnexos prefixo="fo" pecasValor={pecasValor} setPecasValor={setPecasValor} servicoValor={servicoValor} setServicoValor={setServicoValor} km={km} setKm={setKm} kmRevisao={kmRevisao} setKmRevisao={setKmRevisao} arquivos={arquivos} setArquivos={setArquivos} />
      <label className="interruptor">
        <input type="checkbox" checked={imobiliza} onChange={(e) => setImobiliza(e.target.checked)} />
        Veículo parado (bloqueia na escala enquanto a ordem estiver aberta)
      </label>
    </FormModal>
  );
}

function FormConcluir({ ordem, aoFechar, aoSalvo }: { ordem: OrdemManutencao; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const semDetalhe = !ordem.valorPecasCentavos && !ordem.valorServicoCentavos;
  const [pecasValor, setPecasValor] = useState(textoDeCentavos(ordem.valorPecasCentavos || null));
  const [servicoValor, setServicoValor] = useState(textoDeCentavos((semDetalhe ? ordem.custoCentavos : ordem.valorServicoCentavos) || null));
  const [km, setKm] = useState(ordem.km?.toString() ?? "");
  const [kmRevisao, setKmRevisao] = useState(ordem.kmRevisao?.toString() ?? "");
  const [arquivos, setArquivos] = useState<ArquivosOrdem>({});
  const [data, setData] = useState(hojeIso());
  const [pecas, setPecas] = useState(ordem.pecas ?? "");
  const [oficina, setOficina] = useState(ordem.oficina ?? "");
  async function enviar() {
    const valores = valoresDaOrdem(pecasValor, servicoValor, km, kmRevisao, arquivos);
    // Anexos antes de concluir: ordem encerrada não muda mais.
    await enviarAnexos(ordem.id, arquivos);
    await api.patch(`/api/frota/ordens/${ordem.id}`, { status: "CONCLUIDA", ...valores, custoCentavos: valores.valorPecasCentavos + valores.valorServicoCentavos, concluidaEm: data, pecas: pecas.trim() || null, oficina: oficina.trim() || null });
    await aoSalvo();
  }
  return (
    <FormModal titulo={`Concluir ordem — ${ordem.placa}`} aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar="Concluir">
      <p className="texto-fraco">{ordem.descricao}</p>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="fc-data">Concluída em</label><input id="fc-data" type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fc-oficina">Oficina</label><input id="fc-oficina" value={oficina} maxLength={120} onChange={(e) => setOficina(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="fc-pecas">Peças trocadas</label><textarea id="fc-pecas" rows={3} value={pecas} maxLength={2000} onChange={(e) => setPecas(e.target.value)} /></div>
      </div>
      <CamposValoresEAnexos prefixo="fc" pecasValor={pecasValor} setPecasValor={setPecasValor} servicoValor={servicoValor} setServicoValor={setServicoValor} km={km} setKm={setKm} kmRevisao={kmRevisao} setKmRevisao={setKmRevisao} arquivos={arquivos} setArquivos={setArquivos} />
      {ordem.anexos.length > 0 && <p className="texto-fraco">Já anexados: {ordem.anexos.map((a) => ROTULO_ANEXO_ORDEM[a.tipo]).join(", ")}.</p>}
    </FormModal>
  );
}

function FormPlano({ plano, veiculos, aoFechar, aoSalvo }: { plano: PlanoManutencao | null; veiculos: Veiculo[]; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(plano?.veiculoId ?? veiculos[0]?.id ?? "");
  const [nome, setNome] = useState(plano?.nome ?? "");
  const [intervaloKm, setIntervaloKm] = useState(plano?.intervaloKm?.toString() ?? "");
  const [intervaloDias, setIntervaloDias] = useState(plano?.intervaloDias?.toString() ?? "");
  const [ultimoKm, setUltimoKm] = useState(plano?.ultimoKm?.toString() ?? "");
  const [ultimaData, setUltimaData] = useState(plano?.ultimaData ?? "");
  const [critico, setCritico] = useState(plano?.critico ?? false);
  const [ativo, setAtivo] = useState(plano?.ativo ?? true);
  async function enviar() {
    if (nome.trim().length < 2) throw new Error("Dê um nome ao plano (ex.: Troca de óleo).");
    const ik = numeroDeTexto(intervaloKm), id = numeroDeTexto(intervaloDias), uk = numeroDeTexto(ultimoKm);
    if ([ik, id, uk].some((n) => Number.isNaN(n))) throw new Error("Km e dias devem ser números.");
    if (!ik && !id) throw new Error("Informe o intervalo em km, em dias ou os dois.");
    const corpo = { nome: nome.trim(), intervaloKm: ik, intervaloDias: id, ultimoKm: uk, ultimaData: ultimaData || null, critico, ativo };
    if (plano) await api.patch(`/api/frota/planos/${plano.id}`, corpo);
    else await api.post("/api/frota/planos", { ...corpo, veiculoId });
    await aoSalvo();
  }
  return (
    <FormModal titulo={plano ? "Editar plano" : "Novo plano de manutenção"} aoFechar={aoFechar} aoEnviar={enviar}>
      <p className="texto-fraco">Vale o que chegar primeiro: o km ou os dias desde a última execução.</p>
      <div className="grade-campos">
        <div className="campo"><label htmlFor="fp-veiculo">Veículo</label><SeletorVeiculo id="fp-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} desabilitado={!!plano} /></div>
        <div className="campo"><label htmlFor="fp-nome">Nome</label><input id="fp-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Troca de óleo e filtros" /></div>
        <div className="campo"><label htmlFor="fp-km">A cada (km)</label><input id="fp-km" inputMode="numeric" value={intervaloKm} onChange={(e) => setIntervaloKm(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fp-dias">A cada (dias)</label><input id="fp-dias" inputMode="numeric" value={intervaloDias} onChange={(e) => setIntervaloDias(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fp-ukm">Última execução: km</label><input id="fp-ukm" inputMode="numeric" value={ultimoKm} onChange={(e) => setUltimoKm(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fp-udata">Última execução: data</label><input id="fp-udata" type="date" value={ultimaData} onChange={(e) => setUltimaData(e.target.value)} /></div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={critico} onChange={(e) => setCritico(e.target.checked)} /> Crítico (vencido, bloqueia o veículo na escala)</label>
      <label className="interruptor"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Plano ativo</label>
    </FormModal>
  );
}

export function ManutencaoPagina() {
  const { pode } = useSessao();
  const podeEditar = pode("frota:gerenciar");
  const notificar = useNotificar();
  const veiculos = useVeiculos();
  const [aba, setAba] = useState<"ordens" | "planos">("ordens");
  const [status, setStatus] = useState<StatusOrdem | "">("");
  const [veiculoId, setVeiculoId] = useState("");
  const [novaOrdem, setNovaOrdem] = useState(false);
  const [concluindo, setConcluindo] = useState<OrdemManutencao | null>(null);
  const [plano, setPlano] = useState<PlanoManutencao | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ordens = useCarregar((sinal) => api.get<OrdemManutencao[]>(`/api/frota/ordens${qs({ status, veiculoId })}`, sinal), [status, veiculoId]);
  const planos = useCarregar((sinal) => api.get<PlanoManutencao[]>(`/api/frota/planos${qs({ veiculoId })}`, sinal), [veiculoId]);

  async function mudarStatus(o: OrdemManutencao, novo: StatusOrdem) {
    if (novo === "CANCELADA" && !window.confirm(`Cancelar a ordem de ${o.placa}?`)) return;
    try {
      await api.patch(`/api/frota/ordens/${o.id}`, { status: novo });
      await Promise.all([ordens.recarregar(), planos.recarregar(), veiculos.recarregar()]);
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  const recarregarTudo = async () => { await Promise.all([ordens.recarregar(), planos.recarregar(), veiculos.recarregar()]); };
  const ativos = (veiculos.dados ?? []).filter((v) => v.situacao !== "INATIVO");
  const filtroVeiculo = (
    <div className="campo campo--linha">
      <label htmlFor="fm-veiculo">Veículo</label>
      <SeletorVeiculo id="fm-veiculo" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos.dados ?? []} vazio="Todos" />
    </div>
  );

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Manutenção"
        descricao="Planos preventivos por km e por tempo, e ordens de manutenção com custo, oficina e tempo parado."
        acoes={podeEditar && (aba === "ordens"
          ? <button type="button" className="botao botao--primario" onClick={() => setNovaOrdem(true)} disabled={!ativos.length}><Icone nome="mais" /> Nova ordem</button>
          : <button type="button" className="botao botao--primario" onClick={() => setPlano("novo")} disabled={!ativos.length}><Icone nome="mais" /> Novo plano</button>)}
      />
      <div className="abas" role="tablist" aria-label="Manutenção">
        <button type="button" role="tab" aria-selected={aba === "ordens"} className={`aba${aba === "ordens" ? " aba--ativa" : ""}`} onClick={() => setAba("ordens")}>Ordens de manutenção</button>
        <button type="button" role="tab" aria-selected={aba === "planos"} className={`aba${aba === "planos" ? " aba--ativa" : ""}`} onClick={() => setAba("planos")}>Planos preventivos</button>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {aba === "ordens" ? (
        <>
          <div className="filtros">
            {filtroVeiculo}
            <div className="campo campo--linha">
              <label htmlFor="fm-status">Situação</label>
              <select id="fm-status" value={status} onChange={(e) => setStatus(e.target.value as StatusOrdem | "")}>
                <option value="">Todas</option>
                {(Object.keys(ROTULO_STATUS_ORDEM) as StatusOrdem[]).map((s) => <option key={s} value={s}>{ROTULO_STATUS_ORDEM[s]}</option>)}
              </select>
            </div>
          </div>
          {ordens.carregando && !ordens.dados ? <Carregando /> : ordens.erro ? <ErroCarga mensagem={ordens.erro} tentarDeNovo={ordens.recarregar} /> : !ordens.dados?.length ? <Vazio titulo="Nenhuma ordem de manutenção." /> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <caption className="visualmente-oculto">Ordens de manutenção</caption>
                <thead><tr><th>Veículo</th><th>Serviço</th><th>Oficina</th><th>Aberta</th><th>Parado</th><th className="frota-numero">Custo</th><th>Situação</th>{podeEditar && <th><span className="visualmente-oculto">Ações</span></th>}</tr></thead>
                <tbody>
                  {ordens.dados.map((o) => (
                    <tr key={o.id}>
                      <td><strong>{o.placa}</strong></td>
                      <td>
                        <span className="frota-descricao">{o.descricao}</span>
                        {(o.km != null || o.kmRevisao != null) && <div className="texto-fraco">{o.km != null ? `KM ${formatarNumero(o.km)}` : ""}{o.kmRevisao != null ? ` · revisão/garantia em ${formatarNumero(o.kmRevisao)} km` : ""}</div>}
                        {o.anexos.length > 0 && (
                          <div className="frota-anexos-lista">
                            {o.anexos.map((a) => <a key={a.id} href={`/api/frota/anexos/${a.id}`} target="_blank" rel="noopener noreferrer"><Icone nome="baixar" tamanho={14} /> {ROTULO_ANEXO_ORDEM[a.tipo]}</a>)}
                          </div>
                        )}
                        <br /><span className={`etiqueta ${o.tipo === "CORRETIVA" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{o.tipo === "CORRETIVA" ? "Corretiva" : "Preventiva"}</span>{o.imobiliza && o.status !== "CONCLUIDA" && o.status !== "CANCELADA" && <> <span className="etiqueta etiqueta--perigo">Veículo parado</span></>}</td>
                      <td>{o.oficina ?? <span className="texto-fraco">—</span>}</td>
                      <td className="sem-quebra">{formatarData(o.abertaEm)}</td>
                      <td className="sem-quebra">{o.diasParado == null ? "—" : `${o.diasParado} ${o.diasParado === 1 ? "dia" : "dias"}`}</td>
                      <td className="frota-numero">
                        {o.custoCentavos ? formatarMoeda(o.custoCentavos) : "—"}
                        {(o.valorPecasCentavos > 0 || o.valorServicoCentavos > 0) && <div className="texto-fraco">peças {formatarMoeda(o.valorPecasCentavos)} · serviço {formatarMoeda(o.valorServicoCentavos)}</div>}
                      </td>
                      <td><span className={`etiqueta ${o.status === "CONCLUIDA" ? "etiqueta--sucesso" : o.status === "CANCELADA" ? "etiqueta--neutra" : "etiqueta--atencao"}`}>{ROTULO_STATUS_ORDEM[o.status]}</span></td>
                      {podeEditar && (
                        <td>
                          {(o.status === "ABERTA" || o.status === "EM_ANDAMENTO") && (
                            <span className="frota-acoes">
                              {o.status === "ABERTA" && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void mudarStatus(o, "EM_ANDAMENTO")} aria-label={`Iniciar ordem de ${o.placa}`}>Iniciar</button>}
                              <button type="button" className="botao botao--sucesso botao--pequeno" onClick={() => setConcluindo(o)} aria-label={`Concluir ordem de ${o.placa}`}>Concluir</button>
                              <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void mudarStatus(o, "CANCELADA")} aria-label={`Cancelar ordem de ${o.placa}`}>Cancelar</button>
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="filtros">{filtroVeiculo}</div>
          {planos.carregando && !planos.dados ? <Carregando /> : planos.erro ? <ErroCarga mensagem={planos.erro} tentarDeNovo={planos.recarregar} /> : !planos.dados?.length ? <Vazio titulo="Nenhum plano preventivo cadastrado.">{podeEditar ? "Cadastre trocas de óleo, filtros, correias, freios, pneus e outros itens." : null}</Vazio> : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <caption className="visualmente-oculto">Planos de manutenção preventiva</caption>
                <thead><tr><th>Veículo</th><th>Plano</th><th>Intervalo</th><th>Última</th><th>Próxima</th><th>Situação</th>{podeEditar && <th><span className="visualmente-oculto">Ações</span></th>}</tr></thead>
                <tbody>
                  {planos.dados.map((p) => (
                    <tr key={p.id} className={p.ativo ? "" : "linha--inativa"}>
                      <td><strong>{p.placa}</strong></td>
                      <td>{p.nome}{p.critico && <> <span className="etiqueta etiqueta--neutra">crítico</span></>}</td>
                      <td>{[p.intervaloKm && `${formatarNumero(p.intervaloKm)} km`, p.intervaloDias && `${p.intervaloDias} dias`].filter(Boolean).join(" ou ")}</td>
                      <td>{[p.ultimoKm != null && formatarKm(p.ultimoKm), p.ultimaData && formatarData(p.ultimaData)].filter(Boolean).join(" · ") || "—"}</td>
                      <td>{[p.proximoKm != null && formatarKm(p.proximoKm), p.proximaData && formatarData(p.proximaData)].filter(Boolean).join(" · ") || "—"}</td>
                      <td><EtiquetaPlano situacao={p.situacao} /></td>
                      {podeEditar && <td><button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setPlano(p)} aria-label={`Editar plano ${p.nome} de ${p.placa}`}>Editar</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {novaOrdem && <FormOrdem veiculos={ativos} planos={planos.dados ?? []} aoFechar={() => setNovaOrdem(false)} aoSalvo={async () => { notificar("Ordem aberta."); await recarregarTudo(); }} />}
      {concluindo && <FormConcluir ordem={concluindo} aoFechar={() => setConcluindo(null)} aoSalvo={async () => { notificar("Ordem concluída."); await recarregarTudo(); }} />}
      {plano && <FormPlano plano={plano === "novo" ? null : plano} veiculos={ativos} aoFechar={() => setPlano(null)} aoSalvo={async () => { notificar("Plano salvo."); await recarregarTudo(); }} />}
    </div>
  );
}
