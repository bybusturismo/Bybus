import { useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { LINHAS_NEGOCIO, type LinhaNegocio } from "../../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso } from "../../util/formato";
import { ROTULO_LINHA } from "../../util/rotulos";
import { useAtraso } from "../../util/useAtraso";
import { useCarregar } from "../../util/useCarregar";
import { useCategorias, useContas } from "./dados";
import type { CategoriaFin, ContaFin, LinhaExtratoFin, PreviaImportacao, RespostaLinhas, StatusLinha, SugestaoConc } from "./tipos";
import { decodificarArquivo, ROTULO_TIPO_CONTA } from "./util";

const ROTULO_STATUS: Record<StatusLinha, string> = { PENDENTE: "Pendente", CONCILIADO: "Conciliada", TRANSFERENCIA: "Transferência", IGNORADO: "Ignorada" };
const CLASSE_STATUS: Record<StatusLinha, string> = { PENDENTE: "etiqueta--atencao", CONCILIADO: "etiqueta--sucesso", TRANSFERENCIA: "etiqueta--neutra", IGNORADO: "etiqueta--neutra" };

/** Importa OFX ou CSV de uma conta: lê o arquivo, mostra a prévia (nada é gravado) e só grava ao confirmar. */
export function ImportadorExtrato({ conta, aoImportar }: { conta: ContaFin; aoImportar: () => void }) {
  const notificar = useNotificar();
  const [arquivo, setArquivo] = useState<{ nome: string; formato: "OFX" | "CSV"; conteudo: string } | null>(null);
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function escolher(f: File | undefined) {
    setErro(null);
    setPrevia(null);
    setArquivo(null);
    if (!f) return;
    const nome = f.name;
    const formato = /\.(ofx|qfx)$/i.test(nome) ? "OFX" : /\.(csv|txt)$/i.test(nome) ? "CSV" : null;
    if (!formato) return setErro("Escolha um arquivo .ofx ou .csv.");
    if (f.size > 5_000_000) return setErro("Arquivo grande demais (máximo 5 MB). Exporte um período menor.");
    setOcupado(true);
    try {
      const conteudo = decodificarArquivo(await f.arrayBuffer());
      const a = { nome, formato, conteudo } as const;
      setArquivo(a);
      setPrevia(await api.post<PreviaImportacao>("/api/financeiro/extratos/importar", { contaId: conta.id, formato, conteudo, arquivo: nome, confirmar: false }));
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<PreviaImportacao>("/api/financeiro/extratos/importar", { contaId: conta.id, formato: arquivo.formato, conteudo: arquivo.conteudo, arquivo: arquivo.nome, confirmar: true, previaId: previa?.previaId });
      notificar(`${r.novas} lançamento(s) importado(s); ${r.repetidas} já existiam.`);
      setArquivo(null);
      setPrevia(null);
      aoImportar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby="titulo-importar">
      <h2 id="titulo-importar">{conta.tipo === "CARTAO" ? "Importar fatura" : "Importar extrato"} — {conta.nome}</h2>
      <p className="texto-fraco">
        Arquivo OFX do banco ou CSV simples (colunas Data, Descrição e Valor, ou Crédito e Débito).{conta.tipo === "CARTAO" ? " No CSV de fatura, compras positivas viram saídas." : ""} Linhas repetidas são ignoradas, então reimportar o mesmo período é seguro. PDF ainda não é aceito.
      </p>
      <div className="campo">
        <label htmlFor="arquivo-extrato">Arquivo</label>
        <input id="arquivo-extrato" type="file" accept=".ofx,.qfx,.csv,.txt" disabled={ocupado} onChange={(e) => void escolher(e.target.files?.[0])} />
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {previa && (
        <div>
          {previa.avisos.map((a) => <Aviso key={a} tipo="atencao">{a}</Aviso>)}
          <p>
            <strong>{previa.novas}</strong> nova(s) · {previa.repetidas} já existente(s) · {previa.total} no arquivo
            {previa.inicio && previa.fim ? ` (${formatarData(previa.inicio)} a ${formatarData(previa.fim)})` : ""}
          </p>
          {previa.amostra && previa.amostra.length > 0 && (
            <ul className="fin-lista">
              {previa.amostra.map((l, i) => <li key={i}><span>{formatarData(l.data)} · {l.descricao}</span><span className={`fin-valor ${l.valorCentavos < 0 ? "fin-valor--saida" : "fin-valor--entrada"}`}>{formatarMoeda(l.valorCentavos)}</span></li>)}
            </ul>
          )}
          <div className="modal__acoes">
            <button type="button" className="botao botao--secundario" onClick={() => { setPrevia(null); setArquivo(null); }}>Cancelar</button>
            <button type="button" className="botao botao--primario" disabled={ocupado || previa.novas === 0} onClick={() => void confirmar()}>Importar {previa.novas} lançamento(s)</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function FormTransferencia({ contas, origemInicial, destinoInicial, valorInicial, aoConcluir, aoCancelar }: {
  contas: ContaFin[]; origemInicial?: string; destinoInicial?: string; valorInicial?: string; aoConcluir: () => Promise<void>; aoCancelar: () => void;
}) {
  const ativas = contas.filter((c) => c.ativa);
  const [origem, setOrigem] = useState(origemInicial ?? "");
  const [destino, setDestino] = useState(destinoInicial ?? "");
  const [valor, setValor] = useState(valorInicial ?? "");
  const [data, setData] = useState(hojeIso());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const v = centavosDeTexto(valor);
    if (!origem || !destino) return setErro("Escolha as duas contas.");
    if (origem === destino) return setErro("Escolha contas diferentes.");
    if (v === null || Number.isNaN(v) || v <= 0) return setErro("Informe o valor em reais (ex.: 1.234,56).");
    setSalvando(true);
    try {
      await api.post("/api/financeiro/transferencias", { contaOrigemId: origem, contaDestinoId: destino, valorCentavos: v, data });
      await aoConcluir();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar}>
      <p className="texto-fraco">Movimenta saldo entre contas (ex.: pagar a fatura do cartão, depósito do caixa). Não conta como receita nem despesa.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo"><label htmlFor="tr-origem">Sai da conta</label><select id="tr-origem" value={origem} onChange={(e) => setOrigem(e.target.value)}><option value="">Escolha…</option>{ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="tr-destino">Entra na conta</label><select id="tr-destino" value={destino} onChange={(e) => setDestino(e.target.value)}><option value="">Escolha…</option>{ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="tr-valor">Valor (R$)</label><input id="tr-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></div>
        <div className="campo"><label htmlFor="tr-data">Data</label><input id="tr-data" type="date" max={hojeIso()} value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Registrar transferência"}</button>
      </div>
    </form>
  );
}

function FormLancar({ linha, categorias, aoConcluir, aoCancelar }: { linha: LinhaExtratoFin; categorias: CategoriaFin[]; aoConcluir: () => Promise<void>; aoCancelar: () => void }) {
  const { unidades, praca, usuario } = useSessao();
  const saida = linha.valorCentavos < 0;
  const cats = categorias.filter((c) => c.ativa && c.tipo === (saida ? "DESPESA" : "RECEITA"));
  const [categoriaId, setCategoriaId] = useState(linha.categoriaSugerida?.categoriaId ?? "");
  const [unidadeId, setUnidadeId] = useState(linha.categoriaSugerida?.unidadeId ?? (praca || ""));
  const [linhaNeg, setLinhaNeg] = useState<string>(linha.categoriaSugerida?.linha ?? "");
  const [veiculo, setVeiculo] = useState("");
  const [descricao, setDescricao] = useState(linha.descricao);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!categoriaId) return setErro("Escolha a categoria.");
    setSalvando(true);
    try {
      await api.post(`/api/financeiro/extrato/linhas/${linha.id}/lancar`, { categoriaId, descricao: descricao.trim() || null, unidadeId: unidadeId || undefined, linha: (linhaNeg || null) as LinhaNegocio | null, veiculo: veiculo.trim() || null });
      await aoConcluir();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <form onSubmit={salvar}>
      <p>{formatarData(linha.data)} · <strong className={saida ? "fin-valor--saida" : "fin-valor--entrada"}>{formatarMoeda(linha.valorCentavos)}</strong></p>
      {linha.categoriaSugerida && <Aviso tipo="info">Sugestão por regra: {linha.categoriaSugerida.categoriaNome}. Confira antes de lançar.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="lc-desc">Descrição</label><input id="lc-desc" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} /></div>
        <div className="campo"><label htmlFor="lc-cat">Categoria</label><select id="lc-cat" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}><option value="">Escolha…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="lc-praca">Praça</label><select id="lc-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}><option value="">{usuario?.todasUnidades ? "Praça da conta" : "Escolha…"}</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></div>
        <div className="campo"><label htmlFor="lc-linha">Linha de negócio</label><select id="lc-linha" value={linhaNeg} onChange={(e) => setLinhaNeg(e.target.value)}><option value="">Sem linha</option>{LINHAS_NEGOCIO.map((l) => <option key={l} value={l}>{ROTULO_LINHA[l]}</option>)}</select></div>
        <div className="campo"><label htmlFor="lc-veiculo">Veículo (placa)</label><input id="lc-veiculo" value={veiculo} maxLength={10} onChange={(e) => setVeiculo(e.target.value.toUpperCase())} placeholder="Opcional" /></div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Lançando…" : "Lançar e conciliar"}</button>
      </div>
    </form>
  );
}

/** Painel de linhas de uma conta: sugestões (confirmar ou recusar), lançar, transferência, ignorar e desfazer. Nada concilia sozinho. */
export function PainelLinhas({ conta, versao }: { conta: ContaFin; versao: number }) {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const categorias = useCategorias();
  const [status, setStatus] = useState<StatusLinha | "">("PENDENTE");
  const [texto, setTexto] = useState("");
  const busca = useAtraso(texto.trim(), 300);
  // A página pertence ao filtro: mudou a conta, a situação ou a busca, volta à 1ª sem efeito extra (uma só requisição).
  const chaveFiltro = `${conta.id}|${status}|${busca}`;
  const [pag, setPag] = useState({ chave: "", n: 1 });
  const pagina = pag.chave === chaveFiltro ? pag.n : 1;
  const setPagina = (n: number) => setPag({ chave: chaveFiltro, n });
  const [erro, setErro] = useState<string | null>(null);
  const [lancando, setLancando] = useState<LinhaExtratoFin | null>(null);
  const [diferenca, setDiferenca] = useState<{ linha: LinhaExtratoFin; sugestao: SugestaoConc } | null>(null);
  const [destinoDiferenca, setDestinoDiferenca] = useState("");

  const r = useCarregar((s) => api.get<RespostaLinhas>(`/api/financeiro/extrato/linhas${qs({ contaId: conta.id, status, q: busca, pagina, limite: 50 })}`, s), [conta.id, status, busca, pagina, versao]);
  const d = r.dados;

  async function agir(caminho: string, corpo: unknown, msg: string) {
    setErro(null);
    try {
      await api.post(caminho, corpo ?? {});
      notificar(msg);
      setDiferenca(null);
      await r.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  function confirmar(linha: LinhaExtratoFin, s: SugestaoConc) {
    if (s.diferencaCentavos !== 0) {
      setDestinoDiferenca("");
      setDiferenca({ linha, sugestao: s });
      return;
    }
    void agir(`/api/financeiro/extrato/linhas/${linha.id}/conciliar`, { lancamentoId: s.lancamentoId }, "Conciliado.");
  }

  const abas: Array<[StatusLinha | "", string]> = [["PENDENTE", "Pendentes"], ["CONCILIADO", "Conciliadas"], ["TRANSFERENCIA", "Transferências"], ["IGNORADO", "Ignoradas"], ["", "Todas"]];

  return (
    <section className="cartao" aria-labelledby="titulo-linhas">
      <h2 id="titulo-linhas">Linhas de {conta.nome}</h2>
      <div className="abas" role="group" aria-label="Situação das linhas">
        {abas.map(([v, rotulo]) => (
          <button key={rotulo} type="button" className={`aba${status === v ? " aba--ativa" : ""}`} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {rotulo}{v && d?.porStatus[v] !== undefined ? ` (${d.porStatus[v]})` : ""}
          </button>
        ))}
      </div>
      <div className="barra-ferramentas">
        <div className="campo campo--busca"><label htmlFor="busca-linhas" className="fin-oculto-visual">Buscar</label><input id="busca-linhas" type="search" placeholder="Buscar na descrição" value={texto} onChange={(e) => setTexto(e.target.value)} /></div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && (d.linhas.length === 0 ? <Vazio titulo={status === "PENDENTE" ? "Nada pendente nesta conta." : "Nenhuma linha neste filtro."} /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col" className="fin-valor">Valor</th><th scope="col">Situação e ações</th></tr></thead>
            <tbody>
              {d.linhas.map((l) => (
                <tr key={l.id}>
                  <td className="sem-quebra">{formatarData(l.data)}</td>
                  <td>{l.descricao || <span className="texto-fraco">(sem descrição)</span>}{l.manual && <span className="etiqueta etiqueta--neutra">manual</span>}{l.documento && <div className="texto-fraco">Doc. {l.documento}</div>}</td>
                  <td className={`fin-valor ${l.valorCentavos < 0 ? "fin-valor--saida" : "fin-valor--entrada"}`}>{formatarMoeda(l.valorCentavos)}</td>
                  <td>
                    <span className={`etiqueta ${CLASSE_STATUS[l.status]}`}>{ROTULO_STATUS[l.status]}</span>
                    {l.lancamentoDescricao && <span className="texto-fraco"> {l.lancamentoDescricao}</span>}
                    {l.status === "PENDENTE" && podeEditar && (
                      <>
                        {(l.sugestoes ?? []).map((s) => (
                          <div key={s.lancamentoId} className="fin-sugestao">
                            <span className="fin-sugestao__texto">
                              Sugestão ({s.nivel === "ALTA" ? "alta" : s.nivel === "MEDIA" ? "média" : "baixa"} confiança): <strong>{s.lancamento.descricao}</strong> · {formatarMoeda(s.lancamento.valorCentavos)} · venc. {formatarData(s.lancamento.vencimento)}
                              {s.diferencaCentavos !== 0 && <> · diferença de {formatarMoeda(Math.abs(s.diferencaCentavos))}</>}
                              <span className="texto-fraco"> ({s.motivos.join(", ")})</span>
                            </span>
                            <button type="button" className="botao botao--pequeno botao--primario" onClick={() => confirmar(l, s)}>Confirmar</button>
                            <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => void agir(`/api/financeiro/extrato/linhas/${l.id}/recusar`, { lancamentoId: s.lancamentoId }, "Sugestão recusada.")}>Recusar</button>
                          </div>
                        ))}
                        {(l.pares ?? []).map((p) => (
                          <div key={p.id} className="fin-sugestao">
                            <span className="fin-sugestao__texto">Parece transferência com <strong>{p.contaNome}</strong> ({formatarData(p.data)}: {p.descricao})</span>
                            <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => void agir(`/api/financeiro/extrato/linhas/${l.id}/transferencia`, { parLinhaId: p.id }, "Transferência registrada.")}>Marcar transferência</button>
                          </div>
                        ))}
                        <div className="fin-acoes">
                          <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => setLancando(l)}>Lançar{l.categoriaSugerida ? ` (${l.categoriaSugerida.categoriaNome})` : ""}</button>
                          <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void agir(`/api/financeiro/extrato/linhas/${l.id}/ignorar`, {}, "Linha ignorada.")}>Ignorar</button>
                        </div>
                      </>
                    )}
                    {l.status !== "PENDENTE" && podeEditar && (
                      <div className="fin-acoes"><button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void agir(`/api/financeiro/extrato/linhas/${l.id}/desfazer`, {}, "Decisão desfeita.")}>Desfazer</button></div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.total > 50 && (
            <nav className="paginacao" aria-label="Paginação">
              <button type="button" className="botao botao--secundario botao--pequeno" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
              <span>Página {pagina} de {Math.ceil(d.total / 50)} · {d.total} linhas</span>
              <button type="button" className="botao botao--secundario botao--pequeno" disabled={pagina >= Math.ceil(d.total / 50)} onClick={() => setPagina(pagina + 1)}>Próxima →</button>
            </nav>
          )}
        </div>
      ))}

      <Modal aberto={lancando !== null} titulo="Lançar a partir do extrato" aoFechar={() => setLancando(null)} largura="larga">
        {lancando && categorias.dados && <FormLancar linha={lancando} categorias={categorias.dados} aoConcluir={async () => { setLancando(null); notificar("Lançado e conciliado."); await r.recarregar(); }} aoCancelar={() => setLancando(null)} />}
      </Modal>
      <Modal aberto={diferenca !== null} titulo="Valores diferentes" aoFechar={() => setDiferenca(null)}>
        {diferenca && (
          <div>
            <p>
              A linha tem {formatarMoeda(Math.abs(diferenca.linha.valorCentavos))} e o lançamento, {formatarMoeda(diferenca.sugestao.lancamento.valorCentavos)}. A diferença de <strong>{formatarMoeda(Math.abs(diferenca.sugestao.diferencaCentavos))}</strong> precisa de um destino explícito.
            </p>
            <div className="campo">
              <label htmlFor="dif-destino">A diferença é</label>
              <select id="dif-destino" value={destinoDiferenca} onChange={(e) => setDestinoDiferenca(e.target.value)}>
                <option value="">Escolha…</option>
                {diferenca.sugestao.diferencaCentavos > 0 ? <><option value="JUROS">Juros</option><option value="MULTA">Multa</option></> : <option value="DESCONTO">Desconto</option>}
              </select>
            </div>
            <div className="modal__acoes">
              <button type="button" className="botao botao--secundario" onClick={() => setDiferenca(null)}>Cancelar</button>
              <button type="button" className="botao botao--primario" disabled={!destinoDiferenca} onClick={() => void agir(`/api/financeiro/extrato/linhas/${diferenca.linha.id}/conciliar`, { lancamentoId: diferenca.sugestao.lancamentoId, diferenca: destinoDiferenca }, "Conciliado.")}>Conciliar</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

export function Extrato() {
  const { pode } = useSessao();
  const contas = useContas();
  const [contaId, setContaId] = useState("");
  const [versao, setVersao] = useState(0);
  const [transferindo, setTransferindo] = useState(false);
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const comExtrato = (contas.dados ?? []).filter((c) => c.ativa && c.tipo !== "CAIXA");
  const conta = comExtrato.find((c) => c.id === contaId) ?? comExtrato[0] ?? null;

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Extrato e conciliação</h1>
          <p className="pagina__descricao">Importe o extrato, confira as sugestões e decida linha a linha. O sistema só sugere: nada é conciliado sem a sua confirmação.</p>
        </div>
        {podeEditar && <div className="barra-acoes"><button type="button" className="botao botao--secundario" onClick={() => setTransferindo(true)}>Transferência entre contas</button></div>}
      </div>
      {contas.carregando && !contas.dados ? <Carregando /> : contas.erro ? <ErroCarga mensagem={contas.erro} tentarDeNovo={contas.recarregar} /> : !conta ? (
        <Vazio titulo="Cadastre uma conta (corrente, aplicação ou cartão) em “Contas e categorias” para importar extratos." />
      ) : (
        <>
          <div className="filtros">
            <div className="campo campo--linha">
              <label htmlFor="extrato-conta">Conta</label>
              <select id="extrato-conta" value={conta.id} onChange={(e) => setContaId(e.target.value)}>
                {comExtrato.map((c) => <option key={c.id} value={c.id}>{c.nome} — {ROTULO_TIPO_CONTA[c.tipo]}{c.linhasPendentes ? ` (${c.linhasPendentes} pendentes)` : ""}</option>)}
              </select>
            </div>
            <span>Saldo: <strong className={`fin-valor ${conta.saldoCentavos < 0 ? "fin-valor--saida" : ""}`}>{formatarMoeda(conta.saldoCentavos)}</strong></span>
          </div>
          {podeEditar && <ImportadorExtrato key={`importar-${conta.id}`} conta={conta} aoImportar={() => { setVersao((v) => v + 1); void contas.recarregar(); }} />}
          <PainelLinhas key={`linhas-${conta.id}`} conta={conta} versao={versao} />
        </>
      )}
      <Modal aberto={transferindo} titulo="Transferência entre contas" aoFechar={() => setTransferindo(false)}>
        {transferindo && contas.dados && <FormTransferencia contas={contas.dados} aoConcluir={async () => { setTransferindo(false); notificar("Transferência registrada."); setVersao((v) => v + 1); await contas.recarregar(); }} aoCancelar={() => setTransferindo(false)} />}
      </Modal>
    </>
  );
}
