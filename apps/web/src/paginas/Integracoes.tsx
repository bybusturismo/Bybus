import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { ResultadoSincronizacaoPaytour, SituacaoIntegracao } from "../api/tipos";
import { Aviso, Carregando, ErroCarga } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { useNotificar } from "../componentes/Notificacoes";
import { formatarDataHora, hojeIso, plural } from "../util/formato";
import { useCarregar } from "../util/useCarregar";
import { TabelaPrevia } from "./importar/Importar";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Resumo legível do último resultado ("12 novas · 3 atualizadas · 1 cancelada"). */
export function resumoResultado(bruto: Record<string, unknown> | null | undefined): string {
  if (!bruto) return "Ainda não rodou.";
  // Paytour grava { pedidos, resumo: { CRIAR… } }; o robô de e-mails grava as contagens direto.
  const r: Record<string, unknown> = { ...bruto, ...(typeof bruto.resumo === "object" && bruto.resumo ? (bruto.resumo as Record<string, unknown>) : {}) };
  const partes = [
    typeof r.pedidos === "number" ? plural(r.pedidos, "pedido lido", "pedidos lidos") : typeof r.mensagens === "number" ? plural(r.mensagens, "e-mail lido", "e-mails lidos") : null,
    num(r.CRIAR) ? plural(num(r.CRIAR), "reserva nova", "reservas novas") : null,
    num(r.ATUALIZAR) ? plural(num(r.ATUALIZAR), "atualizada", "atualizadas") : null,
    num(r.CANCELAR) ? plural(num(r.CANCELAR), "cancelada", "canceladas") : null,
    num(r.IGNORAR) ? plural(num(r.IGNORAR), "ignorada", "ignoradas") : null,
    num(r.semLeitor) ? `${num(r.semLeitor)} aguardando leitor` : null,
    num(r.precisamAtencao) ? `${plural(num(r.precisamAtencao), "e-mail da Decolar pede", "e-mails da Decolar pedem")} resposta da equipe` : null,
  ].filter(Boolean);
  return partes.join(" · ") || "Nada novo.";
}

function Situacao({ s }: { s: SituacaoIntegracao }) {
  return (
    <dl className="integracao__situacao">
      <div>
        <dt>Situação</dt>
        <dd>{s.configurada ? <span className="etiqueta etiqueta--sucesso">Ligada</span> : <span className="etiqueta etiqueta--neutra">Desligada</span>}</dd>
      </div>
      <div>
        <dt>Última execução</dt>
        <dd>{s.ultimaExecucaoEm ? formatarDataHora(s.ultimaExecucaoEm) : "—"}</dd>
      </div>
      <div className="integracao__resultado">
        <dt>Resultado</dt>
        <dd>{resumoResultado(s.ultimoResultado)}</dd>
      </div>
    </dl>
  );
}

function CartaoPaytour() {
  const notificar = useNotificar();
  const situacao = useCarregar((sinal) => api.get<SituacaoIntegracao>("/api/integracoes/paytour", sinal), []);
  const [desde, setDesde] = useState("");
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoSincronizacaoPaytour | null>(null);

  async function sincronizar(e?: FormEvent) {
    e?.preventDefault();
    setRodando(true);
    setErro(null);
    try {
      const r = await api.post<ResultadoSincronizacaoPaytour>("/api/integracoes/paytour/sincronizar", desde ? { desde } : {});
      setResultado(r);
      notificar(`Paytour sincronizada: ${resumoResultado({ pedidos: r.pedidos, ...r.resumo })}.`);
      await situacao.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setRodando(false);
    }
  }

  const s = situacao.dados;
  return (
    <section className="cartao integracao tinta--rosa" aria-labelledby="titulo-paytour">
      <header className="integracao__cabecalho">
        <span className="integracao__icone" aria-hidden="true">
          <Icone nome="bilhete" tamanho={22} />
        </span>
        <div>
          <h2 id="titulo-paytour">Paytour</h2>
          <p className="texto-fraco">Site, quiosque, afiliados e Civitatis. Busca pedidos novos e alterados{s?.automaticaACadaMinutos ? ` a cada ${plural(s.automaticaACadaMinutos, "minuto")}` : ""}.</p>
        </div>
      </header>
      {situacao.carregando && !s ? <Carregando /> : situacao.erro ? <ErroCarga mensagem={situacao.erro} tentarDeNovo={situacao.recarregar} /> : s && (
        <>
          <Situacao s={s} />
          {s.ultimoErro && <Aviso tipo="erro" titulo="Última tentativa falhou">{s.ultimoErro}</Aviso>}
          {!s.configurada && <Aviso tipo="info">Para ligar, o servidor precisa das variáveis PAYTOUR_APP_KEY e PAYTOUR_APP_SECRET (aplicativo criado na Paytour em Avançado → Aplicativos).</Aviso>}
          {s.configurada && (
            <form className="integracao__acoes" onSubmit={sincronizar}>
              <div className="campo campo--linha">
                <label htmlFor="paytour-desde">Reler desde</label>
                <input id="paytour-desde" type="date" max={hojeIso()} value={desde} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <button type="submit" className="botao botao--primario" disabled={rodando}>
                {rodando ? "Sincronizando…" : desde ? "Reler a partir da data" : "Sincronizar agora"}
              </button>
            </form>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {resultado && <TabelaPrevia resultado={resultado} />}
        </>
      )}
    </section>
  );
}

function CartaoEmails() {
  const situacao = useCarregar((sinal) => api.get<SituacaoIntegracao>("/api/integracoes/emails", sinal), []);
  const s = situacao.dados;
  return (
    <section className="cartao integracao tinta--azul" aria-labelledby="titulo-emails">
      <header className="integracao__cabecalho">
        <span className="integracao__icone" aria-hidden="true">
          <Icone nome="importar" tamanho={22} />
        </span>
        <div>
          <h2 id="titulo-emails">E-mails de reserva (robô do Gmail)</h2>
          <p className="texto-fraco">Tripadvisor/Viator (avisos da Bókun em admbybus@) e Decolar (contatofbyb@), a cada 5 minutos.</p>
        </div>
      </header>
      {situacao.carregando && !s ? <Carregando /> : situacao.erro ? <ErroCarga mensagem={situacao.erro} tentarDeNovo={situacao.recarregar} /> : s && (
        <>
          <Situacao s={s} />
          <ul className="integracao__canais">
            <li>
              <span className="etiqueta etiqueta--sucesso">Pronto</span> Tripadvisor/Viator — reserva nova, alterada e cancelada. A Viator não informa o ponto de embarque: a reserva entra no bloco “a definir”.
            </li>
            <li>
              <span className="etiqueta etiqueta--sucesso">Pronto</span> Decolar — nova reserva (titular, quantidade por faixa, data e códigos PAM/Decolar). Também sem ponto de embarque. A Decolar não avisa cancelamento automaticamente: mudanças e estornos chegam como conversa e são marcados aqui para a equipe responder (o cancelamento é feito na saída).
            </li>
          </ul>
          {!s.configurada && <Aviso tipo="info">Para ligar: no servidor, a variável INTEGRACAO_EMAIL_TOKEN; em cada caixa do Gmail, o robô do arquivo integracoes/gmail (passo a passo no README).</Aviso>}
        </>
      )}
    </section>
  );
}

interface SituacaoMeta {
  provedor: string; configurada: boolean; numeroConfigurado: boolean; avisosLigados: boolean; enderecoAvisos: string | null; erro: string | null;
  modelos: Array<{ nome: string; descricao: string; status: string; motivo: string | null }>;
}
const ROTULO_MODELO: Record<string, { texto: string; classe: string }> = {
  APPROVED: { texto: "Aprovado", classe: "etiqueta--sucesso" }, PENDING: { texto: "Em análise", classe: "etiqueta--neutra" },
  REJECTED: { texto: "Recusado", classe: "etiqueta--perigo" }, PAUSED: { texto: "Pausado", classe: "etiqueta--atencao" },
  DISABLED: { texto: "Desativado", classe: "etiqueta--perigo" }, NAO_ENVIADO: { texto: "Não enviado", classe: "etiqueta--neutra" },
};

/** WhatsApp oficial da Meta (ADR 0010): conexão e modelos de mensagem aprovados. */
function CartaoWhatsappMeta() {
  const notificar = useNotificar();
  const sit = useCarregar((sinal) => api.get<SituacaoMeta>("/api/whatsapp/meta", sinal), []);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const s = sit.dados;
  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{ enviados: string[]; erros: Array<{ nome: string; erro: string }> }>("/api/whatsapp/meta/modelos/enviar");
      notificar(r.enviados.length ? `${plural(r.enviados.length, "modelo enviado", "modelos enviados")} para aprovação.` : "Nenhum modelo novo para enviar.");
      if (r.erros.length) setErro(r.erros.map((e) => `${e.nome}: ${e.erro}`).join(" · "));
      await sit.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }
  const faltam = s?.modelos.some((m) => m.status === "NAO_ENVIADO");
  return (
    <section className="cartao integracao tinta--verde" aria-labelledby="titulo-wa-meta">
      <header className="integracao__cabecalho">
        <span className="integracao__icone" aria-hidden="true"><Icone nome="mensagem" tamanho={22} /></span>
        <div>
          <h2 id="titulo-wa-meta">WhatsApp oficial (Meta)</h2>
          <p className="texto-fraco">Mensagens aos clientes pelo número oficial da By Bus. Fora das 24 h desde a última mensagem do cliente, só saem os modelos aprovados pela Meta.</p>
        </div>
      </header>
      {sit.carregando && !s ? <Carregando /> : sit.erro ? <ErroCarga mensagem={sit.erro} tentarDeNovo={sit.recarregar} /> : s && (
        <>
          <ul className="integracao__canais">
            <li><span className={`etiqueta ${s.provedor === "meta" ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{s.provedor === "meta" ? "Ligado" : "Desligado"}</span> Envio pelo WhatsApp oficial{s.provedor !== "meta" ? ` (hoje: ${s.provedor === "simulado" ? "modo simulado" : s.provedor})` : ""}.</li>
            <li><span className={`etiqueta ${s.configurada && s.numeroConfigurado ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{s.configurada && s.numeroConfigurado ? "Pronto" : "Falta"}</span> Chave de acesso, número e conta do WhatsApp Business no servidor.</li>
            <li><span className={`etiqueta ${s.avisosLigados ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{s.avisosLigados ? "Pronto" : "Falta"}</span> Recebimento das mensagens dos clientes{s.enderecoAvisos ? <> — endereço para cadastrar na Meta: <code>{s.enderecoAvisos}</code></> : ""}.</li>
          </ul>
          {s.erro && <Aviso tipo="erro">Não consegui consultar a Meta ({s.erro}). Confira a chave de acesso.</Aviso>}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {s.modelos.length > 0 && (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead><tr><th>Modelo</th><th>Situação</th></tr></thead>
                <tbody>
                  {s.modelos.map((m) => (
                    <tr key={m.nome}>
                      <td>{m.descricao}<div className="texto-fraco">{m.nome}</div></td>
                      <td><span className={`etiqueta ${(ROTULO_MODELO[m.status] ?? ROTULO_MODELO.PENDING!).classe}`}>{(ROTULO_MODELO[m.status] ?? { texto: m.status }).texto}</span>{m.motivo && <div className="texto-fraco">{m.motivo}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.configurada && faltam && <button type="button" className="botao botao--primario" disabled={enviando} onClick={() => void enviar()}>{enviando ? "Enviando…" : "Enviar modelos para aprovação"}</button>}
          {!s.configurada && <Aviso tipo="info">Para ligar: concluir a verificação da empresa e o número na Meta; depois a chave de acesso vai direto no servidor (nunca no chat). Passo a passo em docs/produto/modulo-whatsapp.md.</Aviso>}
        </>
      )}
    </section>
  );
}

export function Integracoes() {
  return (
    <div className="pagina pagina--estreita">
      <div className="pagina__cabecalho">
        <div>
          <h1>Integrações</h1>
          <p className="pagina__descricao">De onde vêm as reservas que montam a lista de passageiros. Tudo entra sem duplicar: o mesmo pedido lido de novo só é atualizado.</p>
        </div>
      </div>
      <CartaoPaytour />
      <CartaoEmails />
      <CartaoWhatsappMeta />
    </div>
  );
}
