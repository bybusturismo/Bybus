import { useState } from "react";
import { api } from "../../api/cliente";
import { Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { CabecalhoFrota, FormModal, formatarKm, numeroDeTexto, useVeiculos } from "./comum";
import {
  ROTULO_SITUACAO_VEICULO, ROTULO_TIPO_VEICULO, SITUACOES_VEICULO, TIPOS_VEICULO,
  type SituacaoVeiculo, type TipoVeiculo, type Veiculo,
} from "./tipos";

function FormVeiculo({ veiculo, aoFechar, aoSalvo }: { veiculo: Veiculo | null; aoFechar: () => void; aoSalvo: (v: Veiculo) => Promise<void> }) {
  const { unidades, praca } = useSessao();
  const [unidadeId, setUnidadeId] = useState(veiculo?.unidadeId ?? (praca || unidades[0]?.id || ""));
  const [placa, setPlaca] = useState(veiculo?.placa ?? "");
  const [apelido, setApelido] = useState(veiculo?.apelido ?? "");
  const [tipo, setTipo] = useState<TipoVeiculo>(veiculo?.tipo ?? "ONIBUS");
  const [modelo, setModelo] = useState(veiculo?.modelo ?? "");
  const [ano, setAno] = useState(veiculo?.ano?.toString() ?? "");
  const [capacidade, setCapacidade] = useState(veiculo?.capacidade?.toString() ?? "");
  const [linha, setLinha] = useState(veiculo?.linhaPrincipal ?? "");
  const [publicitario, setPublicitario] = useState(veiculo?.usoPublicitario ?? false);
  const [situacao, setSituacao] = useState<SituacaoVeiculo>(veiculo?.situacao ?? "ATIVO");
  const [km, setKm] = useState("0");
  const [chassi, setChassi] = useState(veiculo?.chassi ?? "");
  const [renavam, setRenavam] = useState(veiculo?.renavam ?? "");
  const [obs, setObs] = useState(veiculo?.observacoes ?? "");

  async function enviar() {
    if (!unidadeId) throw new Error("Escolha a praça do veículo.");
    if (placa.trim().length < 7) throw new Error("Informe a placa (ex.: ABC1D23).");
    const anoN = numeroDeTexto(ano);
    const capN = numeroDeTexto(capacidade);
    const kmN = numeroDeTexto(km);
    if (Number.isNaN(anoN) || Number.isNaN(capN) || Number.isNaN(kmN)) throw new Error("Ano, capacidade e km devem ser números.");
    const corpo = {
      unidadeId, placa, apelido: apelido.trim() || null, tipo, modelo: modelo.trim() || null, ano: anoN, capacidade: capN,
      linhaPrincipal: linha.trim() || null, usoPublicitario: publicitario, situacao, chassi: chassi.trim() || null, renavam: renavam.trim() || null, observacoes: obs.trim() || null,
    };
    const salvo = veiculo ? await api.patch<Veiculo>(`/api/frota/veiculos/${veiculo.id}`, corpo) : await api.post<Veiculo>("/api/frota/veiculos", { ...corpo, kmAtual: kmN ?? 0 });
    await aoSalvo(salvo);
  }

  return (
    <FormModal titulo={veiculo ? `Editar ${veiculo.placa}` : "Novo veículo"} aoFechar={aoFechar} aoEnviar={enviar} largura="larga">
      <div className="grade-campos">
        {unidades.length > 1 && (
          <div className="campo">
            <label htmlFor="fv-praca">Praça</label>
            <select id="fv-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
        )}
        <div className="campo"><label htmlFor="fv-placa">Placa</label><input id="fv-placa" value={placa} maxLength={8} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" /></div>
        <div className="campo"><label htmlFor="fv-apelido">Apelido</label><input id="fv-apelido" value={apelido} maxLength={60} onChange={(e) => setApelido(e.target.value)} placeholder="Ex.: Amarelo" /></div>
        <div className="campo">
          <label htmlFor="fv-tipo">Tipo</label>
          <select id="fv-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoVeiculo)}>
            {TIPOS_VEICULO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_VEICULO[t]}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="fv-modelo">Modelo</label><input id="fv-modelo" value={modelo} maxLength={120} onChange={(e) => setModelo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fv-ano">Ano</label><input id="fv-ano" inputMode="numeric" value={ano} maxLength={4} onChange={(e) => setAno(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fv-cap">Capacidade (lugares)</label><input id="fv-cap" inputMode="numeric" value={capacidade} maxLength={3} onChange={(e) => setCapacidade(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fv-linha">Linha principal</label><input id="fv-linha" value={linha} maxLength={120} onChange={(e) => setLinha(e.target.value)} placeholder="Ex.: City Tour Toda Ilha" /></div>
        <div className="campo">
          <label htmlFor="fv-situacao">Situação</label>
          <select id="fv-situacao" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoVeiculo)}>
            {SITUACOES_VEICULO.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_VEICULO[s]}</option>)}
          </select>
        </div>
        {!veiculo && <div className="campo"><label htmlFor="fv-km">Km atual</label><input id="fv-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></div>}
        <div className="campo"><label htmlFor="fv-chassi">Chassi</label><input id="fv-chassi" value={chassi} maxLength={40} onChange={(e) => setChassi(e.target.value)} /></div>
        <div className="campo"><label htmlFor="fv-renavam">RENAVAM</label><input id="fv-renavam" value={renavam} maxLength={20} onChange={(e) => setRenavam(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="fv-obs">Observações</label><input id="fv-obs" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)} /></div>
      </div>
      <label className="interruptor">
        <input type="checkbox" checked={publicitario} onChange={(e) => setPublicitario(e.target.checked)} />
        Usado também em ações publicitárias
      </label>
    </FormModal>
  );
}

function FormKm({ veiculo, aoFechar, aoSalvo }: { veiculo: Veiculo; aoFechar: () => void; aoSalvo: () => Promise<void> }) {
  const [km, setKm] = useState("");
  async function enviar() {
    const n = numeroDeTexto(km);
    if (n == null || Number.isNaN(n)) throw new Error("Informe o km do hodômetro.");
    await api.post("/api/frota/leituras-km", { veiculoId: veiculo.id, km: n });
    await aoSalvo();
  }
  return (
    <FormModal titulo={`Registrar km — ${veiculo.placa}`} aoFechar={aoFechar} aoEnviar={enviar} rotuloEnviar="Registrar">
      <p className="texto-fraco">Km atual: {formatarKm(veiculo.kmAtual)}. O km nunca diminui. Quando o rastreador (Khronos) for integrado, a leitura virá sozinha.</p>
      <div className="campo"><label htmlFor="fk-km">Km do hodômetro</label><input id="fk-km" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></div>
    </FormModal>
  );
}

export function VeiculosPagina() {
  const { pode, unidades } = useSessao();
  const podeEditar = pode("frota:gerenciar");
  const notificar = useNotificar();
  const lista = useVeiculos();
  const [situacao, setSituacao] = useState<SituacaoVeiculo | "">("");
  const [editando, setEditando] = useState<Veiculo | "novo" | null>(null);
  const [lendoKm, setLendoKm] = useState<Veiculo | null>(null);
  const veiculos = (lista.dados ?? []).filter((v) => !situacao || v.situacao === situacao);

  return (
    <div className="pagina">
      <CabecalhoFrota
        titulo="Veículos"
        descricao="Cadastro da frota, situação e o que impede o veículo de ir para a escala."
        acoes={podeEditar && <button type="button" className="botao botao--primario" onClick={() => setEditando("novo")}><Icone nome="mais" /> Novo veículo</button>}
      />
      <div className="filtros">
        <div className="campo campo--linha">
          <label htmlFor="fv-filtro">Situação</label>
          <select id="fv-filtro" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoVeiculo | "")}>
            <option value="">Todas</option>
            {SITUACOES_VEICULO.map((s) => <option key={s} value={s}>{ROTULO_SITUACAO_VEICULO[s]}</option>)}
          </select>
        </div>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : veiculos.length === 0 ? <Vazio titulo="Nenhum veículo cadastrado." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Veículos da frota</caption>
            <thead>
              <tr><th>Veículo</th><th>Tipo</th>{unidades.length > 1 && <th>Praça</th>}<th>Linha</th><th className="frota-numero">Lugares</th><th className="frota-numero">Km</th><th>Situação</th><th>Escala</th>{(podeEditar) && <th><span className="visualmente-oculto">Ações</span></th>}</tr>
            </thead>
            <tbody>
              {veiculos.map((v) => (
                <tr key={v.id} className={v.situacao === "INATIVO" ? "linha--inativa" : ""}>
                  <td><strong>{v.placa}</strong>{v.apelido && <> · {v.apelido}</>}{v.usoPublicitario && <> <span className="etiqueta etiqueta--linha etiqueta--linha-publicidade">Publicidade</span></>}</td>
                  <td>{ROTULO_TIPO_VEICULO[v.tipo]}{v.ano ? ` · ${v.ano}` : ""}</td>
                  {unidades.length > 1 && <td>{nomePraca(unidades, v.unidadeId)}</td>}
                  <td>{v.linhaPrincipal ?? <span className="texto-fraco">—</span>}</td>
                  <td className="frota-numero">{v.capacidade ?? "—"}</td>
                  <td className="frota-numero">{formatarKm(v.kmAtual)}</td>
                  <td><span className={`etiqueta ${v.situacao === "ATIVO" ? "etiqueta--sucesso" : v.situacao === "MANUTENCAO" ? "etiqueta--atencao" : "etiqueta--neutra"}`}>{ROTULO_SITUACAO_VEICULO[v.situacao]}</span></td>
                  <td>
                    {v.situacao === "INATIVO" ? <span className="texto-fraco">—</span> : v.disponivel ? <span className="etiqueta etiqueta--sucesso">Liberado</span> : (
                      <span className="frota-motivos">{v.motivosBloqueio.map((m) => <span key={m} className="etiqueta etiqueta--perigo">{m}</span>)}</span>
                    )}
                  </td>
                  {podeEditar && (
                    <td>
                      <span className="frota-acoes">
                        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setLendoKm(v)} aria-label={`Registrar km de ${v.placa}`}>Km</button>
                        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditando(v)} aria-label={`Editar ${v.placa}`}>Editar</button>
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando && (
        <FormVeiculo
          veiculo={editando === "novo" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvo={async (v) => { notificar(`Veículo ${v.placa} salvo.`); await lista.recarregar(); }}
        />
      )}
      {lendoKm && <FormKm veiculo={lendoKm} aoFechar={() => setLendoKm(null)} aoSalvo={async () => { notificar("Km registrado."); await lista.recarregar(); }} />}
    </div>
  );
}
