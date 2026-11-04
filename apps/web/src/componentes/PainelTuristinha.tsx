import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { EstadoIa, RespostaAssistente } from "../api/tipos";
import { Icone } from "./Icone";
import { Mascote } from "./Mascote";

interface Turno {
  papel: "usuario" | "assistente";
  texto: string;
  erro?: boolean;
}

const SUGESTOES = ["Como estão as saídas de amanhã?", "Qual a ocupação dos passeios nesta semana?", "Há documentos de guias ou motoristas vencendo?", "Quantas reservas por canal nos últimos 7 dias?"];

/**
 * Painel lateral do Turistinha (assistente de IA). Fica numa coluna própria do layout, ao lado do conteúdo —
 * não flutua sobre as telas (no celular ocupa a tela toda enquanto aberto). O histórico fica só neste navegador
 * e só vai ao servidor junto com a próxima pergunta; a IA consulta dados agregados conforme o perfil de quem pergunta.
 */
export function PainelTuristinha({ aoFechar }: { aoFechar: () => void }) {
  const [estado, setEstado] = useState<EstadoIa | null>(null);
  const [falhaEstado, setFalhaEstado] = useState(false);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const c = new AbortController();
    api.get<EstadoIa>("/api/ia/estado", c.signal).then(setEstado).catch((e) => {
      if ((e as Error).name !== "AbortError") setFalhaEstado(true);
    });
    campo.current?.focus();
    return () => c.abort();
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView?.({ block: "end" });
  }, [turnos, pensando]);

  const desligada = falhaEstado || (estado !== null && !estado.ligada);

  async function enviar(pergunta: string) {
    const t = pergunta.trim();
    if (!t || pensando || desligada) return;
    const novos: Turno[] = [...turnos, { papel: "usuario", texto: t }];
    setTurnos(novos);
    setTexto("");
    setPensando(true);
    try {
      const historico = novos.filter((x) => !x.erro).slice(-20).map(({ papel, texto: tx }) => ({ papel, texto: tx }));
      const r = await api.post<RespostaAssistente>("/api/ia/assistente", { mensagens: historico });
      setTurnos((atual) => [...atual, { papel: "assistente", texto: r.resposta }]);
    } catch (e) {
      setTurnos((atual) => [...atual, { papel: "assistente", texto: mensagemDeErro(e), erro: true }]);
    } finally {
      setPensando(false);
      campo.current?.focus();
    }
  }

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    void enviar(texto);
  }

  return (
    <aside className="turistinha nao-imprimir" aria-label="Assistente Turistinha" id="painel-turistinha">
      <header className="turistinha__topo">
        <Mascote tamanho={40} />
        <div className="turistinha__titulo">
          <strong>Turistinha</strong>
          <span>Pergunte sobre saídas, ocupação, reservas e equipe</span>
        </div>
        <button type="button" className="botao botao--fantasma botao--icone" onClick={aoFechar} aria-label="Fechar o Turistinha">
          <Icone nome="x" />
        </button>
      </header>

      <div className="turistinha__mensagens" role="log" aria-live="polite" aria-label="Conversa">
        {desligada && (
          <div className="aviso aviso--atencao" role="status">
            <strong className="aviso__titulo">IA desligada</strong>
            <div>{falhaEstado ? "O assistente não está disponível neste ambiente." : "A chave da IA ainda não foi configurada. O resto do sistema funciona normalmente."}</div>
          </div>
        )}
        {!desligada && turnos.length === 0 && (
          <div className="turistinha__boas-vindas">
            <p>Oi! Eu consulto os dados do sistema para você. Só leio e resumo: não altero nada. Mostro números agregados, nunca dados pessoais.</p>
            <ul className="turistinha__sugestoes">
              {SUGESTOES.map((s) => (
                <li key={s}>
                  <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void enviar(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turnos.map((t, i) => (
          <div key={i} className={`turistinha__balao turistinha__balao--${t.papel}${t.erro ? " turistinha__balao--erro" : ""}`}>
            <span className="turistinha__quem">{t.papel === "usuario" ? "Você" : "Turistinha"}</span>
            <p>{t.texto}</p>
          </div>
        ))}
        {pensando && (
          <div className="turistinha__balao turistinha__balao--assistente" role="status">
            <span className="turistinha__quem">Turistinha</span>
            <p>Consultando os dados…</p>
          </div>
        )}
        <div ref={fim} />
      </div>

      <form className="turistinha__form" onSubmit={aoEnviar}>
        <label htmlFor="pergunta-turistinha" className="visualmente-oculto">
          Sua pergunta
        </label>
        <textarea
          id="pergunta-turistinha"
          ref={campo}
          rows={2}
          maxLength={4000}
          value={texto}
          disabled={desligada}
          placeholder={desligada ? "IA desligada" : "Escreva sua pergunta…"}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar(texto);
            }
          }}
        />
        <button type="submit" className="botao botao--primario" disabled={desligada || pensando || !texto.trim()}>
          Enviar
        </button>
      </form>
      <p className="turistinha__rodape">A IA pode errar: confira números importantes nas telas.</p>
    </aside>
  );
}
