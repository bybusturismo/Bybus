import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import type { RevendaFin } from "./tipos";

const valorOuNulo = (t: string) => { const v = t.trim() ? centavosDeTexto(t) : 0; return v === null || Number.isNaN(v) || v < 0 ? null : v; };

/** Revenda de serviços de terceiros (ex.: ingressos): venda, repasse ao fornecedor e comissão. Na DRE só a margem entra como receita própria. */
export function Revenda() {
  const { unidades, praca, usuario, pode } = useSessao();
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<{ aviso: string; itens: RevendaFin[] }>("/api/financeiro/revendas", s), []);
  const [descricao, setDescricao] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [vendedor, setVendedor] = useState("");
  const [dataVenda, setDataVenda] = useState(hojeIso());
  const [vencRepasse, setVencRepasse] = useState(hojeIso());
  const [venda, setVenda] = useState("");
  const [repasse, setRepasse] = useState("");
  const [comissao, setComissao] = useState("");
  const [unidadeId, setUnidadeId] = useState(praca || (unidades.length === 1 ? unidades[0]!.id : ""));
  const [erro, setErro] = useState<string | null>(null);
  const v = valorOuNulo(venda);
  const r = valorOuNulo(repasse);
  const margem = v !== null && v > 0 && r !== null ? v - r : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const c = valorOuNulo(comissao);
    if (descricao.trim().length < 2) return setErro("Descreva a venda (ex.: ingressos do parque).");
    if (v === null || v <= 0 || r === null || c === null) return setErro("Informe venda, repasse e comissão em reais (ex.: 1.234,56). A venda precisa ser maior que zero.");
    if (!unidadeId && !usuario?.todasUnidades) return setErro("Escolha a praça.");
    try {
      await api.post("/api/financeiro/revendas", {
        descricao: descricao.trim(), fornecedor: fornecedor.trim() || null, vendedor: vendedor.trim() || null, dataVenda, vencimentoRepasse: vencRepasse,
        valorVendaCentavos: v, valorRepasseCentavos: r, comissaoCentavos: c, unidadeId: unidadeId || null,
      });
      notificar("Revenda lançada: venda, repasse e comissão criados em aberto.");
      setDescricao(""); setVenda(""); setRepasse(""); setComissao("");
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Revenda de terceiros</h1>
          <p className="pagina__descricao">Ingressos e outros serviços vendidos em nome de terceiros: o valor recebido do cliente, o repasse ao fornecedor e a comissão do vendedor.</p>
        </div>
      </div>
      <Aviso tipo="info">Na DRE só a margem (venda − repasse) conta como receita própria; o tratamento contábil está a confirmar com o contador.</Aviso>
      {pode("financeiro:gerenciar") && (
        <section className="cartao" aria-labelledby="titulo-nova-revenda">
          <h2 id="titulo-nova-revenda">Nova revenda</h2>
          <form onSubmit={salvar}>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="grade-campos">
              <div className="campo campo--largo"><label htmlFor="rv-desc">Descrição</label><input id="rv-desc" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-forn">Fornecedor (quem recebe o repasse)</label><input id="rv-forn" value={fornecedor} maxLength={150} onChange={(e) => setFornecedor(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-vend">Vendedor (comissão)</label><input id="rv-vend" value={vendedor} maxLength={150} onChange={(e) => setVendedor(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-data">Data da venda</label><input id="rv-data" type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-venc">Vencimento do repasse</label><input id="rv-venc" type="date" value={vencRepasse} onChange={(e) => setVencRepasse(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-venda">Valor recebido do cliente (R$)</label><input id="rv-venda" inputMode="decimal" value={venda} onChange={(e) => setVenda(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-rep">Repasse ao fornecedor (R$)</label><input id="rv-rep" inputMode="decimal" value={repasse} onChange={(e) => setRepasse(e.target.value)} /></div>
              <div className="campo"><label htmlFor="rv-com">Comissão do vendedor (R$)</label><input id="rv-com" inputMode="decimal" value={comissao} onChange={(e) => setComissao(e.target.value)} /></div>
              <div className="campo">
                <label htmlFor="rv-praca">Praça</label>
                <select id="rv-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                  <option value="">{usuario?.todasUnidades ? "Empresa toda" : "Escolha…"}</option>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </div>
            </div>
            <p aria-live="polite">Margem: <strong>{margem === null ? "—" : formatarMoeda(margem)}</strong></p>
            <button type="submit" className="botao botao--primario">Lançar revenda</button>
          </form>
        </section>
      )}
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : lista.dados && (lista.dados.itens.length === 0 ? <Vazio titulo="Nenhuma revenda lançada." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col" className="fin-valor">Venda</th><th scope="col" className="fin-valor">Repasse</th><th scope="col" className="fin-valor">Comissão</th><th scope="col" className="fin-valor">Margem</th></tr></thead>
            <tbody>
              {lista.dados.itens.map((x) => (
                <tr key={x.id}><td>{formatarData(x.dataVenda)}</td><td>{x.descricao}{x.fornecedor && <div className="texto-fraco">{x.fornecedor}</div>}</td>
                  <td className="fin-valor">{formatarMoeda(x.valorVendaCentavos)}</td><td className="fin-valor">{formatarMoeda(x.valorRepasseCentavos)}</td><td className="fin-valor">{formatarMoeda(x.comissaoCentavos)}</td>
                  <td className={`fin-valor ${x.margemCentavos < 0 ? "fin-valor--saida" : "fin-valor--entrada"}`}>{formatarMoeda(x.margemCentavos)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
