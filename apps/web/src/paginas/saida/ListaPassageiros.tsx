import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import type { Alerta, BlocoManifesto, Pessoa, Saida, StatusSaida } from "../../api/tipos";
import { Aviso, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarData, formatarDataExtenso, formatarDataHora, hojeIso } from "../../util/formato";
import { ROTULO_CANAL, ROTULO_CATEGORIA, ROTULO_DOCUMENTO, ROTULO_EMBARQUE, ROTULO_NIVEL } from "../../util/rotulos";
import { useSaida } from "./SaidaLayout";

const ORDEM_NIVEL = { critico: 0, atencao: 1, info: 2 } as const;

export function ordenarAlertas(alertas: Alerta[]): Alerta[] {
  return [...alertas].sort((a, b) => ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]);
}

export function PainelAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) {
    return (
      <section className="painel-alertas painel-alertas--ok nao-imprimir" aria-label="Alertas">
        <p>
          <Icone nome="check" /> Nenhum alerta para esta saída.
        </p>
      </section>
    );
  }
  return (
    <section className="painel-alertas" aria-labelledby="titulo-alertas">
      <h2 id="titulo-alertas" className="painel-alertas__titulo">
        <Icone nome="alerta" /> Alertas ({alertas.length})
      </h2>
      <ul>
        {ordenarAlertas(alertas).map((a, i) => (
          <li key={`${a.codigo}-${i}`} className={`alerta alerta--${a.nivel}`}>
            <span className="alerta__nivel">{ROTULO_NIVEL[a.nivel]}</span>
            <span>{a.mensagem}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function tituloBloco(b: BlocoManifesto): string {
  return b.ponto ? `${b.ponto.horario} — ${b.ponto.nome}` : "A DEFINIR — sem ponto de embarque";
}

/** Normaliza para busca sem acento e sem caixa. */
function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function BlocoPassageiros({ bloco, filtro }: { bloco: BlocoManifesto; filtro: string }) {
  const f = norm(filtro.trim());
  const visiveis = bloco.linhas.filter(
    (l) => !f || norm(l.passageiro.nome).includes(f) || norm(l.contatoNome).includes(f) || norm(l.codigoExterno).includes(f) || String(l.numero) === f,
  );
  const id = `bloco-${bloco.ponto?.id ?? "a-definir"}`;
  return (
    <section className={`bloco${bloco.ponto ? "" : " bloco--a-definir"}${f && visiveis.length === 0 ? " oculto-na-tela" : ""}`} aria-labelledby={id}>
      <header className="bloco__cabecalho">
        <h2 id={id} className="bloco__titulo">
          {tituloBloco(bloco)}
        </h2>
        {bloco.ponto?.endereco && <p className="bloco__endereco">{bloco.ponto.endereco}</p>}
        {!bloco.ponto && <p className="bloco__endereco">Contatar o cliente (WhatsApp ou painel da OTA) para definir o ponto.</p>}
        <span className="bloco__contagem">{bloco.linhas.length} pax</span>
      </header>
      <div className="tabela-rolagem">
        <table className="tabela tabela--manifesto">
          <thead>
            <tr>
              <th scope="col" className="col-num">
                Nº
              </th>
              <th scope="col">Passageiro</th>
              <th scope="col">Categoria</th>
              <th scope="col">Documento</th>
              <th scope="col">Titular</th>
              <th scope="col">Canal</th>
              <th scope="col">Código</th>
              <th scope="col">Embarque</th>
              <th scope="col" className="so-impressao col-check">
                ✓
              </th>
            </tr>
          </thead>
          <tbody>
            {bloco.linhas.map((l) => {
              const oculto = f && !visiveis.includes(l);
              const p = l.passageiro;
              return (
                <tr key={p.id} className={`${oculto ? "oculto-na-tela" : ""} embarque--${p.embarque.toLowerCase()}`}>
                  <td className="col-num">{l.numero}</td>
                  <td>{p.nome.trim() ? p.nome : <em className="texto-fraco">(a informar)</em>}</td>
                  <td>{ROTULO_CATEGORIA[p.categoria]}</td>
                  <td className="col-doc">
                    {p.documento ? (
                      <>
                        {p.documentoTipo && <span className="texto-fraco">{ROTULO_DOCUMENTO[p.documentoTipo]} </span>}
                        <span className="mono">{p.documento}</span>
                        {p.documentoValido === false && <span className="etiqueta etiqueta--perigo">inválido</span>}
                      </>
                    ) : (
                      <span className="texto-fraco">—</span>
                    )}
                  </td>
                  <td>{l.contatoNome}</td>
                  <td>{ROTULO_CANAL[l.canal]}</td>
                  <td className="mono">{l.codigoExterno ?? "—"}</td>
                  <td>
                    <span className={`etiqueta etiqueta--embarque-${p.embarque.toLowerCase()}`}>{ROTULO_EMBARQUE[p.embarque]}</span>
                  </td>
                  <td className="so-impressao col-check">
                    <span className="caixa-check" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bloco.linhas.some((l) => l.observacoes) && (
        <ul className="bloco__obs">
          {[...new Map(bloco.linhas.filter((l) => l.observacoes).map((l) => [l.reservaId, l])).values()].map((l) => (
            <li key={l.reservaId}>
              <strong>{l.contatoNome}:</strong> {l.observacoes}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TEXTO_ANTIGO = "__texto__";

/** Opções de guia/motorista: pessoas da praça do passeio (ou sem praça), mais o valor atual se não estiver na lista. */
function opcoesEquipe(pessoas: Pessoa[], atualId: string | null | undefined, atualNome: string | null) {
  const opcoes = pessoas.map((p) => ({ valor: p.id, rotulo: p.idiomas.length ? `${p.nome} (${p.idiomas.join(", ")})` : p.nome }));
  if (atualId && !pessoas.some((p) => p.id === atualId)) opcoes.unshift({ valor: atualId, rotulo: `${atualNome ?? "Pessoa atual"} (inativa ou de outra praça)` });
  if (!atualId && atualNome) opcoes.unshift({ valor: TEXTO_ANTIGO, rotulo: `${atualNome} (digitado antes do cadastro de equipe)` });
  return opcoes;
}

export function EditarEquipe({
  saida,
  unidadeId,
  aberto,
  aoFechar,
  aoSalvar,
}: {
  saida: Saida;
  unidadeId: string | undefined;
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: (mudouCapacidade: boolean) => Promise<void>;
}) {
  const { pode } = useSessao();
  const podeEscalar = pode("pessoas:ver");
  const guiaInicial = saida.guiaId ?? (saida.guia ? TEXTO_ANTIGO : "");
  const motoristaInicial = saida.motoristaId ?? (saida.motorista ? TEXTO_ANTIGO : "");
  const [veiculo, setVeiculo] = useState(saida.veiculo ?? "");
  const [guia, setGuia] = useState(guiaInicial);
  const [motorista, setMotorista] = useState(motoristaInicial);
  const [capacidade, setCapacidade] = useState(String(saida.capacidade));
  const [observacoes, setObservacoes] = useState(saida.observacoes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [equipe, setEquipe] = useState<{ guias: Pessoa[]; motoristas: Pessoa[] } | null>(null);
  const [erroEquipe, setErroEquipe] = useState<string | null>(null);
  const notificar = useNotificar();

  useEffect(() => {
    if (!aberto) return;
    setVeiculo(saida.veiculo ?? "");
    setGuia(guiaInicial);
    setMotorista(motoristaInicial);
    setCapacidade(String(saida.capacidade));
    setObservacoes(saida.observacoes ?? "");
    setErro(null);
    if (!podeEscalar) return;
    const c = new AbortController();
    // Sem filtro de praça na consulta: quem atende "todas as praças" (unidadeId nulo) também pode ser escalado.
    const daPraca = (l: Pessoa[]) => l.filter((p) => !p.unidadeId || !unidadeId || p.unidadeId === unidadeId);
    Promise.all([api.get<Pessoa[]>("/api/pessoas?papel=GUIA", c.signal), api.get<Pessoa[]>("/api/pessoas?papel=MOTORISTA", c.signal)])
      .then(([g, m]) => {
        setEquipe({ guias: daPraca(g), motoristas: daPraca(m) });
        setErroEquipe(null);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setErroEquipe(mensagemDeErro(e));
      });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, saida, podeEscalar, unidadeId]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const cap = Number(capacidade);
    if (!Number.isInteger(cap) || cap < 1 || cap > 200) return setErro("Capacidade deve ser um número entre 1 e 200.");
    setSalvando(true);
    setErro(null);
    const corpo: Record<string, unknown> = { veiculo: veiculo.trim() || null, capacidade: cap, observacoes: observacoes.trim() || null };
    // Só envia guia/motorista se mudou (o nome em texto é preenchido pela API a partir do cadastro).
    if (podeEscalar && guia !== guiaInicial) corpo.guiaId = guia || null;
    if (podeEscalar && motorista !== motoristaInicial) corpo.motoristaId = motorista || null;
    try {
      await api.patch(`/api/saidas/${saida.id}`, corpo);
      notificar("Dados da saída salvos.");
      await aoSalvar(cap !== saida.capacidade);
      aoFechar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const carregandoEquipe = podeEscalar && !equipe && !erroEquipe;
  return (
    <Modal aberto={aberto} titulo="Veículo e equipe" aoFechar={aoFechar}>
      <form onSubmit={salvar} noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroEquipe && <Aviso tipo="erro">Não foi possível carregar guias e motoristas: {erroEquipe}</Aviso>}
        <div className="grade-campos">
          <div className="campo">
            <label htmlFor="eq-veiculo">Veículo (placa)</label>
            <input id="eq-veiculo" maxLength={40} value={veiculo} onChange={(e) => setVeiculo(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="eq-capacidade">Capacidade (assentos)</label>
            <input id="eq-capacidade" type="number" min={1} max={200} value={capacidade} onChange={(e) => setCapacidade(e.target.value)} />
          </div>
          {podeEscalar ? (
            <>
              <div className="campo">
                <label htmlFor="eq-guia">Guia</label>
                <select id="eq-guia" value={guia} onChange={(e) => setGuia(e.target.value)} disabled={carregandoEquipe} aria-describedby="eq-ajuda">
                  <option value="">A definir</option>
                  {opcoesEquipe(equipe?.guias ?? [], saida.guiaId, saida.guia).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="eq-motorista">Motorista</label>
                <select id="eq-motorista" value={motorista} onChange={(e) => setMotorista(e.target.value)} disabled={carregandoEquipe} aria-describedby="eq-ajuda">
                  <option value="">A definir</option>
                  {opcoesEquipe(equipe?.motoristas ?? [], saida.motoristaId, saida.motorista).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </div>
              <p id="eq-ajuda" className="campo__ajuda campo--largo">
                {carregandoEquipe ? "Carregando guias e motoristas…" : "Lista do cadastro “Equipe”: pessoas ativas desta praça ou que atendem todas as praças."}
              </p>
            </>
          ) : (
            <p className="campo__ajuda campo--largo">
              Guia: <strong>{saida.guia || "a definir"}</strong> · Motorista: <strong>{saida.motorista || "a definir"}</strong>. Seu perfil não consulta a equipe; peça ao supervisor
              para escalar.
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor="eq-obs">Observações da saída</label>
          <textarea id="eq-obs" rows={3} maxLength={2000} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </div>
        <div className="modal__acoes">
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao botao--primario" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const TEXTO_STATUS: Record<Exclude<StatusSaida, "PREVISTA">, { titulo: string; botao: string; perigo?: boolean }> = {
  CONFIRMADA: { titulo: "Confirmar a saída?", botao: "Confirmar saída" },
  CANCELADA: { titulo: "Cancelar a saída?", botao: "Cancelar saída", perigo: true },
  REALIZADA: { titulo: "Marcar a saída como realizada?", botao: "Marcar como realizada" },
};

export function ListaPassageiros() {
  const { id, dados, carga, documentosCompletos, setDocumentosCompletos, atualizarCabecalho } = useSaida();
  const { pode } = useSessao();
  const notificar = useNotificar();
  const { saida, passeio, manifesto } = dados;
  const [filtro, setFiltro] = useState("");
  const [impressoEm, setImpressoEm] = useState(() => new Date());
  const [editando, setEditando] = useState(false);
  const [mudarStatus, setMudarStatus] = useState<Exclude<StatusSaida, "PREVISTA"> | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const busca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const antes = () => setImpressoEm(new Date());
    const aoTeclar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        busca.current?.focus();
      }
    };
    window.addEventListener("beforeprint", antes);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("beforeprint", antes);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, []);

  const t = manifesto.totais;
  const csvHref = `/api/saidas/${id}/manifesto.csv${qs({ documentos: documentosCompletos ? "completos" : "mascarados" })}`;
  const abaixoMinimo = t.pagantes < passeio.minimoConfirmacao;
  const categorias = useMemo(() => Object.entries(t.porCategoria).filter(([, n]) => n > 0) as Array<[keyof typeof ROTULO_CATEGORIA, number]>, [t]);

  function imprimir() {
    setImpressoEm(new Date());
    setTimeout(() => window.print(), 50);
  }

  async function aplicarStatus() {
    if (!mudarStatus) return;
    setOcupado(true);
    setErroStatus(null);
    try {
      await api.patch(`/api/saidas/${saida.id}`, { status: mudarStatus });
      notificar(`Saída ${mudarStatus === "CONFIRMADA" ? "confirmada" : mudarStatus === "CANCELADA" ? "cancelada" : "marcada como realizada"}.`);
      setMudarStatus(null);
      await atualizarCabecalho();
    } catch (e) {
      setErroStatus(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="manifesto">
      {/* Cabeçalho que só aparece na impressão */}
      <header className="cabecalho-impressao so-impressao">
        <div className="cabecalho-impressao__linha">
          <strong>Bybus Gestão · Lista de passageiros</strong>
          <span>Impresso em {formatarDataHora(impressoEm)}</span>
        </div>
        <h1>
          {passeio.nome} — {formatarDataExtenso(saida.data)}
        </h1>
        <p>
          Veículo: <strong>{saida.veiculo || "________"}</strong> · Guia: <strong>{saida.guia || "________________"}</strong> · Motorista:{" "}
          <strong>{saida.motorista || "________________"}</strong>
        </p>
        <p>
          {t.passageiros} passageiros · {t.assentos}/{saida.capacidade} assentos · {t.pagantes} pagantes ·{" "}
          {categorias.map(([c, n]) => `${ROTULO_CATEGORIA[c]}: ${n}`).join(" · ")}
        </p>
      </header>

      <section className="resumo" aria-label="Resumo da saída">
        <dl className="resumo__grade">
          <div className="resumo__item">
            <dt>Veículo</dt>
            <dd>{saida.veiculo || <span className="texto-fraco">a definir</span>}</dd>
          </div>
          <div className="resumo__item">
            <dt>Guia</dt>
            <dd>{saida.guia || <span className="texto-fraco">a definir</span>}</dd>
          </div>
          <div className="resumo__item">
            <dt>Motorista</dt>
            <dd>{saida.motorista || <span className="texto-fraco">a definir</span>}</dd>
          </div>
          <div className="resumo__item">
            <dt>Passageiros</dt>
            <dd className="resumo__numero">{t.passageiros}</dd>
          </div>
          <div className="resumo__item">
            <dt>Assentos</dt>
            <dd className={`resumo__numero${t.assentos > saida.capacidade ? " texto-perigo" : ""}`}>
              {t.assentos}/{saida.capacidade}
            </dd>
          </div>
          <div className={`resumo__item ${abaixoMinimo ? "resumo__item--alerta" : "resumo__item--ok"}`}>
            <dt>Pagantes (mín. {passeio.minimoConfirmacao})</dt>
            <dd className="resumo__numero">
              {t.pagantes} <span className="resumo__selo">{abaixoMinimo ? "abaixo do mínimo" : "mínimo atingido"}</span>
            </dd>
          </div>
          <div className="resumo__item resumo__item--largo">
            <dt>Por categoria</dt>
            <dd>
              {categorias.length ? categorias.map(([c, n]) => (
                <span key={c} className="etiqueta etiqueta--neutra">
                  {ROTULO_CATEGORIA[c]}: {n}
                </span>
              )) : "—"}
            </dd>
          </div>
          <div className="resumo__item">
            <dt>Embarque</dt>
            <dd>
              {t.embarcados} embarcados · {t.noShow} não vieram
            </dd>
          </div>
        </dl>
        {saida.observacoes && <p className="resumo__obs">Obs.: {saida.observacoes}</p>}
      </section>

      <div className="barra-ferramentas nao-imprimir" role="toolbar" aria-label="Ações da lista">
        <div className="campo campo--busca">
          <label htmlFor="busca-manifesto" className="visualmente-oculto">
            Buscar passageiro, titular ou código
          </label>
          <input
            id="busca-manifesto"
            ref={busca}
            type="search"
            placeholder="Buscar (atalho /)"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>
        <button type="button" className="botao botao--primario" onClick={imprimir}>
          <Icone nome="imprimir" /> Imprimir
        </button>
        <a className="botao botao--secundario" href={csvHref} download>
          <Icone nome="baixar" /> Exportar CSV
        </a>
        {pode("saidas:gerenciar") && (
          <button type="button" className="botao botao--secundario" onClick={() => setEditando(true)}>
            Veículo e equipe
          </button>
        )}
        {pode("saidas:decidir") && saida.status !== "CONFIRMADA" && saida.status !== "REALIZADA" && (
          <button type="button" className="botao botao--sucesso" onClick={() => setMudarStatus("CONFIRMADA")}>
            Confirmar saída
          </button>
        )}
        {pode("saidas:decidir") && saida.status === "CONFIRMADA" && saida.data <= hojeIso() && (
          <button type="button" className="botao botao--secundario" onClick={() => setMudarStatus("REALIZADA")}>
            Marcar como realizada
          </button>
        )}
        {pode("saidas:decidir") && saida.status !== "CANCELADA" && saida.status !== "REALIZADA" && (
          <button type="button" className="botao botao--perigo-contorno" onClick={() => setMudarStatus("CANCELADA")}>
            Cancelar saída
          </button>
        )}
      </div>

      {pode("manifesto:documentos") && (
        <div className="opcao-documentos nao-imprimir">
          <label className="interruptor">
            <input type="checkbox" checked={documentosCompletos} onChange={(e) => setDocumentosCompletos(e.target.checked)} />
            <span>Mostrar documentos completos</span>
          </label>
          {documentosCompletos && (
            <Aviso tipo="atencao">
              Documentos completos visíveis. <strong>Este acesso fica registrado na auditoria</strong> com seu nome, data e hora. Use só quando necessário (ex.: lista para
              fiscalização) e não compartilhe a tela ou o arquivo.
            </Aviso>
          )}
        </div>
      )}

      {erroStatus && <Aviso tipo="erro">{erroStatus}</Aviso>}

      <PainelAlertas alertas={manifesto.alertas} />

      {manifesto.blocos.length === 0 ? (
        <Vazio titulo="Nenhum passageiro confirmado nesta saída.">Inclua reservas na aba “Reservas” ou importe da Bókun/Paytour.</Vazio>
      ) : (
        manifesto.blocos.map((b) => <BlocoPassageiros key={b.ponto?.id ?? "a-definir"} bloco={b} filtro={filtro} />)
      )}

      <footer className="rodape-impressao so-impressao">
        <div className="rodape-impressao__campo">
          <span>Contagem real de passageiros embarcados:</span>
          <span className="linha-preencher linha-preencher--curta" />
        </div>
        <div className="rodape-impressao__campo">
          <span>Assinatura da guia:</span>
          <span className="linha-preencher" />
        </div>
        <p className="rodape-impressao__nota">
          Saída de {formatarData(saida.data)} · impresso em {formatarDataHora(impressoEm)} · documento com dados pessoais — guardar com cuidado e descartar após o passeio.
        </p>
      </footer>

      <EditarEquipe
        saida={saida}
        unidadeId={passeio.unidadeId}
        aberto={editando}
        aoFechar={() => setEditando(false)}
        aoSalvar={(mudouCapacidade) => (mudouCapacidade ? carga.recarregar() : atualizarCabecalho())}
      />
      {mudarStatus && (
        <Confirmar
          aberto
          titulo={TEXTO_STATUS[mudarStatus].titulo}
          textoConfirmar={TEXTO_STATUS[mudarStatus].botao}
          perigo={TEXTO_STATUS[mudarStatus].perigo}
          ocupado={ocupado}
          aoFechar={() => setMudarStatus(null)}
          aoConfirmar={() => void aplicarStatus()}
          mensagem={
            <>
              <p>
                Saída de <strong>{formatarDataExtenso(saida.data)}</strong>: {t.pagantes} pagante(s), {t.passageiros} passageiro(s).
              </p>
              {mudarStatus === "CONFIRMADA" && abaixoMinimo && (
                <Aviso tipo="atencao">Abaixo do mínimo de {passeio.minimoConfirmacao} pagantes. Confirme só se a decisão foi tomada pelo supervisor.</Aviso>
              )}
              {mudarStatus === "CANCELADA" && (
                <Aviso tipo="atencao">As reservas não são canceladas automaticamente: avise os clientes e remaneje ou cancele cada reserva.</Aviso>
              )}
            </>
          }
        />
      )}
    </div>
  );
}
