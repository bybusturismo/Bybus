import { useState } from "react";
import { Link } from "react-router-dom";
import { useCarregar } from "../../util/useCarregar";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarMoeda } from "../../util/formato";
import { useCategorias } from "./dados";
import { EXEMPLO_PLANILHA } from "./exemploPlanilha";
import type { PreviaPlanilha } from "./tipos";
import { decodificarArquivo } from "./util";

type Mapeamentos = Record<string, string>;

function Qualidade({ q }: { q: PreviaPlanilha["qualidade"] }) {
  const itens: Array<[string, number, string]> = [
    ["Datas vazias ou inválidas (linhas ignoradas)", q.dataInvalida.total, q.dataInvalida.linhas.map((l) => `linha ${l.linha}${l.texto ? ` ("${l.texto}")` : ""}`).join("; ")],
    ["Mês da coluna A diferente da data", q.mesDiferente.total, q.mesDiferente.linhas.map((l) => `linha ${l.linha} (${l.mes} × ${formatarData(l.data)})`).join("; ")],
    ["Ano fora do período da aba", q.anoFora.total, q.anoFora.linhas.map((l) => `linha ${l.linha} (${formatarData(l.data)})`).join("; ")],
    ["Sem grupo (a classificar)", q.grupoVazio.total, q.grupoVazio.linhas.map((l) => `linha ${l}`).join("; ")],
    ["Possíveis duplicadas (verificar; nada foi descartado)", q.duplicadas.total, q.duplicadas.grupos.map((g) => `linhas ${g.linhas.join(" e ")}: ${formatarData(g.data)} ${g.fornecedor || "sem favorecido"} ${formatarMoeda(g.valorCentavos)}`).join("; ")],
    ["Citam CPF (cartão, consórcio ou conta de pessoa física): conferir se são despesas pessoais", q.pessoaFisica.total, q.pessoaFisica.linhas.map((l) => `linha ${l}`).join("; ")],
    ["Contas a pagar previstas (data futura, só em A pagar)", q.previstas, ""],
    ["Valor só em A pagar, sem conta", q.apagarSemConta, ""],
    ["Valor pago diferente do A pagar (diferença vira juros ou desconto)", q.apagarDiferente, ""],
  ];
  const comAlgo = itens.filter(([, n]) => n > 0);
  return (
    <>
      {q.grafias.length > 0 && (
        <p className="texto-fraco">
          Grafias diferentes do mesmo grupo: {q.grafias.map((g) => `${g.canonico} (${g.variantes.map((v) => `“${v.texto}” ×${v.qtd}`).join(", ")})`).join("; ")}. O dicionário de sinônimos já junta todas.
        </p>
      )}
      {comAlgo.length === 0 ? <p className="texto-fraco">Nenhum problema de qualidade encontrado.</p> : (
        <ul className="fin-lista" aria-label="Conferência de qualidade">
          {comAlgo.map(([rotulo, n, linhas]) => (
            <li key={rotulo}><span>{rotulo}{linhas && <span className="texto-fraco"> — {linhas}</span>}</span><strong>{n}</strong></li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Importador da planilha de controle financeiro (aba exportada em CSV). Duas etapas: prévia (nada é gravado; mapeie o que não foi
 * reconhecido) e confirmação. Reimportar a mesma aba não duplica nada.
 */
export function ImportarPlanilha() {
  const { unidades, praca, usuario } = useSessao();
  const notificar = useNotificar();
  const categorias = useCategorias();
  const [conteudo, setConteudo] = useState<{ nome: string; texto: string } | null>(null);
  const [unidadeId, setUnidadeId] = useState(praca || (unidades.length === 1 ? unidades[0]!.id : ""));
  const [previa, setPrevia] = useState<PreviaPlanilha | null>(null);
  const [mapeamentos, setMapeamentos] = useState<Mapeamentos>({});
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function ler(texto: string, nome: string, mapa: Mapeamentos, uni = unidadeId) {
    setErro(null);
    setOcupado(true);
    try {
      setPrevia(await api.post<PreviaPlanilha>("/api/financeiro/planilha/importar", { conteudo: texto, arquivo: nome, unidadeId: uni || null, mapeamentos: mapa }));
    } catch (x) {
      setPrevia(null);
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  async function escolher(f: File | undefined) {
    setPrevia(null);
    setErro(null);
    setMapeamentos({});
    setConteudo(null);
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) return setErro("Arquivos .xlsx ainda não são lidos aqui. No Google Sheets, use Arquivo › Fazer download › Valores separados por vírgula (.csv), uma aba por vez.");
    if (!/\.(csv|txt)$/i.test(f.name)) return setErro("Escolha o arquivo .csv exportado da aba da planilha.");
    if (f.size > 5_000_000) return setErro("Arquivo grande demais (máximo 5 MB). Exporte uma aba por vez.");
    const texto = decodificarArquivo(await f.arrayBuffer());
    setConteudo({ nome: f.name, texto });
    await ler(texto, f.name, {});
  }

  // Importar pelo link do Google (conta de serviço, 09/11/2026): o servidor lê a aba e a tela segue o mesmo caminho do .csv.
  const google = useCarregar((s) => api.get<{ configurado: boolean; email: string | null }>("/api/financeiro/planilha/google", s), []);
  const [link, setLink] = useState("");
  const [abas, setAbas] = useState<Array<{ id: number; titulo: string }> | null>(null);
  async function verAbas() {
    setErro(null);
    setOcupado(true);
    try { setAbas((await api.post<{ abas: Array<{ id: number; titulo: string }> }>("/api/financeiro/planilha/google/abas", { link })).abas); } catch (x) { setAbas(null); setErro(mensagemDeErro(x)); } finally { setOcupado(false); }
  }
  async function lerAba(titulo: string) {
    if (!titulo) return;
    setPrevia(null);
    setErro(null);
    setMapeamentos({});
    setOcupado(true);
    try {
      const r = await api.post<{ nome: string; texto: string }>("/api/financeiro/planilha/google/aba", { link, aba: titulo });
      setConteudo(r);
      await ler(r.texto, r.nome, {});
    } catch (x) { setErro(mensagemDeErro(x)); setOcupado(false); }
  }

  async function usarExemplo() {
    setMapeamentos({});
    setConteudo({ nome: "exemplo-ficticio.csv", texto: EXEMPLO_PLANILHA });
    await ler(EXEMPLO_PLANILHA, "exemplo-ficticio.csv", {});
  }

  async function confirmar() {
    if (!conteudo) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<PreviaPlanilha>("/api/financeiro/planilha/importar", {
        conteudo: conteudo.texto, arquivo: conteudo.nome, unidadeId: unidadeId || null, mapeamentos, salvarSinonimos: lembrar, confirmar: true,
      });
      notificar(`${r.resultado?.lancamentos ?? 0} lançamento(s) e ${r.resultado?.transferencias ?? 0} transferência(s) importados.`);
      setPrevia(r);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }

  const feito = !!previa?.resultado;
  const cats = (categorias.dados ?? []).filter((c) => c.ativa);
  const faltaPraca = !unidadeId && !usuario?.todasUnidades;

  return (
    <>
      <div className="pagina__cabecalho">
        <div>
          <h1>Importar planilha de controle</h1>
          <p className="pagina__descricao">Traz uma aba da planilha de controle financeiro (layout novo ou antigo). Nada é gravado antes da sua confirmação, e reimportar a mesma aba não duplica nada.</p>
        </div>
      </div>
      <section className="cartao" aria-labelledby="titulo-passos">
        <h2 id="titulo-passos">Como importar</h2>
        <ol>
          <li>Na planilha (Google Sheets), abra uma aba por vez e use <em>Arquivo › Fazer download › Valores separados por vírgula (.csv)</em>.</li>
          <li>Escolha a praça e o arquivo abaixo. O sistema acha o cabeçalho sozinho e ignora o resumo do topo (ele recalcula tudo).</li>
          <li>Confira a prévia: contas, saldos, qualidade dos dados e o que não foi reconhecido. Mapeie as combinações desconhecidas ou ignore essas linhas.</li>
          <li>Confirme. Dados de contato do favorecido (CPF/CNPJ, e-mail, telefone) vão para o cadastro de favorecidos, nunca para a descrição.</li>
        </ol>
        <div className="grade-campos">
          <div className="campo">
            <label htmlFor="pl-praca">Praça</label>
            <select id="pl-praca" value={unidadeId} disabled={feito} onChange={(e) => { setUnidadeId(e.target.value); if (conteudo) void ler(conteudo.texto, conteudo.nome, mapeamentos, e.target.value); }}>
              <option value="">{usuario?.todasUnidades ? "Empresa toda" : "Escolha…"}</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="pl-arquivo">Arquivo CSV da aba</label>
            <input id="pl-arquivo" type="file" accept=".csv,.txt,.xlsx" disabled={ocupado || faltaPraca} onChange={(e) => void escolher(e.target.files?.[0])} />
          </div>
        </div>
        {google.dados?.configurado && (
          <div className="grade-campos">
            <div className="campo"><label htmlFor="pl-link">Ou pelo link do Google Sheets</label>
              <input id="pl-link" type="url" value={link} onChange={(e) => { setLink(e.target.value); setAbas(null); }} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={ocupado || faltaPraca} />
              <span className="campo__ajuda">A planilha precisa estar compartilhada (Leitor) com {google.dados.email}.</span>
            </div>
            {abas ? (
              <div className="campo"><label htmlFor="pl-aba">Aba</label>
                <select id="pl-aba" defaultValue="" disabled={ocupado} onChange={(e) => void lerAba(e.target.value)}>
                  <option value="" disabled>Escolha a aba…</option>
                  {abas.map((a) => <option key={a.id} value={a.titulo}>{a.titulo}</option>)}
                </select>
              </div>
            ) : (
              <div className="campo"><span>&nbsp;</span><button type="button" className="botao botao--secundario" disabled={ocupado || faltaPraca || !link.trim()} onClick={() => void verAbas()}>Ver as abas</button></div>
            )}
          </div>
        )}
        <button type="button" className="botao botao--secundario botao--pequeno" disabled={ocupado || faltaPraca} onClick={() => void usarExemplo()}>Experimentar com uma planilha de exemplo (fictícia)</button>
      </section>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {ocupado && !previa && <Carregando texto="Lendo a planilha…" />}
      {categorias.erro && <ErroCarga mensagem={categorias.erro} tentarDeNovo={categorias.recarregar} />}

      {previa && (
        <>
          {feito && previa.resultado && (
            <Aviso tipo="sucesso" titulo="Importação concluída">
              {previa.resultado.lancamentos} lançamento(s) e {previa.resultado.transferencias} transferência(s) gravados; {previa.resultado.jaExistentes} já existiam.
              {previa.resultado.contasCriadas.length > 0 && ` Contas criadas: ${previa.resultado.contasCriadas.join(", ")}.`}
              {previa.resultado.saldosAplicados > 0 && ` ${previa.resultado.saldosAplicados} saldo(s) inicial(is) definido(s).`}
              {(previa.resultado.pendentes ?? 0) > 0 && <> {previa.resultado.pendentes} linha(s) ficaram para depois: classifique em <Link to="/financeiro/pendencias">Financeiro › Pendências</Link>, sem importar de novo.</>}
            </Aviso>
          )}
          <section className="cartao" aria-labelledby="titulo-previa">
            <h2 id="titulo-previa">{feito ? "Resumo da importação" : "Prévia"} — layout {previa.layout === "ANTIGO" ? "antigo" : "novo"}, cabeçalho na linha {previa.cabecalhoLinha}</h2>
            <p>
              <strong>{previa.novos.lancamentos}</strong> lançamento(s) novo(s) ({previa.realizados} baixados, {previa.abertos} contas a pagar em aberto) e <strong>{previa.novos.transferencias}</strong> transferência(s);
              {" "}{previa.jaExistentes} já existente(s); {previa.ignoradas} linha(s) ignorada(s).
            </p>
            {previa.contasACriar.length > 0 && <p className="texto-fraco">Contas que serão criadas: {previa.contasACriar.join(", ")}.</p>}
            {previa.avisos.map((a) => <Aviso key={a} tipo="info">{a}</Aviso>)}
            {previa.erros.length > 0 && <Aviso tipo="erro" titulo={`${previa.totalErros} linha(s) com valor inválido`}>{previa.erros.map((e) => `linha ${e.linha}: ${e.motivo}`).join("; ")}. Corrija a planilha e importe de novo.</Aviso>}
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead><tr><th scope="col">Conta</th><th scope="col" className="fin-valor">Lançamentos</th><th scope="col" className="fin-valor">Entradas</th><th scope="col" className="fin-valor">Saídas</th></tr></thead>
                <tbody>
                  {previa.porConta.map((c) => (
                    <tr key={c.coluna}><td>{c.rotulo}{c.criar && <span className="etiqueta etiqueta--neutra">será criada</span>}</td><td className="fin-valor">{c.qtd}</td><td className="fin-valor">{formatarMoeda(c.entradasCentavos)}</td><td className="fin-valor">{formatarMoeda(c.saidasCentavos)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previa.saldos.length > 0 && (
              <>
                <h3>Saldos de abertura (linha “AAA SALDO”)</h3>
                <ul className="fin-lista">
                  {previa.saldos.map((s) => (
                    <li key={s.coluna}>
                      <span>{s.rotulo}: {formatarMoeda(s.valorCentavos)} em {s.data ? formatarData(s.data) : "—"}
                        <span className="texto-fraco"> — {s.aplicar ? "vira o saldo inicial da conta" : s.motivo}</span>
                        {s.divergenciaCentavos !== null && s.divergenciaCentavos !== 0 && <> {" "}<span className="etiqueta etiqueta--atencao">divergência de {formatarMoeda(s.divergenciaCentavos)} (calculado {formatarMoeda(s.calculadoCentavos ?? 0)})</span></>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {previa.amostra.length > 0 && (
              <>
                <h3>Primeiros lançamentos</h3>
                <ul className="fin-lista">
                  {previa.amostra.map((a, i) => (
                    <li key={i}><span>{formatarData(a.data)} · {a.descricao} <span className="texto-fraco">({a.categoria}{a.conta ? ` · ${a.conta}` : " · em aberto"})</span></span>
                      <span className={`fin-valor ${a.tipo === "PAGAR" ? "fin-valor--saida" : "fin-valor--entrada"}`}>{a.tipo === "PAGAR" ? "−" : "+"}{formatarMoeda(a.valorCentavos)}</span></li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="cartao" aria-labelledby="titulo-qualidade">
            <h2 id="titulo-qualidade">Conferência de qualidade</h2>
            <Qualidade q={previa.qualidade} />
          </section>

          {previa.naoReconhecidos.length > 0 && !feito && (
            <section className="cartao" aria-labelledby="titulo-nao">
              <h2 id="titulo-nao">Não reconhecido: mapeie ou ignore</h2>
              <p className="texto-fraco">Escolha a categoria de cada combinação grupo|categoria desconhecida, ou ignore essas linhas. Depois, atualize a prévia.</p>
              {previa.naoReconhecidos.map((n) => (
                <div key={n.chave} className="campo campo--linha">
                  <label htmlFor={`map-${n.chave}`}>{n.grupo || "(sem grupo)"} › {n.categoria || "(sem categoria)"} <span className="texto-fraco">({n.qtd} linha(s), {formatarMoeda(n.totalCentavos)})</span></label>
                  <select id={`map-${n.chave}`} value={mapeamentos[n.chave] ?? ""} onChange={(e) => setMapeamentos((m) => ({ ...m, [n.chave]: e.target.value }))}>
                    <option value="">Não importar ainda (fica em Pendências)</option>
                    <option value="IGNORAR">Ignorar estas linhas</option>
                    <option value="TRANSFERENCIA">É transferência entre contas</option>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              ))}
              <label className="caixa"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar estas escolhas no dicionário de sinônimos</label>
              <div className="modal__acoes">
                <button type="button" className="botao botao--secundario" disabled={ocupado || !conteudo} onClick={() => conteudo && void ler(conteudo.texto, conteudo.nome, mapeamentos)}>Atualizar prévia</button>
              </div>
            </section>
          )}

          {!feito && (
            <div className="modal__acoes">
              <button type="button" className="botao botao--primario" disabled={ocupado || previa.erros.length > 0 || (previa.novos.lancamentos + previa.novos.transferencias === 0 && !previa.saldos.some((s) => s.aplicar))} onClick={() => void confirmar()}>
                Importar {previa.novos.lancamentos} lançamento(s) e {previa.novos.transferencias} transferência(s)
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
