import { useState, type ChangeEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import type { AcaoImportacao, ResultadoImportacao } from "../../api/tipos";
import { Aviso } from "../../componentes/Estados";
import { Confirmar } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarData } from "../../util/formato";
import { ROTULO_ACAO } from "../../util/rotulos";
import { decodificarCsv, lerArquivo, separarEmails } from "./leitura";

const LIMITE_BYTES = 4.5 * 1024 * 1024;

export function TabelaPrevia({ resultado }: { resultado: ResultadoImportacao }) {
  const { resumo } = resultado;
  return (
    <section aria-labelledby="titulo-previa" className="previa">
      <h2 id="titulo-previa">Prévia</h2>
      <ul className="previa__resumo">
        {(Object.keys(resumo) as AcaoImportacao[]).map((a) => (
          <li key={a} className={`etiqueta etiqueta--acao-${a.toLowerCase()}`}>
            {ROTULO_ACAO[a]}: {resumo[a]}
          </li>
        ))}
      </ul>
      {!!resultado.naoReconhecidos && <Aviso tipo="atencao">{resultado.naoReconhecidos} bloco(s) colado(s) não foram reconhecidos como e-mail de reserva da Bókun.</Aviso>}
      {!!resultado.colunasNaoEncontradas?.length && (
        <Aviso tipo="atencao" titulo="Colunas não encontradas no CSV">
          {resultado.colunasNaoEncontradas.join(", ")}. Esses dados ficarão em branco.
        </Aviso>
      )}
      {!!resultado.errosLeitura?.length && (
        <Aviso tipo="atencao" titulo={`${resultado.errosLeitura.length} linha(s) com problema (ignoradas)`}>
          <ul>
            {resultado.errosLeitura.slice(0, 50).map((e, i) => (
              <li key={i}>
                Linha {e.linha}: {e.mensagem}
              </li>
            ))}
          </ul>
        </Aviso>
      )}
      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Ação</th>
              <th scope="col">Data</th>
              <th scope="col">Canal</th>
              <th scope="col">Código</th>
              <th scope="col">Titular</th>
              <th scope="col" className="num">
                Pax
              </th>
              <th scope="col">Ponto de embarque</th>
              <th scope="col">Avisos</th>
            </tr>
          </thead>
          <tbody>
            {resultado.previa.map((p, i) => (
              <tr key={`${p.canal}-${p.codigoExterno}-${i}`}>
                <td>
                  <span className={`etiqueta etiqueta--acao-${p.acao.toLowerCase()}`}>{ROTULO_ACAO[p.acao]}</span>
                </td>
                <td>{formatarData(p.data)}</td>
                <td>{p.canal}</td>
                <td className="mono">{p.codigoExterno}</td>
                <td>{p.contatoNome || <em className="texto-fraco">(sem nome)</em>}</td>
                <td className="num">{p.passageiros}</td>
                <td>{p.pontoEmbarque ?? <span className="texto-atencao">A definir</span>}</td>
                <td>
                  {p.avisos.length ? (
                    <ul className="lista-avisos">
                      {p.avisos.map((a, k) => (
                        <li key={k}>{a}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="texto-fraco">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function useImportacao(rota: string) {
  const notificar = useNotificar();
  const [previa, setPrevia] = useState<ResultadoImportacao | null>(null);
  const [concluido, setConcluido] = useState<ResultadoImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  async function enviar(corpo: Record<string, unknown>, confirmar: boolean) {
    setErro(null);
    setOcupado(true);
    try {
      const r = await api.post<ResultadoImportacao>(rota, { ...corpo, confirmar });
      if (confirmar) {
        setConcluido(r);
        setPrevia(null);
        notificar(`Importação concluída: ${r.resumo.CRIAR} criada(s), ${r.resumo.ATUALIZAR} atualizada(s), ${r.resumo.CANCELAR} cancelada(s).`);
      } else {
        setPrevia(r);
        setConcluido(null);
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
      setConfirmando(false);
    }
  }
  const limpar = () => {
    setPrevia(null);
    setConcluido(null);
    setErro(null);
  };
  return { previa, concluido, erro, ocupado, enviar, limpar, confirmando, setConfirmando };
}

function acoesUteis(r: ResultadoImportacao) {
  return r.resumo.CRIAR + r.resumo.ATUALIZAR + r.resumo.CANCELAR;
}

function ImportarBokun() {
  const [texto, setTexto] = useState("");
  const imp = useImportacao("/api/importacoes/bokun-email");
  const emails = separarEmails(texto);

  return (
    <div className="importar">
      <div className="campo">
        <label htmlFor="bokun-texto">Texto dos e-mails “New booking” / “Cancelled booking” da Bókun</label>
        <textarea
          id="bokun-texto"
          rows={14}
          className="mono"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            imp.limpar();
          }}
          aria-describedby="bokun-ajuda"
          spellCheck={false}
        />
        <p id="bokun-ajuda" className="campo__ajuda">
          Cole um ou mais e-mails. Separe cada e-mail com uma linha contendo apenas <code>-----</code>. A primeira linha de cada bloco pode ser o assunto (ex.: “Cancelled booking: …”).{" "}
          {texto.trim() && <strong>{emails.length} e-mail(s) detectado(s).</strong>}
        </p>
      </div>
      <div className="barra-acoes">
        <button type="button" className="botao botao--secundario" disabled={!emails.length || imp.ocupado} onClick={() => void imp.enviar({ emails }, false)}>
          {imp.ocupado && !imp.confirmando ? "Lendo…" : "Pré-visualizar"}
        </button>
        <button type="button" className="botao botao--primario" disabled={!imp.previa || acoesUteis(imp.previa) === 0 || imp.ocupado} onClick={() => imp.setConfirmando(true)}>
          Confirmar importação
        </button>
      </div>
      <ResultadoArea imp={imp} aoConfirmar={() => void imp.enviar({ emails }, true)} aoNova={() => setTexto("")} />
    </div>
  );
}

function ImportarPaytour() {
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<{ nome: string; codificacao: string; linhas: number } | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const imp = useImportacao("/api/importacoes/paytour-csv");

  async function escolher(e: ChangeEvent<HTMLInputElement>) {
    imp.limpar();
    setErroArquivo(null);
    setConteudo(null);
    setArquivo(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return setErroArquivo("Escolha um arquivo .csv exportado da Paytour.");
    if (f.size > LIMITE_BYTES) return setErroArquivo("Arquivo muito grande (máximo 4,5 MB). Exporte um período menor.");
    try {
      const { texto, codificacao } = decodificarCsv(await lerArquivo(f));
      setConteudo(texto);
      setArquivo({ nome: f.name, codificacao, linhas: texto.split(/\r?\n/).filter((l) => l.trim()).length });
    } catch (err) {
      setErroArquivo(mensagemDeErro(err));
    }
  }

  return (
    <div className="importar">
      <div className="campo">
        <label htmlFor="paytour-arquivo">Arquivo CSV exportado da Paytour</label>
        <input id="paytour-arquivo" type="file" accept=".csv,text/csv" onChange={(e) => void escolher(e)} aria-describedby="paytour-ajuda" />
        <p id="paytour-ajuda" className="campo__ajuda">
          O arquivo é lido no seu navegador e enviado ao servidor só ao pré-visualizar. Reimportar o mesmo arquivo não duplica reservas.
        </p>
      </div>
      {erroArquivo && <Aviso tipo="erro">{erroArquivo}</Aviso>}
      {arquivo && (
        <p className="texto-fraco">
          {arquivo.nome} · {arquivo.linhas} linha(s) · codificação {arquivo.codificacao}
        </p>
      )}
      <div className="barra-acoes">
        <button type="button" className="botao botao--secundario" disabled={!conteudo || imp.ocupado} onClick={() => void imp.enviar({ conteudo }, false)}>
          {imp.ocupado && !imp.confirmando ? "Lendo…" : "Pré-visualizar"}
        </button>
        <button type="button" className="botao botao--primario" disabled={!imp.previa || acoesUteis(imp.previa) === 0 || imp.ocupado} onClick={() => imp.setConfirmando(true)}>
          Confirmar importação
        </button>
      </div>
      <ResultadoArea imp={imp} aoConfirmar={() => void imp.enviar({ conteudo }, true)} aoNova={() => setConteudo(null)} />
    </div>
  );
}

function ResultadoArea({ imp, aoConfirmar, aoNova }: { imp: ReturnType<typeof useImportacao>; aoConfirmar: () => void; aoNova: () => void }) {
  return (
    <>
      {imp.erro && <Aviso tipo="erro">{imp.erro}</Aviso>}
      {imp.previa && acoesUteis(imp.previa) === 0 && <Aviso tipo="info">Nada a importar: todas as linhas seriam ignoradas.</Aviso>}
      {imp.previa && <TabelaPrevia resultado={imp.previa} />}
      {imp.concluido && (
        <>
          <Aviso tipo="sucesso" titulo="Importação concluída">
            {imp.concluido.resumo.CRIAR} reserva(s) criada(s), {imp.concluido.resumo.ATUALIZAR} atualizada(s), {imp.concluido.resumo.CANCELAR} cancelada(s),{" "}
            {imp.concluido.resumo.IGNORAR} ignorada(s). Confira os avisos na lista de passageiros de cada saída.
          </Aviso>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => {
              imp.limpar();
              aoNova();
            }}
          >
            Nova importação
          </button>
          <TabelaPrevia resultado={imp.concluido} />
        </>
      )}
      {imp.previa && (
        <Confirmar
          aberto={imp.confirmando}
          titulo="Confirmar importação?"
          textoConfirmar="Importar agora"
          ocupado={imp.ocupado}
          aoFechar={() => imp.setConfirmando(false)}
          aoConfirmar={aoConfirmar}
          mensagem={
            <p>
              Serão criadas {imp.previa.resumo.CRIAR}, atualizadas {imp.previa.resumo.ATUALIZAR} e canceladas {imp.previa.resumo.CANCELAR} reserva(s). Saídas que ainda não existem
              serão criadas automaticamente.
            </p>
          }
        />
      )}
    </>
  );
}

export function Importar() {
  const [aba, setAba] = useState<"bokun" | "paytour">("bokun");
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Importar reservas</h1>
          <p className="pagina__descricao">Sempre pré-visualize antes de confirmar. Avisos indicam o que precisa de ajuste manual.</p>
        </div>
      </div>
      <div className="abas" role="tablist" aria-label="Origem da importação">
        <button type="button" role="tab" id="aba-bokun" aria-selected={aba === "bokun"} aria-controls="painel-importar" className={`aba${aba === "bokun" ? " aba--ativa" : ""}`} onClick={() => setAba("bokun")}>
          Bókun / Viator (e-mail)
        </button>
        <button type="button" role="tab" id="aba-paytour" aria-selected={aba === "paytour"} aria-controls="painel-importar" className={`aba${aba === "paytour" ? " aba--ativa" : ""}`} onClick={() => setAba("paytour")}>
          Paytour (CSV)
        </button>
      </div>
      <div id="painel-importar" role="tabpanel" aria-labelledby={`aba-${aba}`}>
        {aba === "bokun" ? <ImportarBokun /> : <ImportarPaytour />}
      </div>
    </div>
  );
}
