import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import type { BlocoManifesto, RespostaManifesto, StatusEmbarque } from "../../api/tipos";
import { Aviso, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useSessao } from "../../sessao/Sessao";
import { ROTULO_CATEGORIA, ROTULO_EMBARQUE } from "../../util/rotulos";
import { useSaida } from "./SaidaLayout";

export function contarBloco(b: BlocoManifesto) {
  const esperados = b.linhas.length;
  const embarcados = b.linhas.filter((l) => l.passageiro.embarque === "EMBARCOU").length;
  const noShow = b.linhas.filter((l) => l.passageiro.embarque === "NO_SHOW").length;
  return { esperados, embarcados, noShow, pendentes: esperados - embarcados - noShow };
}

function chaveBloco(b: BlocoManifesto) {
  return b.ponto?.id ?? "a-definir";
}

/** Atualiza o status de um passageiro dentro da resposta do manifesto (atualização otimista). */
export function comEmbarque(dados: RespostaManifesto, passageiroId: string, status: StatusEmbarque): RespostaManifesto {
  const blocos = dados.manifesto.blocos.map((b) => ({
    ...b,
    linhas: b.linhas.map((l) => (l.passageiro.id === passageiroId ? { ...l, passageiro: { ...l.passageiro, embarque: status } } : l)),
  }));
  const todas = blocos.flatMap((b) => b.linhas);
  return {
    ...dados,
    manifesto: {
      ...dados.manifesto,
      blocos,
      totais: {
        ...dados.manifesto.totais,
        embarcados: todas.filter((l) => l.passageiro.embarque === "EMBARCOU").length,
        noShow: todas.filter((l) => l.passageiro.embarque === "NO_SHOW").length,
      },
    },
  };
}

/**
 * Modo embarque — para a guia no celular: um ponto por vez, botões grandes, alto contraste.
 * Telefone dos clientes não aparece nesta tela.
 */
export function Embarque() {
  const { dados, carga } = useSaida();
  const { pode } = useSessao();
  const podeRegistrar = pode("embarque:registrar");
  const blocos = dados.manifesto.blocos;
  const [ativo, setAtivo] = useState<string>(() => {
    const primeiroPendente = blocos.find((b) => contarBloco(b).pendentes > 0);
    return chaveBloco(primeiroPendente ?? blocos[0] ?? { ponto: null, linhas: [] });
  });
  const [enviando, setEnviando] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  const total = dados.manifesto.totais;
  const bloco = blocos.find((b) => chaveBloco(b) === ativo) ?? blocos[0];

  async function marcar(passageiroId: string, status: StatusEmbarque, anterior: StatusEmbarque) {
    setErro(null);
    setEnviando((s) => new Set(s).add(passageiroId));
    carga.definir((d) => (d ? comEmbarque(d, passageiroId, status) : d));
    try {
      await api.post(`/api/passageiros/${passageiroId}/embarque`, { status });
    } catch (e) {
      carga.definir((d) => (d ? comEmbarque(d, passageiroId, anterior) : d));
      setErro(`Não foi possível registrar: ${mensagemDeErro(e)}`);
    } finally {
      setEnviando((s) => {
        const n = new Set(s);
        n.delete(passageiroId);
        return n;
      });
    }
  }

  if (blocos.length === 0) return <Vazio titulo="Nenhum passageiro confirmado nesta saída." />;

  const esperados = total.passageiros;
  return (
    <div className="embarque">
      <div className="embarque__placar" role="status" aria-live="polite">
        <div>
          <span className="embarque__numero">{total.embarcados}</span>
          <span className="embarque__de">de {esperados} embarcados</span>
        </div>
        <div className="embarque__secundario">
          {total.noShow > 0 && <span>{total.noShow} não vieram</span>}
          <span>{esperados - total.embarcados - total.noShow} aguardando</span>
        </div>
        <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void carga.recarregar()} disabled={carga.carregando}>
          {carga.carregando ? "Atualizando…" : "Atualizar"}
        </button>
      </div>

      {!podeRegistrar && <Aviso tipo="info">Seu perfil pode ver o embarque, mas não registrá-lo.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="embarque__pontos" role="tablist" aria-label="Pontos de embarque, em ordem">
        {blocos.map((b) => {
          const c = contarBloco(b);
          const k = chaveBloco(b);
          const sel = k === chaveBloco(bloco!);
          return (
            <button
              key={k}
              type="button"
              role="tab"
              id={`aba-${k}`}
              aria-selected={sel}
              aria-controls="painel-embarque"
              className={`ponto-aba${sel ? " ponto-aba--ativa" : ""}${c.pendentes === 0 ? " ponto-aba--concluida" : ""}${b.ponto ? "" : " ponto-aba--a-definir"}`}
              onClick={() => setAtivo(k)}
            >
              <span className="ponto-aba__hora">{b.ponto?.horario ?? "—"}</span>
              <span className="ponto-aba__nome">{b.ponto?.nome ?? "A DEFINIR"}</span>
              <span className="ponto-aba__conta">
                {c.embarcados}/{c.esperados}
              </span>
            </button>
          );
        })}
      </div>

      {bloco && (
        <section id="painel-embarque" role="tabpanel" aria-labelledby={`aba-${chaveBloco(bloco)}`} className="embarque__painel">
          <header className="embarque__ponto">
            <h2>
              {bloco.ponto ? `${bloco.ponto.horario} — ${bloco.ponto.nome}` : "A DEFINIR — sem ponto"}
            </h2>
            {bloco.ponto?.endereco && <p>{bloco.ponto.endereco}</p>}
          </header>
          <ul className="embarque__lista">
            {bloco.linhas.map((l) => {
              const p = l.passageiro;
              const ocupado = enviando.has(p.id);
              return (
                <li key={p.id} className={`pax pax--${p.embarque.toLowerCase()}`}>
                  <div className="pax__info">
                    <span className="pax__num">{l.numero}</span>
                    <div>
                      <p className="pax__nome">{p.nome.trim() || "(a informar)"}</p>
                      <p className="pax__detalhe">
                        {ROTULO_CATEGORIA[p.categoria]} · titular {l.contatoNome}
                        {l.codigoExterno ? ` · ${l.codigoExterno}` : ""}
                      </p>
                      {p.embarque !== "PENDENTE" && <p className="pax__status">{ROTULO_EMBARQUE[p.embarque]}</p>}
                    </div>
                  </div>
                  {podeRegistrar && (
                    <div className="pax__acoes">
                      {p.embarque === "PENDENTE" ? (
                        <>
                          <button
                            type="button"
                            className="botao-embarque botao-embarque--sim"
                            disabled={ocupado}
                            onClick={() => void marcar(p.id, "EMBARCOU", p.embarque)}
                            aria-label={`Embarcou: ${p.nome || `passageiro ${l.numero}`}`}
                          >
                            <Icone nome="check" tamanho={24} /> Embarcou
                          </button>
                          <button
                            type="button"
                            className="botao-embarque botao-embarque--nao"
                            disabled={ocupado}
                            onClick={() => void marcar(p.id, "NO_SHOW", p.embarque)}
                            aria-label={`Não compareceu: ${p.nome || `passageiro ${l.numero}`}`}
                          >
                            <Icone nome="x" tamanho={24} /> Não veio
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="botao-embarque botao-embarque--desfazer"
                          disabled={ocupado}
                          onClick={() => void marcar(p.id, "PENDENTE", p.embarque)}
                          aria-label={`Desfazer registro de ${p.nome || `passageiro ${l.numero}`}`}
                        >
                          <Icone nome="desfazer" tamanho={22} /> Desfazer
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
