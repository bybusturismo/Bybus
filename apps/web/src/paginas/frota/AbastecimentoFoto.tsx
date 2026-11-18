import { FORMAS_PAGAMENTO_COMBUSTIVEL, ROTULO_FORMA_COMBUSTIVEL, type FormaPagamentoCombustivel } from "@bybus/core";
import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, textoDeCentavos } from "../../util/formato";
import { prepararFotoDocumento } from "../../util/foto";
import { useCarregar } from "../../util/useCarregar";
import { FormModal, formatarKm, numeroDeTexto, SeletorVeiculo } from "./comum";
import type { AbastecimentoPendente } from "./tipos";

/** Abastecimento pela foto do cupom (dono, 18/11/2026): enviar, pendentes, conferência e forma de pagamento por praça. */
type VeiculoOpcao = { id: string; placa: string; apelido: string | null; unidadeId?: string };
const dec = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const ROTULO_ORIGEM = { MANUAL: "Tela da frota", APP: "App", WHATSAPP: "WhatsApp" } as const;
const urlFoto = (id: string) => `/api/frota/abastecimentos/fotos/${id}`;

/** Motorista (ou quem gerencia) manda a foto do cupom; placa e km ajudam, o resto a leitura automática preenche. */
export function EnviarFotoCupom({ veiculos, aoFechar, aoEnviado }: { veiculos: VeiculoOpcao[]; aoFechar: () => void; aoEnviado: (p: AbastecimentoPendente & { iaLigada: boolean }) => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState("");
  const [km, setKm] = useState("");
  const [cupom, setCupom] = useState<File | null>(null);
  const [painel, setPainel] = useState<File | null>(null);
  async function enviar() {
    if (!cupom) throw new Error("Tire ou escolha a foto do cupom.");
    const k = numeroDeTexto(km);
    if (k != null && Number.isNaN(k)) throw new Error("Km do painel: só números (ex.: 120.500).");
    const fotos = [{ ...(await prepararFotoDocumento(cupom)), tipo: "CUPOM" }, ...(painel ? [{ ...(await prepararFotoDocumento(painel)), tipo: "HODOMETRO" }] : [])];
    const r = await api.post<AbastecimentoPendente & { iaLigada: boolean }>("/api/frota/abastecimentos/foto", { veiculoId: veiculoId || null, km: k, fotos });
    await aoEnviado(r);
  }
  return (
    <FormModal titulo="Enviar foto do cupom" aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar="Enviar">
      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="fc-cupom">Foto do cupom</label>
          <input id="fc-cupom" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setCupom(e.target.files?.[0] ?? null)} />
          <span className="campo__ajuda">O cupom inteiro, de frente e sem reflexo.</span>
        </div>
        <div className="campo">
          <label htmlFor="fc-painel">Foto do painel (opcional)</label>
          <input id="fc-painel" type="file" accept="image/*" capture="environment" onChange={(e) => setPainel(e.target.files?.[0] ?? null)} />
          <span className="campo__ajuda">Mostrando o km. Dispensa digitar o km.</span>
        </div>
        <div className="campo"><label htmlFor="fc-placa">Placa</label><SeletorVeiculo id="fc-placa" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} vazio="Escolha…" /></div>
        <div className="campo"><label htmlFor="fc-km">Km do painel</label><input id="fc-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="se não mandou a foto do painel" /></div>
      </div>
      <p className="texto-fraco">Também dá para mandar a foto pelo WhatsApp da empresa, com a placa e o km escritos na mensagem (ex.: ABC1D23 120500).</p>
    </FormModal>
  );
}

/** Quem gerencia confere o pendente: dados finais, forma de pagamento e a conta a pagar no Financeiro. */
function ConferirPendente({ p, veiculos, aoFechar, aoConferido }: { p: AbastecimentoPendente; veiculos: VeiculoOpcao[]; aoFechar: () => void; aoConferido: () => Promise<void> }) {
  const [veiculoId, setVeiculoId] = useState(p.veiculoId ?? "");
  const [data, setData] = useState(p.data);
  const [km, setKm] = useState(p.km == null ? "" : String(p.km));
  const [litros, setLitros] = useState(p.litros == null ? "" : String(p.litros).replace(".", ","));
  const [valor, setValor] = useState(p.valorCentavos == null ? "" : textoDeCentavos(p.valorCentavos));
  const [posto, setPosto] = useState(p.posto ?? "");
  const [cheio, setCheio] = useState(p.tanqueCheio);
  const [forma, setForma] = useState<FormaPagamentoCombustivel | "">("");
  const [gerarConta, setGerarConta] = useState(true);
  async function enviar() {
    const k = numeroDeTexto(km), l = numeroDeTexto(litros, true), v = centavosDeTexto(valor);
    if (!veiculoId) throw new Error("Escolha a placa.");
    if (k == null || Number.isNaN(k)) throw new Error("Informe o km do painel.");
    if (l == null || Number.isNaN(l) || l <= 0) throw new Error("Informe os litros (ex.: 45,5).");
    if (v == null || Number.isNaN(v) || v <= 0) throw new Error("Informe o valor total (ex.: 312,45).");
    await api.post(`/api/frota/abastecimentos/${p.id}/conferir`, { veiculoId, data, km: k, litros: l, valorCentavos: v, posto: posto.trim() || null, tanqueCheio: cheio, formaPagamento: forma || null, gerarConta });
    await aoConferido();
  }
  return (
    <FormModal titulo="Conferir abastecimento" aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar="Conferir" largura="larga">
      <div className="frota-fotos">
        {p.fotos.map((f) => f.mime.startsWith("image/")
          ? <a key={f.id} href={urlFoto(f.id)} target="_blank" rel="noopener noreferrer"><img src={urlFoto(f.id)} alt={`Foto ${f.tipo === "HODOMETRO" ? "do painel" : "do cupom"}`} /></a>
          : <a key={f.id} href={urlFoto(f.id)} target="_blank" rel="noopener noreferrer">{f.nomeArquivo}</a>)}
      </div>
      {p.leituraIa?.observacao && <Aviso tipo="atencao">Leitura automática: {p.leituraIa.observacao}</Aviso>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="cf-placa">Placa</label><SeletorVeiculo id="cf-placa" valor={veiculoId} aoMudar={setVeiculoId} veiculos={veiculos} vazio="Escolha…" /></div>
        <div className="campo"><label htmlFor="cf-data">Data</label><input id="cf-data" type="date" value={data} max={hojeIso()} onChange={(e) => setData(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cf-km">Km do painel</label><input id="cf-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cf-litros">Litros</label><input id="cf-litros" inputMode="decimal" value={litros} onChange={(e) => setLitros(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cf-valor">Valor total (R$)</label><input id="cf-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cf-posto">Posto</label><input id="cf-posto" value={posto} maxLength={120} onChange={(e) => setPosto(e.target.value)} /></div>
        <div className="campo">
          <label htmlFor="cf-forma">Pagamento</label>
          <select id="cf-forma" value={forma} onChange={(e) => setForma(e.target.value as FormaPagamentoCombustivel | "")}>
            <option value="">Padrão da praça</option>
            {FORMAS_PAGAMENTO_COMBUSTIVEL.map((f) => <option key={f} value={f}>{ROTULO_FORMA_COMBUSTIVEL[f]}</option>)}
          </select>
        </div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={cheio} onChange={(e) => setCheio(e.target.checked)} /> Completou o tanque (necessário para calcular km/l)</label>
      <label className="interruptor"><input type="checkbox" checked={gerarConta} onChange={(e) => setGerarConta(e.target.checked)} /> Lançar a conta a pagar no Financeiro (com a foto do cupom)</label>
    </FormModal>
  );
}

/** Pendentes de conferência: quem gerencia confere; o motorista vê os que mandou e pode excluir enquanto pendente. */
export function PendentesAbastecimento({ veiculos, aoMudar }: { veiculos: VeiculoOpcao[]; aoMudar: () => Promise<void> }) {
  const { pode } = useSessao();
  const gerente = pode("frota:gerenciar");
  const dados = useCarregar((s) => api.get<{ iaLigada: boolean; itens: AbastecimentoPendente[] }>("/api/frota/abastecimentos/pendentes", s), []);
  const [conferindo, setConferindo] = useState<AbastecimentoPendente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const itens = dados.dados?.itens ?? [];
  if (!itens.length && !erro) return null;
  async function excluir(p: AbastecimentoPendente) {
    if (!window.confirm("Excluir este abastecimento pendente e as fotos?")) return;
    try { await api.delete(`/api/frota/abastecimentos/${p.id}`); await dados.recarregar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  return (
    <section className="cartao" aria-labelledby="fab-pendentes">
      <h2 id="fab-pendentes">Pendentes de conferência ({itens.length})</h2>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados.dados && !dados.dados.iaLigada && <p className="texto-fraco">Leitura automática desligada: litros e valor são preenchidos na conferência, olhando a foto.</p>}
      <ul className="frota-pendentes">
        {itens.map((p) => (
          <li key={p.id}>
            <div className="frota-pendentes__fotos">
              {p.fotos.slice(0, 2).map((f) => f.mime.startsWith("image/")
                ? <a key={f.id} href={urlFoto(f.id)} target="_blank" rel="noopener noreferrer"><img src={urlFoto(f.id)} alt={`Foto ${f.tipo === "HODOMETRO" ? "do painel" : "do cupom"}`} /></a>
                : <a key={f.id} href={urlFoto(f.id)} target="_blank" rel="noopener noreferrer">PDF</a>)}
            </div>
            <div>
              <strong>{p.placa ?? "Sem placa"}</strong> · {formatarData(p.data)} · <span className="etiqueta etiqueta--neutra">{ROTULO_ORIGEM[p.origem]}</span>
              <div>{[p.km != null ? formatarKm(p.km) : null, p.litros ? `${dec(p.litros)} L` : null, p.valorCentavos ? formatarMoeda(p.valorCentavos) : null, p.posto].filter(Boolean).join(" · ") || <span className="texto-fraco">Sem dados lidos</span>}</div>
              {p.pessoaNome && <div className="texto-fraco">Enviado por {p.pessoaNome}</div>}
              {p.faltas.length > 0 && <span className="etiqueta etiqueta--atencao">Falta: {p.faltas.join(", ")}</span>}
            </div>
            <div className="barra-acoes">
              {gerente && <button type="button" className="botao botao--primario botao--pequeno" onClick={() => setConferindo(p)}>Conferir</button>}
              <button type="button" className="botao botao--perigo botao--pequeno" onClick={() => void excluir(p)} aria-label={`Excluir pendente de ${formatarData(p.data)}`}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>
      {conferindo && (
        <ConferirPendente p={conferindo} veiculos={veiculos} aoFechar={() => setConferindo(null)} aoConferido={async () => { await Promise.all([dados.recarregar(), aoMudar()]); }} />
      )}
    </section>
  );
}

/** Forma de pagamento e prazo da fatura por praça (padrão da conta a pagar gerada). */
export function ConfigPagamentoCombustivel() {
  const dados = useCarregar((s) => api.get<Record<string, { forma: FormaPagamentoCombustivel; prazoDias: number; codigo: string; nome: string }>>("/api/frota/pagamento-combustivel", s), []);
  const [rascunho, setRascunho] = useState<Record<string, { forma: FormaPagamentoCombustivel; prazoDias: number }> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const atual = rascunho ?? (dados.dados ? Object.fromEntries(Object.entries(dados.dados).map(([k, v]) => [k, { forma: v.forma, prazoDias: v.prazoDias }])) : null);
  if (!dados.dados || !atual) return null;
  async function salvar() {
    try { await api.put("/api/frota/pagamento-combustivel", atual); setMsg("Salvo."); setRascunho(null); await dados.recarregar(); } catch (x) { setMsg(mensagemDeErro(x)); }
  }
  return (
    <details className="cartao">
      <summary><Icone nome="engrenagem" /> Pagamento do combustível por praça</summary>
      <p className="texto-fraco">Padrão da conta a pagar gerada na conferência. Faturado: vence na data do abastecimento mais o prazo da fatura do posto.</p>
      {Object.entries(dados.dados).map(([id, p]) => (
        <div key={id} className="filtros">
          <strong>{p.nome}</strong>
          <div className="campo campo--linha">
            <label htmlFor={`pc-forma-${id}`}>Forma</label>
            <select id={`pc-forma-${id}`} value={atual[id]!.forma} onChange={(e) => setRascunho({ ...atual, [id]: { ...atual[id]!, forma: e.target.value as FormaPagamentoCombustivel } })}>
              {FORMAS_PAGAMENTO_COMBUSTIVEL.map((f) => <option key={f} value={f}>{ROTULO_FORMA_COMBUSTIVEL[f]}</option>)}
            </select>
          </div>
          {atual[id]!.forma === "FATURADO" && (
            <div className="campo campo--linha">
              <label htmlFor={`pc-prazo-${id}`}>Prazo da fatura (dias)</label>
              <input id={`pc-prazo-${id}`} inputMode="numeric" value={String(atual[id]!.prazoDias)} onChange={(e) => setRascunho({ ...atual, [id]: { ...atual[id]!, prazoDias: Math.max(0, Math.min(120, Number(e.target.value.replace(/\D/g, "")) || 0)) } })} />
            </div>
          )}
        </div>
      ))}
      <div className="barra-acoes"><button type="button" className="botao botao--secundario" disabled={!rascunho} onClick={() => void salvar()}>Salvar</button>{msg && <span role="status">{msg}</span>}</div>
    </details>
  );
}
