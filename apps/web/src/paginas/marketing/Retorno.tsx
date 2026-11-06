import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Indicador, Indicadores } from "../../componentes/Indicador";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { formatarMoeda, formatarNumero } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { FiltroPeriodo, ROTULO_MIDIA, usePeriodo } from "./comum";

interface LinhaCampanha {
  id: string; nome: string; midia: string; cupom: string | null; utmCampanha: string | null; ativa: boolean; pedidos: number; reservas: number; passageiros: number; receitaCentavos: number | null;
  porUtm: number; porCupom: number; investimentoCentavos: number; custoOrigem: "CSV" | "TOTAL_DA_CAMPANHA"; cliques: number | null; impressoes: number | null;
  custoPorReservaCentavos: number | null; retorno: number | null; semUtm: boolean;
}
interface LinhaAfiliado { id: string; nome: string; codigo: string; ativo: boolean; pedidos: number; reservas: number; passageiros: number; receitaCentavos: number | null; comissaoPontosBase: number | null }
interface Retorno { periodo: { de: string; ate: string }; campanhas: LinhaCampanha[]; afiliados: LinhaAfiliado[]; semAtribuicao: { pedidosComSinal: number; semCampanhaNemAfiliado: number }; apis: { nota: string } }
interface LinkGerado { url: string; utm: { origem: string; midia: string; campanha: string }; salvouUtm: boolean }

function GeradorLinks({ dados, aoSalvarUtm }: { dados: Retorno; aoSalvarUtm: () => void }) {
  const notificar = useNotificar();
  const [tipo, setTipo] = useState<"campanha" | "afiliado" | "livre">("campanha");
  const [campanhaId, setCampanhaId] = useState("");
  const [afiliadoId, setAfiliadoId] = useState("");
  const [destino, setDestino] = useState("");
  const [origem, setOrigem] = useState("");
  const [midia, setMidia] = useState("");
  const [campanha, setCampanha] = useState("");
  const [salvar, setSalvar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<LinkGerado | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    if (!gerado) { setQr(null); return; }
    QRCode.toDataURL(gerado.url, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then((u) => vivo && setQr(u)).catch(() => vivo && setQr(null));
    return () => { vivo = false; };
  }, [gerado]);

  async function gerar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (destino.trim() && !/^https:\/\//i.test(destino.trim())) return setErro("O endereço de destino deve começar com https://");
    if (tipo === "campanha" && !campanhaId) return setErro("Escolha a campanha.");
    if (tipo === "afiliado" && !afiliadoId) return setErro("Escolha o afiliado.");
    if (tipo === "livre" && (!origem.trim() || !midia.trim() || !campanha.trim())) return setErro("Informe campanha, origem e mídia.");
    try {
      const r = await api.post<LinkGerado>("/api/marketing/links", {
        destino: destino.trim() || undefined, campanhaId: tipo === "campanha" ? campanhaId : undefined, afiliadoId: tipo === "afiliado" ? afiliadoId : undefined,
        origem: origem.trim() || undefined, midia: midia.trim() || undefined, campanha: campanha.trim() || undefined, salvarUtm: tipo === "campanha" && salvar,
      });
      setGerado(r);
      if (r.salvouUtm) { notificar("UTM salvo na campanha: as vendas passam a ser atribuídas por ele."); aoSalvarUtm(); }
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(gerado!.url); notificar("Link copiado."); } catch { notificar("Não foi possível copiar. Selecione o link e copie à mão.", "erro"); }
  }

  return (
    <section className="cartao" aria-labelledby="t-links">
      <h2 id="t-links">Gerador de links com UTM e QR code</h2>
      <form onSubmit={gerar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grade-campos">
          <div className="campo"><label htmlFor="lk-tipo">Para</label>
            <select id="lk-tipo" value={tipo} onChange={(e) => { setTipo(e.target.value as typeof tipo); setGerado(null); }}><option value="campanha">Uma campanha</option><option value="afiliado">Um afiliado (hotel, parceiro)</option><option value="livre">Link livre</option></select></div>
          {tipo === "campanha" && <div className="campo"><label htmlFor="lk-camp">Campanha</label><select id="lk-camp" value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}><option value="">Escolha…</option>{dados.campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>}
          {tipo === "afiliado" && <div className="campo"><label htmlFor="lk-af">Afiliado</label><select id="lk-af" value={afiliadoId} onChange={(e) => setAfiliadoId(e.target.value)}><option value="">Escolha…</option>{dados.afiliados.map((a) => <option key={a.id} value={a.id}>{a.nome} ({a.codigo})</option>)}</select></div>}
          <div className="campo"><label htmlFor="lk-dest">Destino (padrão: a loja)</label><input id="lk-dest" type="url" placeholder="https://" value={destino} maxLength={500} onChange={(e) => setDestino(e.target.value)} /></div>
          {(tipo === "livre" || tipo === "campanha") && (
            <>
              <div className="campo"><label htmlFor="lk-origem">Origem (utm_source){tipo === "campanha" ? " — opcional" : ""}</label><input id="lk-origem" value={origem} maxLength={60} placeholder="google, instagram…" onChange={(e) => setOrigem(e.target.value)} /></div>
              <div className="campo"><label htmlFor="lk-midia">Mídia (utm_medium){tipo === "campanha" ? " — opcional" : ""}</label><input id="lk-midia" value={midia} maxLength={60} placeholder="cpc, social, qrcode…" onChange={(e) => setMidia(e.target.value)} /></div>
            </>
          )}
          {tipo === "livre" && <div className="campo"><label htmlFor="lk-camp2">Campanha (utm_campaign)</label><input id="lk-camp2" value={campanha} maxLength={80} onChange={(e) => setCampanha(e.target.value)} /></div>}
        </div>
        {tipo === "campanha" && <label className="interruptor"><input type="checkbox" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} /> Salvar o UTM na campanha (necessário para a atribuição automática das vendas)</label>}
        <button type="submit" className="botao botao--primario">Gerar link</button>
      </form>
      {gerado && (
        <div className="m2-grade" aria-live="polite">
          <div>
            <p className="texto-copiavel" style={{ overflowWrap: "anywhere" }}>{gerado.url}</p>
            <p className="texto-fraco">utm_source={gerado.utm.origem} · utm_medium={gerado.utm.midia} · utm_campaign={gerado.utm.campanha}</p>
            <button type="button" className="botao botao--secundario" onClick={() => void copiar()}>Copiar link</button>
          </div>
          <div>
            {qr ? <img className="qr-codigo" src={qr} alt={`QR code do link da campanha ${gerado.utm.campanha}`} /> : <Carregando texto="Gerando QR code…" />}
            {qr && <a className="botao botao--secundario" href={qr} download={`qr-${gerado.utm.campanha}.png`}><Icone nome="baixar" /> Baixar PNG</a>}
          </div>
        </div>
      )}
    </section>
  );
}

function ImportarCusto({ campanhas, aoImportar }: { campanhas: LinhaCampanha[]; aoImportar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [campanhaId, setCampanhaId] = useState("");
  const [fonte, setFonte] = useState("GOOGLE_ADS");
  const [csv, setCsv] = useState("");
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; ignoradas: string[]; custoCentavos: number } | null>(null);

  function ler(arquivo: File | undefined) {
    if (!arquivo) return;
    setNome(arquivo.name);
    if (arquivo.size > 500_000) return setErro("Arquivo grande demais (máximo de 500 KB): exporte um período menor.");
    const l = new FileReader();
    l.onload = () => { setCsv(String(l.result ?? "")); setErro(null); };
    l.onerror = () => setErro("Não foi possível ler o arquivo.");
    l.readAsText(arquivo, "utf-8");
  }
  async function importar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setResultado(null);
    if (!campanhaId) return setErro("Escolha a campanha.");
    if (!csv.trim()) return setErro("Escolha o arquivo CSV exportado do Google Ads ou do Meta Ads.");
    setEnviando(true);
    try {
      const r = await api.post<{ importados: number; ignoradas: string[]; custoCentavos: number }>(`/api/marketing/campanhas/${campanhaId}/custos/csv`, { csv, fonte });
      setResultado(r);
      notificar(`${r.importados} dia(s) de custo importado(s).`);
      await aoImportar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <section className="cartao" aria-labelledby="t-csv">
      <h2 id="t-csv">Custo dos anúncios por CSV</h2>
      <p className="texto-fraco">Exporte o relatório <strong>por dia</strong> no Google Ads (colunas Dia e Custo) ou no Meta Ads (Dia e Valor gasto). Importar de novo o mesmo dia atualiza, não duplica. A integração direta pelas APIs é a próxima etapa.</p>
      <form onSubmit={importar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grade-campos">
          <div className="campo"><label htmlFor="csv-camp">Campanha</label><select id="csv-camp" value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}><option value="">Escolha…</option>{campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></div>
          <div className="campo"><label htmlFor="csv-fonte">Origem do arquivo</label><select id="csv-fonte" value={fonte} onChange={(e) => setFonte(e.target.value)}><option value="GOOGLE_ADS">Google Ads</option><option value="META_ADS">Meta Ads</option><option value="CSV">Outro CSV</option></select></div>
          <div className="campo"><label htmlFor="csv-arq">Arquivo CSV</label><input id="csv-arq" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => ler(e.target.files?.[0])} />{nome && <p className="campo__ajuda">{nome}</p>}</div>
        </div>
        <button type="submit" className="botao botao--primario" disabled={enviando}>{enviando ? "Importando…" : "Importar custos"}</button>
      </form>
      {resultado && <Aviso tipo={resultado.ignoradas.length ? "atencao" : "sucesso"}>{resultado.importados} dia(s), {formatarMoeda(resultado.custoCentavos)} no total.{resultado.ignoradas.length > 0 && ` ${resultado.ignoradas.length} linha(s) ignorada(s): ${resultado.ignoradas.slice(0, 3).join(" ")}`}</Aviso>}
    </section>
  );
}

export function RetornoCampanhas() {
  const { praca, pode } = useSessao();
  const podeGerenciar = pode("marketing:gerenciar");
  const [periodo, setPeriodo] = usePeriodo(30, 0);
  const consulta = qs({ de: periodo.de, ate: periodo.ate, unidadeId: praca });
  const r = useCarregar((s) => api.get<Retorno>(`/api/marketing/retorno${consulta}`, s), [consulta]);
  const d = r.dados;
  const total = d?.campanhas.reduce((a, c) => ({ reservas: a.reservas + c.reservas, receita: a.receita + (c.receitaCentavos ?? 0), invest: a.invest + c.investimentoCentavos }), { reservas: 0, receita: 0, invest: 0 });

  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Retorno de campanhas"
        descricao="Vendas ligadas automaticamente às campanhas pelo UTM e pelo cupom da Paytour, com custo por reserva e retorno."
        filtros={<FiltroPeriodo periodo={periodo} aoMudar={setPeriodo} />} />
      {r.carregando && !d ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : d && total ? (
        <>
          <Indicadores rotulo="Resumo do retorno">
            <Indicador tinta="azul" icone="bilhete" rotulo="Reservas atribuídas" valor={formatarNumero(total.reservas)} detalhe={`${formatarNumero(d.semAtribuicao.pedidosComSinal)} pedido(s) com UTM, cupom ou afiliado`} />
            <Indicador tinta="verde" icone="dinheiro" rotulo="Receita atribuída" valor={formatarMoeda(total.receita)} />
            <Indicador tinta="laranja" icone="cartao" rotulo="Investimento das campanhas" valor={formatarMoeda(total.invest)} />
            <Indicador tinta="ambar" icone="alerta" rotulo="Com sinal e sem campanha" valor={formatarNumero(d.semAtribuicao.semCampanhaNemAfiliado)} detalhe="UTM ou cupom que nenhuma campanha reconhece" />
          </Indicadores>
          <section className="cartao" aria-labelledby="t-camp">
            <h2 id="t-camp">Por campanha</h2>
            {d.campanhas.length === 0 ? <Vazio titulo="Nenhuma campanha cadastrada." /> : (
              <div className="tabela-rolagem"><table className="tabela">
                <thead><tr><th>Campanha</th><th className="num">Reservas</th><th className="num">Receita</th><th className="num">Custo</th><th className="num">Custo por reserva</th><th className="num">Retorno</th></tr></thead>
                <tbody>
                  {d.campanhas.map((c) => (
                    <tr key={c.id} className={c.ativa ? "" : "linha--inativa"}>
                      <td><strong>{c.nome}</strong><div className="texto-fraco">{ROTULO_MIDIA[c.midia] ?? c.midia}{c.utmCampanha ? ` · utm ${c.utmCampanha}` : ""}{c.cupom ? ` · cupom ${c.cupom}` : ""}</div>
                        {c.semUtm && <div className="texto-fraco">Sem UTM nem cupom: não dá para atribuir vendas.</div>}</td>
                      <td className="num">{formatarNumero(c.reservas)}<div className="texto-fraco">{c.porUtm} por UTM · {c.porCupom} por cupom</div></td>
                      <td className="num">{c.receitaCentavos == null ? "—" : formatarMoeda(c.receitaCentavos)}</td>
                      <td className="num">{formatarMoeda(c.investimentoCentavos)}<div className="texto-fraco">{c.custoOrigem === "CSV" ? `importado${c.cliques != null ? ` · ${formatarNumero(c.cliques)} cliques` : ""}` : "total da campanha"}</div></td>
                      <td className="num">{c.custoPorReservaCentavos == null ? "—" : formatarMoeda(c.custoPorReservaCentavos)}</td>
                      <td className="num">{c.retorno == null ? "—" : `${c.retorno.toLocaleString("pt-BR")}×`}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
          <section className="cartao" aria-labelledby="t-af">
            <h2 id="t-af">Por afiliado</h2>
            {d.afiliados.length === 0 ? <Vazio titulo="Nenhum afiliado cadastrado." /> : (
              <div className="tabela-rolagem"><table className="tabela">
                <thead><tr><th>Afiliado</th><th className="num">Pedidos</th><th className="num">Reservas</th><th className="num">Passageiros</th><th className="num">Receita</th></tr></thead>
                <tbody>{d.afiliados.map((a) => <tr key={a.id}><td><strong>{a.nome}</strong><div className="texto-fraco">{a.codigo}</div></td><td className="num">{a.pedidos}</td><td className="num">{a.reservas}</td><td className="num">{a.passageiros}</td><td className="num">{a.receitaCentavos == null ? "—" : formatarMoeda(a.receitaCentavos)}</td></tr>)}</tbody>
              </table></div>
            )}
            <p className="texto-fraco">O afiliado é reconhecido pelo id da Paytour cadastrado na ficha dele ou pelo UTM “afiliado-código” do QR code.</p>
          </section>
          <GeradorLinks dados={d} aoSalvarUtm={() => void r.recarregar()} />
          {podeGerenciar && <ImportarCusto campanhas={d.campanhas} aoImportar={r.recarregar} />}
          <Aviso tipo="info">{d.apis.nota}</Aviso>
        </>
      ) : null}
    </div>
  );
}
