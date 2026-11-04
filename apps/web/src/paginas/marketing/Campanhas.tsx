import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, formatarNumero, textoDeCentavos } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { nomeMes, ROTULO_MIDIA } from "./comum";

interface Resultado { id: string; mes: string; reservas: number; passageiros: number; receitaCentavos: number | null; fonte: string }
interface Campanha {
  id: string; unidadeId: string | null; nome: string; midia: string; inicio: string; fim: string | null; investimentoCentavos: number;
  cupom: string | null; utmCampanha: string | null; metaReservas: number | null; observacoes: string | null; ativa: boolean;
  resultados: Resultado[];
  totais: { reservas: number; passageiros: number; receitaCentavos: number | null };
  indicadores: { temAtribuicao: boolean; custoPorReservaCentavos: number | null; custoPorPassageiroCentavos: number | null; retorno: number | null; atingimentoMeta: number | null };
}
interface Resposta { atribuicao: { situacao: string; nota: string }; campanhas: Campanha[]; totais: { investimentoCentavos: number; reservasAtribuidas: number } }

function inteiro(v: string, min: number, max: number): number | null {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function FormCampanha({ campanha, aoSalvar, aoCancelar }: { campanha: Campanha | null; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const { unidades, praca, usuario } = useSessao();
  const todas = !!usuario?.todasUnidades;
  const [nome, setNome] = useState(campanha?.nome ?? "");
  const [midia, setMidia] = useState(campanha?.midia ?? "GOOGLE_ADS");
  const [unidadeId, setUnidadeId] = useState(campanha ? (campanha.unidadeId ?? "") : (praca || (todas ? "" : (unidades[0]?.id ?? ""))));
  const [inicio, setInicio] = useState(campanha?.inicio ?? "");
  const [fim, setFim] = useState(campanha?.fim ?? "");
  const [investimento, setInvestimento] = useState(textoDeCentavos(campanha?.investimentoCentavos ?? 0));
  const [cupom, setCupom] = useState(campanha?.cupom ?? "");
  const [utm, setUtm] = useState(campanha?.utmCampanha ?? "");
  const [meta, setMeta] = useState(campanha?.metaReservas ? String(campanha.metaReservas) : "");
  const [obs, setObs] = useState(campanha?.observacoes ?? "");
  const [ativa, setAtiva] = useState(campanha?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const centavos = centavosDeTexto(investimento || "0");
    if (nome.trim().length < 2) return setErro("Informe o nome da campanha.");
    if (!inicio) return setErro("Informe a data de início.");
    if (fim && fim < inicio) return setErro("O fim deve ser igual ou posterior ao início.");
    if (centavos === null || Number.isNaN(centavos)) return setErro("Investimento inválido. Exemplo: 1.500,00");
    const metaN = meta.trim() ? inteiro(meta, 1, 1_000_000) : null;
    if (meta.trim() && metaN === null) return setErro("Meta: número inteiro de reservas.");
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), midia, unidadeId: unidadeId || null, inicio, fim: fim || null, investimentoCentavos: centavos, cupom: cupom.trim() || null, utmCampanha: utm.trim() || null, metaReservas: metaN, observacoes: obs.trim() || null, ativa };
      if (campanha) await api.patch(`/api/marketing/campanhas/${campanha.id}`, corpo);
      else await api.post("/api/marketing/campanhas", corpo);
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="cp-nome">Nome</label><input id="cp-nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></div>
        <div className="campo">
          <label htmlFor="cp-midia">Mídia</label>
          <select id="cp-midia" value={midia} onChange={(e) => setMidia(e.target.value)}>{Object.entries(ROTULO_MIDIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </div>
        <div className="campo">
          <label htmlFor="cp-praca">Praça</label>
          <select id="cp-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {todas && <option value="">Todas as praças</option>}
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="cp-inicio">Início</label><input id="cp-inicio" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cp-fim">Fim (opcional)</label><input id="cp-fim" type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cp-inv">Investimento (R$)</label><input id="cp-inv" inputMode="decimal" value={investimento} onChange={(e) => setInvestimento(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cp-meta">Meta de reservas</label><input id="cp-meta" inputMode="numeric" value={meta} onChange={(e) => setMeta(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cp-cupom">Cupom</label><input id="cp-cupom" value={cupom} maxLength={40} onChange={(e) => setCupom(e.target.value)} /></div>
        <div className="campo"><label htmlFor="cp-utm">UTM da campanha</label><input id="cp-utm" value={utm} maxLength={80} onChange={(e) => setUtm(e.target.value)} /></div>
        <div className="campo campo--largo"><label htmlFor="cp-obs">Observações</label><textarea id="cp-obs" rows={3} value={obs} maxLength={1000} onChange={(e) => setObs(e.target.value)} /></div>
      </div>
      <label className="interruptor"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Campanha ativa</label>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : campanha ? "Salvar campanha" : "Criar campanha"}</button>
      </div>
    </form>
  );
}

function Resultados({ campanha, aoMudar }: { campanha: Campanha; aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [mes, setMes] = useState("");
  const [reservas, setReservas] = useState("");
  const [passageiros, setPassageiros] = useState("");
  const [receita, setReceita] = useState("");
  const [fonte, setFonte] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const r = inteiro(reservas, 0, 1_000_000);
    const p = inteiro(passageiros, 0, 1_000_000);
    const rc = receita.trim() ? centavosDeTexto(receita) : null;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return setErro("Escolha o mês.");
    if (r === null || p === null) return setErro("Reservas e passageiros: números inteiros.");
    if (rc !== null && Number.isNaN(rc)) return setErro("Receita inválida. Exemplo: 3.500,00");
    if (fonte.trim().length < 2) return setErro("Diga de onde veio o número (ex.: relatório do cupom na Paytour).");
    setSalvando(true);
    try {
      await api.post(`/api/marketing/campanhas/${campanha.id}/resultados`, { mes, reservas: r, passageiros: p, receitaCentavos: rc, fonte: fonte.trim() });
      notificar("Resultado lançado.");
      setReservas(""); setPassageiros(""); setReceita("");
      await aoMudar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  async function remover(m: string) {
    try {
      await api.delete(`/api/marketing/campanhas/${campanha.id}/resultados/${m}`);
      await aoMudar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <div>
      <Aviso tipo="info">Fonte da atribuição a confirmar: por enquanto o resultado de cada mês é lançado à mão, a partir do relatório de cupom/UTM.</Aviso>
      {campanha.resultados.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Mês</th><th className="num">Reservas</th><th className="num">Passageiros</th><th className="num">Receita</th><th>Fonte</th><th><span className="visualmente-oculto">Ações</span></th></tr></thead>
            <tbody>
              {campanha.resultados.map((r) => (
                <tr key={r.id}>
                  <td>{nomeMes(r.mes)}</td><td className="num">{r.reservas}</td><td className="num">{r.passageiros}</td>
                  <td className="num">{r.receitaCentavos == null ? "—" : formatarMoeda(r.receitaCentavos)}</td><td>{r.fonte}</td>
                  <td><button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void remover(r.mes)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={lancar} noValidate>
        <h3>Lançar resultado do mês</h3>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grade-campos">
          <div className="campo"><label htmlFor="rs-mes">Mês</label><input id="rs-mes" type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rs-res">Reservas</label><input id="rs-res" inputMode="numeric" value={reservas} onChange={(e) => setReservas(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rs-pax">Passageiros</label><input id="rs-pax" inputMode="numeric" value={passageiros} onChange={(e) => setPassageiros(e.target.value)} /></div>
          <div className="campo"><label htmlFor="rs-rec">Receita (R$, opcional)</label><input id="rs-rec" inputMode="decimal" value={receita} onChange={(e) => setReceita(e.target.value)} /></div>
          <div className="campo campo--largo"><label htmlFor="rs-fonte">Fonte do número</label><input id="rs-fonte" value={fonte} maxLength={120} onChange={(e) => setFonte(e.target.value)} /></div>
        </div>
        <div className="modal__acoes"><button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Lançar resultado"}</button></div>
      </form>
    </div>
  );
}

export function Campanhas() {
  const { unidades, pode } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const r = useCarregar((s) => api.get<Resposta>("/api/marketing/campanhas", s), []);
  const [form, setForm] = useState<{ campanha: Campanha | null } | null>(null);
  const [resultadosDe, setResultadosDe] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<Campanha | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const d = r.dados;
  const campanhaResultados = d?.campanhas.find((c) => c.id === resultadosDe) ?? null;

  async function confirmarExclusao() {
    if (!excluir) return;
    setExcluindo(true);
    try {
      await api.delete(`/api/marketing/campanhas/${excluir.id}`);
      notificar("Campanha excluída.");
      setExcluir(null);
      await r.recarregar();
    } catch (x) {
      notificar(mensagemDeErro(x), "erro");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Campanhas e cupons</h1>
          <p className="pagina__descricao">Mídia, período, investimento e meta de cada campanha, com custo × retorno quando houver resultado atribuído.</p>
        </div>
        {podeGerenciar && <button type="button" className="botao botao--primario" onClick={() => setForm({ campanha: null })}><Icone nome="mais" /> Nova campanha</button>}
      </div>
      {d && <Aviso tipo="atencao" titulo="Atribuição a confirmar">{d.atribuicao.nota}</Aviso>}
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && d.campanhas.length === 0 ? (
        <Vazio titulo="Nenhuma campanha cadastrada.">{podeGerenciar ? "Crie a primeira campanha para acompanhar investimento e retorno." : undefined}</Vazio>
      ) : d ? (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr><th>Campanha</th><th>Período</th><th className="num">Investimento</th><th className="num">Reservas atribuídas</th><th className="num">Custo por reserva</th><th className="num">Retorno</th><th><span className="visualmente-oculto">Ações</span></th></tr>
            </thead>
            <tbody>
              {d.campanhas.map((c) => (
                <tr key={c.id} className={c.ativa ? "" : "linha--inativa"}>
                  <td>
                    <strong>{c.nome}</strong>
                    <div className="texto-fraco">{ROTULO_MIDIA[c.midia] ?? c.midia} · {c.unidadeId ? nomePraca(unidades, c.unidadeId) : "Todas as praças"}{c.cupom ? ` · cupom ${c.cupom}` : ""}{!c.ativa ? " · inativa" : ""}</div>
                  </td>
                  <td className="sem-quebra">{formatarData(c.inicio)}{c.fim ? ` a ${formatarData(c.fim)}` : " em diante"}</td>
                  <td className="num">{formatarMoeda(c.investimentoCentavos)}</td>
                  <td className="num">{c.indicadores.temAtribuicao ? `${formatarNumero(c.totais.reservas)}${c.metaReservas ? ` de ${formatarNumero(c.metaReservas)}` : ""}` : <span className="texto-fraco">sem atribuição</span>}</td>
                  <td className="num">{c.indicadores.custoPorReservaCentavos == null ? "—" : formatarMoeda(c.indicadores.custoPorReservaCentavos)}</td>
                  <td className="num">{c.indicadores.retorno == null ? "—" : `${c.indicadores.retorno.toLocaleString("pt-BR")}×`}</td>
                  <td className="sem-quebra">
                    <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setResultadosDe(c.id)}>Resultados</button>
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ campanha: c })}>Editar</button>}
                    {podeGerenciar && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(c)}>Excluir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row" colSpan={2}>Total</th><td className="num">{formatarMoeda(d.totais.investimentoCentavos)}</td><td className="num">{formatarNumero(d.totais.reservasAtribuidas)}</td><td colSpan={3} /></tr>
            </tfoot>
          </table>
        </div>
      ) : null}
      <Modal aberto={!!form} titulo={form?.campanha ? "Editar campanha" : "Nova campanha"} aoFechar={() => setForm(null)} largura="larga">
        {form && <FormCampanha campanha={form.campanha} aoCancelar={() => setForm(null)} aoSalvar={async () => { setForm(null); notificar("Campanha salva."); await r.recarregar(); }} />}
      </Modal>
      <Modal aberto={!!campanhaResultados && podeGerenciar} titulo={campanhaResultados ? `Resultados — ${campanhaResultados.nome}` : "Resultados"} aoFechar={() => setResultadosDe(null)} largura="larga">
        {campanhaResultados && <Resultados campanha={campanhaResultados} aoMudar={r.recarregar} />}
      </Modal>
      <Modal aberto={!!campanhaResultados && !podeGerenciar} titulo={campanhaResultados ? `Resultados — ${campanhaResultados.nome}` : "Resultados"} aoFechar={() => setResultadosDe(null)}>
        {campanhaResultados && (campanhaResultados.resultados.length === 0 ? <p>Nenhum resultado lançado.</p> : (
          <ul>{campanhaResultados.resultados.map((x) => <li key={x.id}>{nomeMes(x.mes)}: {x.reservas} reservas, {x.passageiros} passageiros ({x.fonte})</li>)}</ul>
        ))}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir campanha" perigo ocupado={excluindo} textoConfirmar="Excluir campanha" aoFechar={() => setExcluir(null)} aoConfirmar={() => void confirmarExclusao()}
        mensagem={<>A campanha <strong>{excluir?.nome}</strong> e os resultados lançados nela serão apagados. Esta ação fica registrada na auditoria.</>} />
    </div>
  );
}
