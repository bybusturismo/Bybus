import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { VerPublica } from "../../componentes/VerPublica";
import { formatarData, formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { OrcamentoPublico } from "../publico/OrcamentoPublico";

const STATUS: Record<string, string> = { NOVO: "Novo", EM_CONTATO: "Em contato", PROPOSTA_ENVIADA: "Proposta enviada", FECHADO: "Fechado", PERDIDO: "Perdido" };
const TOM: Record<string, string> = { NOVO: "etiqueta--perigo", EM_CONTATO: "etiqueta--atencao", PROPOSTA_ENVIADA: "etiqueta--info", FECHADO: "etiqueta--sucesso", PERDIDO: "etiqueta--neutra" };
const TIPO: Record<string, string> = { ESCOLA: "Escola", EMPRESA: "Empresa", EXCURSAO: "Excursão", EVENTO: "Evento", OUTRO: "Outro" };
interface Pedido {
  id: string; protocolo: string; nome: string; organizacao: string; tipoGrupo: string; telefone: string | null; email: string | null; contatosOcultos: boolean; dataPretendida: string | null; pessoas: number; servico: string;
  cidadeOrigem: string | null; mensagem: string | null; utmSource: string | null; utmCampaign: string | null; status: string; responsavelId: string | null; responsavel: string | null; anotacoes: string | null; anonimizado: boolean; criadoEm: string;
}
interface Resp { id: string; nome: string }

function Detalhe({ p, responsaveis, aoSalvar, aoCancelar }: { p: Pedido; responsaveis: Resp[]; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [status, setStatus] = useState(p.status);
  const [resp, setResp] = useState(p.responsavelId ?? "");
  const [notas, setNotas] = useState(p.anotacoes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    try { await api.patch(`/api/orcamentos/${p.id}`, { status, responsavelId: resp || null, ...(p.anonimizado ? {} : { anotacoes: notas.trim() || null }) }); await aoSalvar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p><strong>{p.organizacao}</strong> · {TIPO[p.tipoGrupo]} · {p.pessoas} pessoas · protocolo {p.protocolo}</p>
      <p>{p.nome}{p.telefone ? ` · ${p.telefone}` : ""}{p.email ? ` · ${p.email}` : ""}{p.contatosOcultos && <span className="texto-fraco"> (contatos visíveis só para quem pode ver contatos)</span>}</p>
      <p>Serviço: {p.servico}{p.dataPretendida ? ` · data ${formatarData(p.dataPretendida)}` : ""}{p.cidadeOrigem ? ` · de ${p.cidadeOrigem}` : ""}</p>
      {p.mensagem && <p className="texto-copiavel">{p.mensagem}</p>}
      {p.utmSource && <p className="texto-fraco">Origem: {p.utmSource}{p.utmCampaign ? ` / ${p.utmCampaign}` : ""}</p>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="oc-st">Situação</label><select id="oc-st" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="campo"><label htmlFor="oc-rs">Responsável</label><select id="oc-rs" value={resp} onChange={(e) => setResp(e.target.value)}><option value="">Sem responsável</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</select></div>
      </div>
      <div className="campo"><label htmlFor="oc-an">Anotações</label><textarea id="oc-an" rows={4} maxLength={3000} disabled={p.anonimizado} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button><button type="submit" className="botao botao--primario">Salvar</button></div>
    </form>
  );
}

/** Orçamentos de grupos (área Reservas): pedidos que chegam pela página pública /orcamento. */
export function Orcamentos() {
  const notificar = useNotificar();
  const [filtro, setFiltro] = useState("");
  const r = useCarregar((s) => api.get<Pedido[]>(`/api/orcamentos${filtro ? `?status=${filtro}` : ""}`, s), [filtro]);
  const resp = useCarregar((s) => api.get<Resp[]>("/api/orcamentos/responsaveis", s), []);
  const [aberto, setAberto] = useState<Pedido | null>(null);
  const [anonimizar, setAnonimizar] = useState<Pedido | null>(null);
  const novos = (r.dados ?? []).filter((p) => p.status === "NOVO").length;

  async function confirmar() {
    if (!anonimizar) return;
    try { await api.post(`/api/orcamentos/${anonimizar.id}/anonimizar`, {}); notificar("Dados pessoais apagados."); setAnonimizar(null); await r.recarregar(); } catch (x) { notificar(mensagemDeErro(x), "erro"); }
  }
  return (
    <div className="pagina">
      <CabecalhoPagina titulo={<>Orçamentos de grupos {novos > 0 && <span className="m2-aviso-contador" aria-label={`${novos} novo(s)`}>{novos}</span>}</>}
        descricao="Pedidos de escolas, empresas, excursões e eventos vindos da página pública. Acompanhe o contato, a proposta e o resultado."
        filtros={<div className="campo campo--linha"><label htmlFor="oc-f">Situação</label><select id="oc-f" value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Todas</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
        acoes={<VerPublica titulo="Página pública /orcamento" caminho="/orcamento"><OrcamentoPublico incorporado /></VerPublica>} />
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : r.dados && r.dados.length === 0 ? <Vazio titulo="Nenhum pedido de orçamento.">Divulgue o endereço /orcamento para escolas, empresas e excursões.</Vazio> : r.dados ? (
        <div className="tabela-rolagem"><table className="tabela">
          <thead><tr><th>Pedido</th><th>Grupo</th><th>Data pretendida</th><th>Situação</th><th>Responsável</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
          <tbody>{r.dados.map((p) => (
            <tr key={p.id}><td className="sem-quebra">{formatarDataHora(p.criadoEm)}<div className="texto-fraco">{p.protocolo}{p.utmSource ? ` · ${p.utmSource}` : ""}</div></td>
              <td><strong>{p.organizacao}</strong><div className="texto-fraco">{TIPO[p.tipoGrupo]} · {p.pessoas} pessoas · {p.servico}</div></td>
              <td>{p.dataPretendida ? formatarData(p.dataPretendida) : "—"}</td>
              <td><span className={`etiqueta ${TOM[p.status]}`}>{STATUS[p.status]}</span></td><td>{p.responsavel ?? "—"}</td>
              <td className="sem-quebra"><button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAberto(p)}>Abrir</button>{!p.anonimizado && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setAnonimizar(p)}>Anonimizar</button>}</td></tr>))}</tbody>
        </table></div>
      ) : null}
      <Modal aberto={!!aberto} titulo="Pedido de orçamento" aoFechar={() => setAberto(null)} largura="larga">
        {aberto && <Detalhe p={aberto} responsaveis={resp.dados ?? []} aoCancelar={() => setAberto(null)} aoSalvar={async () => { setAberto(null); notificar("Pedido atualizado."); await r.recarregar(); }} />}
      </Modal>
      <Confirmar aberto={!!anonimizar} titulo="Anonimizar pedido" perigo textoConfirmar="Apagar dados pessoais" aoFechar={() => setAnonimizar(null)} aoConfirmar={() => void confirmar()}
        mensagem={<>Nome, contatos, mensagem e anotações do pedido de <strong>{anonimizar?.organizacao}</strong> serão apagados (LGPD). A ação fica na auditoria e não pode ser desfeita.</>} />
    </div>
  );
}
