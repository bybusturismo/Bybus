import { useState } from "react";
import { Modal } from "../../componentes/Modal";
import { useCarregar } from "../../util/useCarregar";
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
  const [drive, setDrive] = useState(veiculo?.driveLink ?? "");

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
      driveLink: drive.trim() || null,
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
        <div className="campo campo--largo">
          <label htmlFor="fv-drive">Pasta do Google Drive (gabaritos e outros arquivos)</label>
          <input id="fv-drive" type="url" value={drive} maxLength={500} onChange={(e) => setDrive(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
          <span className="campo__ajuda">Cole o link da pasta deste veículo. A pasta precisa estar compartilhada (Leitor) com a conta técnica do sistema.</span>
        </div>
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
  const [arquivos, setArquivos] = useState<Veiculo | null>(null);
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
              <tr><th>Veículo</th><th>Tipo</th>{unidades.length > 1 && <th>Praça</th>}<th>Linha</th><th className="frota-numero">Lugares</th><th className="frota-numero">Km</th><th>Situação</th><th>Escala</th><th><span className="visualmente-oculto">Ações</span></th></tr>
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
                  <td>
                    <span className="frota-acoes">
                      {v.driveLink && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setArquivos(v)} aria-label={`Gabaritos e arquivos de ${v.placa}`}><Icone nome="auditoria" /> Arquivos</button>}
                      {podeEditar && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setLendoKm(v)} aria-label={`Registrar km de ${v.placa}`}>Km</button>}
                      {podeEditar && <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => setEditando(v)} aria-label={`Editar ${v.placa}`}>Editar</button>}
                    </span>
                  </td>
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
      {arquivos && <ArquivosDrive veiculo={arquivos} aoFechar={() => setArquivos(null)} />}
      {lendoKm && <FormKm veiculo={lendoKm} aoFechar={() => setLendoKm(null)} aoSalvo={async () => { notificar("Km registrado."); await lista.recarregar(); }} />}
    </div>
  );
}

interface ItemDrive { id: string; nome: string; tipo: string; tamanho: number | null; modificadoEm: string | null; caminho: string }

const tamanhoLegivel = (b: number | null) => (b == null ? "" : b > 1_048_576 ? `${(b / 1_048_576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const tipoLegivel = (t: string) => (t === "application/pdf" ? "PDF" : t.startsWith("image/") ? "Imagem" : t.startsWith("application/vnd.google-apps.") ? "Documento Google (abre em PDF)" : t.includes("illustrator") || t.includes("postscript") ? "Arte (Illustrator)" : t.includes("photoshop") ? "Arte (Photoshop)" : t.includes("corel") ? "Arte (Corel)" : "Arquivo");

/** Gabaritos e outros arquivos do veículo, lidos da pasta do Google Drive (11/11/2026). */
function ArquivosDrive({ veiculo, aoFechar }: { veiculo: Veiculo; aoFechar: () => void }) {
  const r = useCarregar((s) => api.get<{ pasta: string | null; email: string | null; itens: ItemDrive[] }>(`/api/frota/veiculos/${veiculo.id}/drive`, s), [veiculo.id]);
  const grupos = new Map<string, ItemDrive[]>();
  for (const i of r.dados?.itens ?? []) grupos.set(i.caminho, [...(grupos.get(i.caminho) ?? []), i]);
  const base = `/api/frota/veiculos/${veiculo.id}/drive`;
  return (
    <Modal aberto titulo={`Arquivos de ${veiculo.placa}${veiculo.apelido ? ` · ${veiculo.apelido}` : ""}`} aoFechar={aoFechar} largura="larga">
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : r.dados && (
        r.dados.itens.length === 0 ? <Vazio titulo="A pasta está vazia." /> : (
          <>
            {r.dados.pasta && <p className="texto-fraco">Pasta do Drive: <strong>{r.dados.pasta}</strong> · {r.dados.itens.length} arquivo(s)</p>}
            {[...grupos].map(([caminho, itens]) => (
              <section key={caminho || "raiz"} aria-label={caminho || "Pasta principal"}>
                {caminho && <h3 className="frota-drive__pasta">{caminho}</h3>}
                <ul className="frota-drive">
                  {itens.map((i) => (
                    <li key={i.id}>
                      <span className="frota-drive__nome">{i.nome}<span className="texto-fraco"> · {tipoLegivel(i.tipo)}{i.tamanho ? ` · ${tamanhoLegivel(i.tamanho)}` : ""}</span></span>
                      <span className="frota-acoes">
                        <a className="botao botao--secundario botao--pequeno" href={`${base}/${i.id}`} target="_blank" rel="noopener noreferrer">Abrir</a>
                        <a className="botao botao--secundario botao--pequeno" href={`${base}/${i.id}?baixar=1`}><Icone nome="baixar" /> Baixar</a>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )
      )}
    </Modal>
  );
}
