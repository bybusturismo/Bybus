import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import { useCategorias, useContas } from "./dados";
import { TIPOS_CONTA, type CategoriaFin, type ContaFin, type RegraFin, type TipoConta } from "./tipos";
import { Sinonimos } from "./Sinonimos";
import { ROTULO_TIPO_CONTA } from "./util";
import { centavosDeTexto, formatarMoeda, textoDeCentavos } from "../../util/formato";

function FormConta({ conta, contas, aoSalvar, aoCancelar }: { conta: ContaFin | null; contas: ContaFin[]; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const { unidades, praca, usuario } = useSessao();
  const [nome, setNome] = useState(conta?.nome ?? "");
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? "CORRENTE");
  const [unidadeId, setUnidadeId] = useState(conta ? (conta.unidadeId ?? "") : (praca || (unidades.length === 1 ? unidades[0]!.id : "")));
  const [banco, setBanco] = useState(conta?.banco ?? "");
  const [finalConta, setFinalConta] = useState(conta?.finalConta ?? "");
  const [saldo, setSaldo] = useState(textoDeCentavos(conta?.saldoInicialCentavos ?? 0));
  const [saldoEm, setSaldoEm] = useState(conta?.saldoInicialEm ?? "");
  const [fechamento, setFechamento] = useState(String(conta?.diaFechamento ?? ""));
  const [vencimento, setVencimento] = useState(String(conta?.diaVencimento ?? ""));
  const [pagadora, setPagadora] = useState(conta?.contaPagamentoId ?? "");
  const [ativa, setAtiva] = useState(conta?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const saldoC = centavosDeTexto(saldo || "0");
    const dFech = Number(fechamento);
    const dVenc = Number(vencimento);
    if (nome.trim().length < 2) return setErro("Informe o nome da conta.");
    if (!unidadeId && !usuario?.todasUnidades) return setErro("Escolha a praça.");
    if (saldoC === null || Number.isNaN(saldoC)) return setErro("Saldo inicial: valor em reais com até duas casas decimais.");
    if (tipo === "CARTAO" && (!Number.isInteger(dFech) || dFech < 1 || dFech > 31 || !Number.isInteger(dVenc) || dVenc < 1 || dVenc > 31)) return setErro("Cartão: informe o dia de fechamento e o de vencimento (1 a 31).");
    setSalvando(true);
    try {
      const corpo = {
        nome: nome.trim(), tipo, unidadeId: unidadeId || null, banco: banco.trim() || null, finalConta: finalConta.trim() || null,
        saldoInicialCentavos: saldoC, saldoInicialEm: saldoEm || null,
        diaFechamento: tipo === "CARTAO" ? dFech : null, diaVencimento: tipo === "CARTAO" ? dVenc : null, contaPagamentoId: tipo === "CARTAO" ? (pagadora || null) : null, ativa,
      };
      if (conta) await api.patch(`/api/financeiro/contas/${conta.id}`, corpo);
      else await api.post("/api/financeiro/contas", corpo);
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo campo--largo"><label htmlFor="ct-nome">Nome</label><input id="ct-nome" value={nome} maxLength={100} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Sicoob corrente, Caixa do quiosque" /></div>
        <div className="campo">
          <label htmlFor="ct-tipo">Tipo</label>
          <select id="ct-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoConta)}>{TIPOS_CONTA.map((t) => <option key={t} value={t}>{ROTULO_TIPO_CONTA[t]}</option>)}</select>
        </div>
        <div className="campo">
          <label htmlFor="ct-praca">Praça</label>
          <select id="ct-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">{usuario?.todasUnidades ? "Empresa toda" : "Escolha…"}</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        {tipo !== "CAIXA" && <div className="campo"><label htmlFor="ct-banco">Banco ou emissor</label><input id="ct-banco" value={banco} maxLength={60} onChange={(e) => setBanco(e.target.value)} /></div>}
        {tipo !== "CAIXA" && <div className="campo"><label htmlFor="ct-final">Final da conta ou cartão</label><input id="ct-final" value={finalConta} maxLength={8} onChange={(e) => setFinalConta(e.target.value)} placeholder="Só os últimos dígitos" /></div>}
        <div className="campo"><label htmlFor="ct-saldo">Saldo inicial (R$)</label><input id="ct-saldo" inputMode="decimal" value={saldo} onChange={(e) => setSaldo(e.target.value)} /></div>
        <div className="campo"><label htmlFor="ct-saldo-em">Saldo inicial no início de</label><input id="ct-saldo-em" type="date" value={saldoEm} onChange={(e) => setSaldoEm(e.target.value)} /><span className="campo__ajuda">O saldo inicial vale no começo deste dia: movimentos desta data em diante entram no saldo.</span></div>
        {tipo === "CARTAO" && (
          <>
            <div className="campo"><label htmlFor="ct-fech">Dia do fechamento</label><input id="ct-fech" inputMode="numeric" value={fechamento} onChange={(e) => setFechamento(e.target.value)} /></div>
            <div className="campo"><label htmlFor="ct-venc">Dia do vencimento</label><input id="ct-venc" inputMode="numeric" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></div>
            <div className="campo">
              <label htmlFor="ct-pagadora">Conta que paga a fatura</label>
              <select id="ct-pagadora" value={pagadora} onChange={(e) => setPagadora(e.target.value)}><option value="">Não definida</option>{contas.filter((c) => c.tipo !== "CARTAO" && c.id !== conta?.id).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
            </div>
          </>
        )}
        <label className="caixa"><input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Conta ativa</label>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}

function FormCategoria({ aoSalvar, aoCancelar }: { aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"RECEITA" | "DESPESA">("DESPESA");
  const [grupo, setGrupo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nome.trim().length < 2 || grupo.trim().length < 2) return setErro("Informe o nome e o grupo da DRE.");
    try {
      await api.post("/api/financeiro/categorias", { nome: nome.trim(), tipo, grupo: grupo.trim() });
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="campo"><label htmlFor="cat-nome">Nome</label><input id="cat-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} /></div>
      <div className="campo"><label htmlFor="cat-tipo">Tipo</label><select id="cat-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "RECEITA" | "DESPESA")}><option value="DESPESA">Despesa</option><option value="RECEITA">Receita</option></select></div>
      <div className="campo"><label htmlFor="cat-grupo">Grupo na DRE</label><input id="cat-grupo" value={grupo} maxLength={60} onChange={(e) => setGrupo(e.target.value)} placeholder="Ex.: Custos operacionais" /></div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario">Criar categoria</button>
      </div>
    </form>
  );
}

export function ContasCategorias() {
  const { unidades, pode, praca, usuario } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const contas = useContas();
  const categorias = useCategorias();
  const regras = useCarregar((s) => api.get<RegraFin[]>("/api/financeiro/regras", s), []);
  const [editando, setEditando] = useState<ContaFin | "nova" | null>(null);
  const [novaCategoria, setNovaCategoria] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [textoRegra, setTextoRegra] = useState("");
  const [categoriaRegra, setCategoriaRegra] = useState("");
  const cats = categorias.dados ?? [];
  const nomeCat = (id: string) => cats.find((c) => c.id === id)?.nome ?? "—";

  async function criarPadrao() {
    setErro(null);
    try {
      const r = await api.post<{ criadas: string[] }>("/api/financeiro/contas/padrao", { unidadeId: usuario?.todasUnidades ? (praca || null) : (praca || unidades[0]?.id) });
      notificar(r.criadas.length ? `Contas criadas: ${r.criadas.join(", ")}.` : "As contas padrão já existem.");
      await contas.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  async function alternarCategoria(c: CategoriaFin) {
    setErro(null);
    try {
      await api.patch(`/api/financeiro/categorias/${c.id}`, { ativa: !c.ativa });
      await categorias.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  async function criarRegra(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (textoRegra.trim().length < 3) return setErro("O texto da regra precisa de ao menos 3 letras.");
    if (!categoriaRegra) return setErro("Escolha a categoria da regra.");
    try {
      await api.post("/api/financeiro/regras", { texto: textoRegra.trim(), categoriaId: categoriaRegra, unidadeId: usuario?.todasUnidades ? undefined : (praca || unidades[0]?.id) });
      setTextoRegra("");
      notificar("Regra criada. Ela só sugere a categoria; você confirma ao lançar.");
      await regras.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  async function excluirRegra(r: RegraFin) {
    setErro(null);
    try {
      await api.delete(`/api/financeiro/regras/${r.id}`);
      await regras.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Contas e categorias</h1>
          <p className="pagina__descricao">Contas financeiras, plano de categorias (base da DRE) e regras que sugerem a categoria das linhas do extrato.</p>
        </div>
        {podeEditar && (
          <div className="barra-acoes">
            <button type="button" className="botao botao--primario" onClick={() => setEditando("nova")}>Nova conta</button>
            <button type="button" className="botao botao--secundario" onClick={() => void criarPadrao()}>Criar contas padrão</button>
            <button type="button" className="botao botao--secundario" onClick={() => setNovaCategoria(true)}>Nova categoria</button>
          </div>
        )}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <section className="cartao" aria-labelledby="titulo-contas">
        <h2 id="titulo-contas">Contas</h2>
        {contas.carregando && !contas.dados ? <Carregando /> : contas.erro ? <ErroCarga mensagem={contas.erro} tentarDeNovo={contas.recarregar} /> : (contas.dados ?? []).length === 0 ? <p className="texto-fraco">Nenhuma conta cadastrada ainda.</p> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th scope="col">Conta</th><th scope="col">Tipo</th><th scope="col" className="fin-esconder-celular">Praça</th><th scope="col" className="fin-valor">Saldo</th>{podeEditar && <th scope="col"><span className="fin-oculto-visual">Ações</span></th>}</tr></thead>
              <tbody>
                {(contas.dados ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}{!c.ativa && <span className="etiqueta etiqueta--neutra">inativa</span>}{c.banco && <div className="texto-fraco">{c.banco}{c.finalConta ? ` · final ${c.finalConta}` : ""}</div>}</td>
                    <td>{ROTULO_TIPO_CONTA[c.tipo]}{c.tipo === "CARTAO" && <div className="texto-fraco">fecha dia {c.diaFechamento}, vence dia {c.diaVencimento}</div>}</td>
                    <td className="fin-esconder-celular">{c.unidadeId ? nomePraca(unidades, c.unidadeId) : "Empresa toda"}</td>
                    <td className="fin-valor">{formatarMoeda(c.saldoCentavos)}</td>
                    {podeEditar && <td><button type="button" className="botao botao--pequeno botao--secundario" onClick={() => setEditando(c)}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cartao" aria-labelledby="titulo-categorias">
        <h2 id="titulo-categorias">Categorias</h2>
        {categorias.carregando && !categorias.dados ? <Carregando /> : categorias.erro ? <ErroCarga mensagem={categorias.erro} tentarDeNovo={categorias.recarregar} /> : (
          <div className="fin-grade">
            {(["RECEITA", "DESPESA"] as const).map((tipo) => (
              <div key={tipo}>
                <h3>{tipo === "RECEITA" ? "Receitas" : "Despesas"}</h3>
                <ul className="fin-lista">
                  {cats.filter((c) => c.tipo === tipo).map((c) => (
                    <li key={c.id}>
                      <span>{c.nome} <span className="texto-fraco">({c.grupo})</span>{!c.ativa && <span className="etiqueta etiqueta--neutra">desativada</span>}</span>
                      {podeEditar && <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void alternarCategoria(c)}>{c.ativa ? "Desativar" : "Ativar"}</button>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="cartao" aria-labelledby="titulo-regras">
        <h2 id="titulo-regras">Regras de categorização</h2>
        <p className="texto-fraco">Se a descrição da linha do extrato contiver o texto, o sistema sugere a categoria. Nunca lança nem concilia sozinho.</p>
        {podeEditar && (
          <form className="barra-ferramentas" onSubmit={criarRegra}>
            <div className="campo"><label htmlFor="regra-texto">Texto contém</label><input id="regra-texto" value={textoRegra} maxLength={80} onChange={(e) => setTextoRegra(e.target.value)} placeholder="Ex.: POSTO ILHA" /></div>
            <div className="campo"><label htmlFor="regra-cat">Sugerir categoria</label><select id="regra-cat" value={categoriaRegra} onChange={(e) => setCategoriaRegra(e.target.value)}><option value="">Escolha…</option>{cats.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
            <button type="submit" className="botao botao--secundario">Adicionar regra</button>
          </form>
        )}
        {regras.dados && regras.dados.length > 0 ? (
          <ul className="fin-lista">
            {regras.dados.map((r) => (
              <li key={r.id}><span>“{r.texto}” → {nomeCat(r.categoriaId)}</span>{podeEditar && <button type="button" className="botao botao--pequeno botao--perigo-contorno" onClick={() => void excluirRegra(r)}>Excluir</button>}</li>
            ))}
          </ul>
        ) : <p className="texto-fraco">Nenhuma regra cadastrada.</p>}
      </section>

      <Sinonimos />

      <Modal aberto={editando !== null} titulo={editando === "nova" ? "Nova conta" : "Editar conta"} aoFechar={() => setEditando(null)} largura="larga">
        {editando !== null && <FormConta conta={editando === "nova" ? null : editando} contas={contas.dados ?? []} aoSalvar={async () => { setEditando(null); notificar("Conta salva."); await contas.recarregar(); }} aoCancelar={() => setEditando(null)} />}
      </Modal>
      <Modal aberto={novaCategoria} titulo="Nova categoria" aoFechar={() => setNovaCategoria(false)}>
        {novaCategoria && <FormCategoria aoSalvar={async () => { setNovaCategoria(false); notificar("Categoria criada."); await categorias.recarregar(); }} aoCancelar={() => setNovaCategoria(false)} />}
      </Modal>
    </>
  );
}
