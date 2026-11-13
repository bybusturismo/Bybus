import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { ROTULO_SITUACAO_COMISSAO, type SituacaoComissao } from "@bybus/core";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarData, formatarMoeda } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";

interface DadosBancarios { titular: string; documento: string; pix: string | null; banco: string | null; agencia: string | null; conta: string | null; tipoConta: "CORRENTE" | "POUPANCA" | null }
interface Portal {
  afiliado: { nome: string; codigo: string; link: string };
  totais: { previstaCentavos: number; aPagarCentavos: number; pagaCentavos: number };
  proximoPagamento: { data: string; totalCentavos: number };
  comissoes: Array<{ reservaId: string; pedidoCodigo: string; passeio: string; dataVenda: string | null; dataPasseio: string; valorReservaCentavos: number; comissaoCentavos: number; situacao: SituacaoComissao; dataPagamento: string }>;
  pagamentos: Array<{ dataPagamento: string; periodoDe: string; periodoAte: string; totalCentavos: number; situacao: string; pagoEm: string | null }>;
  dadosBancarios: DadosBancarios | null;
}
const ETIQUETA: Record<SituacaoComissao, string> = { PREVISTA: "etiqueta--neutra", A_PAGAR: "etiqueta--atencao", PAGA: "etiqueta--sucesso", CANCELADA: "etiqueta--perigo" };
const vazio: DadosBancarios = { titular: "", documento: "", pix: "", banco: "", agencia: "", conta: "", tipoConta: "CORRENTE" };

/**
 * Portal do afiliado (13/11/2026): as próprias comissões, próximo pagamento, pagamentos recebidos, dados bancários e o
 * link/QR code de divulgação. A comissão só vale depois que o cliente realiza o passeio; pagamento nos dias 01 e 16.
 */
export function PortalAfiliado() {
  const notificar = useNotificar();
  const dados = useCarregar((s) => api.get<Portal>("/api/portal-afiliado", s), []);
  const [qr, setQr] = useState<string | null>(null);
  const [banco, setBanco] = useState<DadosBancarios>(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const d = dados.dados;
  useEffect(() => {
    if (!d) return;
    setBanco({ ...vazio, ...(d.dadosBancarios ?? {}) } as DadosBancarios);
    QRCode.toDataURL(d.afiliado.link, { margin: 1, width: 260, errorCorrectionLevel: "M" }).then(setQr).catch(() => setQr(null));
  }, [d]);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api.put("/api/portal-afiliado/dados-bancarios", { ...banco, pix: banco.pix || null, banco: banco.banco || null, agencia: banco.agencia || null, conta: banco.conta || null });
      notificar("Dados bancários salvos.");
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  const campo = (k: keyof DadosBancarios, rotulo: string) => (
    <div className="campo"><label htmlFor={`pa-${k}`}>{rotulo}</label><input id={`pa-${k}`} value={banco[k] ?? ""} onChange={(e) => setBanco({ ...banco, [k]: e.target.value })} /></div>
  );
  if (dados.carregando && !d) return <div className="pagina"><Carregando /></div>;
  if (dados.erro) return <div className="pagina"><ErroCarga mensagem={dados.erro} tentarDeNovo={dados.recarregar} /></div>;
  if (!d) return null;
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Olá, {d.afiliado.nome}!</h1>
          <p className="pagina__descricao">Suas comissões com a By Bus. A comissão vale depois que o cliente realiza o passeio. Pagamento no dia 01 (passeios de 16 ao fim do mês anterior) e no dia 16 (passeios de 01 a 15).</p>
        </div>
      </div>
      <Indicadores rotulo="Suas comissões">
        <Indicador tinta="ambar" icone="calendario" rotulo={`Próximo pagamento (${formatarData(d.proximoPagamento.data)})`} valor={formatarMoeda(d.proximoPagamento.totalCentavos)} />
        <Indicador tinta="azul" icone="lista" rotulo="Previstas" valor={formatarMoeda(d.totais.previstaCentavos)} detalhe="Passeio ainda não realizado" />
        <Indicador tinta="rosa" icone="alerta" rotulo="A receber" valor={formatarMoeda(d.totais.aPagarCentavos)} detalhe="Passeio realizado" />
        <Indicador tinta="verde" icone="check" rotulo="Recebidas" valor={formatarMoeda(d.totais.pagaCentavos)} />
      </Indicadores>

      <section className="cartao" aria-labelledby="pa-divulgar">
        <h2 id="pa-divulgar">Seu link e QR code de divulgação</h2>
        <p>Código: <strong>{d.afiliado.codigo}</strong></p>
        <p><code className="frota-link">{d.afiliado.link}</code> <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => void navigator.clipboard.writeText(d.afiliado.link).then(() => notificar("Link copiado."), () => setErro("Selecione o link e copie à mão."))}>Copiar link</button></p>
        {qr && <img src={qr} alt={`QR code do link ${d.afiliado.link}`} width={200} height={200} />}
        <p className="texto-fraco">Vendas feitas pelo seu link entram nas suas comissões.</p>
      </section>

      <section className="cartao" aria-labelledby="pa-comissoes">
        <h2 id="pa-comissoes">Comissões</h2>
        {d.comissoes.length === 0 ? <Vazio titulo="Nenhuma venda pelo seu link ainda." /> : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th scope="col">Passeio</th><th scope="col">Venda</th><th scope="col">Pedido</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Comissão</th><th scope="col">Situação</th><th scope="col">Pagamento</th></tr></thead>
              <tbody>
                {d.comissoes.map((c) => (
                  <tr key={c.reservaId}>
                    <td>{formatarData(c.dataPasseio)}<div className="texto-fraco">{c.passeio}</div></td>
                    <td className="sem-quebra">{c.dataVenda ? formatarData(c.dataVenda) : "—"}</td>
                    <td className="sem-quebra">{c.pedidoCodigo}</td>
                    <td className="num">{formatarMoeda(c.valorReservaCentavos)}</td>
                    <td className="num"><strong>{formatarMoeda(c.comissaoCentavos)}</strong></td>
                    <td><span className={`etiqueta ${ETIQUETA[c.situacao]}`}>{ROTULO_SITUACAO_COMISSAO[c.situacao]}</span></td>
                    <td className="sem-quebra">{c.situacao === "CANCELADA" ? "—" : formatarData(c.dataPagamento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {d.pagamentos.length > 0 && (
        <section className="cartao" aria-labelledby="pa-pagamentos">
          <h2 id="pa-pagamentos">Pagamentos</h2>
          <ul className="lista-simples">
            {d.pagamentos.map((p, i) => <li key={i}>{formatarData(p.dataPagamento)} — {formatarMoeda(p.totalCentavos)} (passeios de {formatarData(p.periodoDe)} a {formatarData(p.periodoAte)}) — {p.situacao === "REALIZADO" ? `pago em ${formatarData(p.pagoEm)}` : "programado"}</li>)}
          </ul>
        </section>
      )}

      <section className="cartao" aria-labelledby="pa-banco">
        <h2 id="pa-banco">Dados para receber</h2>
        {!d.dadosBancarios && <Aviso tipo="atencao">Cadastre seus dados para receber as comissões.</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <form onSubmit={(e) => void salvar(e)}>
          <div className="grade-campos">
            {campo("titular", "Titular da conta")}
            {campo("documento", "CPF ou CNPJ do titular")}
            {campo("pix", "Chave PIX")}
            {campo("banco", "Banco")}
            {campo("agencia", "Agência")}
            {campo("conta", "Conta")}
            <div className="campo"><label htmlFor="pa-tipo">Tipo de conta</label><select id="pa-tipo" value={banco.tipoConta ?? "CORRENTE"} onChange={(e) => setBanco({ ...banco, tipoConta: e.target.value as "CORRENTE" | "POUPANCA" })}><option value="CORRENTE">Corrente</option><option value="POUPANCA">Poupança</option></select></div>
          </div>
          <p className="texto-fraco">Informe a chave PIX ou banco, agência e conta. Seus dados ficam guardados com proteção e só o financeiro da By Bus vê.</p>
          <button type="submit" className="botao botao--primario">Salvar dados</button>
        </form>
      </section>
    </div>
  );
}
