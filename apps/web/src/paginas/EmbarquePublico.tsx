import { useEffect, useState, type FormEvent } from "react";
import { mensagemDeErro, requisitar } from "../api/cliente";
import logoVertical from "../marca/bybus-vertical.png";

interface PontoPublico { id: string; nome: string; horario: string; endereco: string | null; ehTransfer: boolean }
interface InfoEmbarque {
  passeio: string; cidade: string; data: string; titular: string; passageiros: number;
  pontos: PontoPublico[];
  escolha: { pontoId: string | null; hospedagem: string | null; pediuTransfer: boolean } | null;
  conferida: boolean; listaFechada: boolean;
}

const dataLonga = (iso: string) => {
  const t = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Página do link de embarque (sem login): o passageiro informa a hospedagem e escolhe o ponto. */
export function EmbarquePublico({ token }: { token: string }) {
  const [info, setInfo] = useState<InfoEmbarque | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [hospedagem, setHospedagem] = useState("");
  const [sugeridos, setSugeridos] = useState<Array<{ pontoId: string; porque: string }> | null>(null);
  const [pontoId, setPontoId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ nome: string; horario: string; endereco: string | null } | null>(null);
  const base = `/api/publico/embarque/${encodeURIComponent(token)}`;

  useEffect(() => {
    requisitar<InfoEmbarque>(base)
      .then((i) => {
        setInfo(i);
        setHospedagem(i.escolha?.hospedagem ?? "");
        setPontoId(i.escolha?.pontoId ?? "");
      })
      .catch((e) => setErro(mensagemDeErro(e)));
  }, [base]);

  async function sugerir(e: FormEvent) {
    e.preventDefault();
    if (hospedagem.trim().length < 2) return;
    try {
      const r = await requisitar<{ sugestoes: Array<{ pontoId: string; porque: string }> }>(`${base}/sugestao`, { metodo: "POST", corpo: { hospedagem: hospedagem.trim() } });
      setSugeridos(r.sugestoes);
      if (r.sugestoes[0]) setPontoId(r.sugestoes[0].pontoId);
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await requisitar<{ ponto: { nome: string; horario: string; endereco: string | null } }>(base, { metodo: "POST", corpo: { pontoId, hospedagem: hospedagem.trim() } });
      setFeito(r.ponto);
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }

  const pontosOrdenados = info ? [...info.pontos].sort((a, b) => Number(!sugeridos?.some((s) => s.pontoId === a.id)) - Number(!sugeridos?.some((s) => s.pontoId === b.id))) : [];
  return (
    <div className="tela-acesso">
      <main className="cartao-acesso cartao-acesso--largo embarque-publico" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logoVertical} alt="By Bus Turismo" width={66} height={96} />
          <h1>Seu embarque</h1>
        </div>
        {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
        {!info && !erro && <p className="texto-fraco">Carregando…</p>}
        {info && feito && (
          <div className="aviso aviso--sucesso" role="status">
            <strong>Pronto, {info.titular}!</strong> Seu embarque: <strong>{feito.horario} — {feito.nome}</strong>{feito.endereco ? ` (${feito.endereco})` : ""}.
            <br />Nossa equipe vai conferir e você recebe a confirmação na véspera. Chegue alguns minutos antes: não há tolerância para atrasos.
          </div>
        )}
        {info && !feito && (
          <>
            <p className="cartao-acesso__subtitulo">
              Olá{info.titular ? `, ${info.titular}` : ""}! <strong>{info.passeio}</strong> — {dataLonga(info.data)} · {info.passageiros} passageiro(s).
            </p>
            {info.listaFechada && (
              <div className="aviso aviso--atencao">A lista deste passeio já foi fechada. Você ainda pode informar o embarque: nossa equipe confirma antes da saída.</div>
            )}
            <>
                <form onSubmit={sugerir} className="campo">
                  <label htmlFor="hospedagem">Onde você vai estar hospedado(a)? (hotel, pousada ou bairro)</label>
                  <div className="embarque-publico__busca">
                    <input id="hospedagem" value={hospedagem} maxLength={200} onChange={(e) => setHospedagem(e.target.value)} placeholder="Ex.: Hotel Mercure, Ingleses…" autoComplete="off" />
                    <button type="submit" className="botao botao--secundario">Sugerir ponto</button>
                  </div>
                  {sugeridos && <p className="campo__ajuda">{sugeridos.length ? "Sugerimos o ponto mais próximo pelo que você informou. Confira e confirme." : "Não reconhecemos esse local: escolha o ponto mais perto na lista abaixo."}</p>}
                </form>
                <fieldset className="grupo-opcoes embarque-publico__pontos">
                  <legend>Ponto de embarque</legend>
                  {pontosOrdenados.map((p) => {
                    const sug = sugeridos?.find((s) => s.pontoId === p.id);
                    return (
                      <label key={p.id} className={`embarque-publico__ponto${pontoId === p.id ? " embarque-publico__ponto--escolhido" : ""}`}>
                        <input type="radio" name="ponto" value={p.id} checked={pontoId === p.id} onChange={() => setPontoId(p.id)} />
                        <span>
                          <strong>{p.horario} — {p.nome}</strong>
                          {sug && <span className="etiqueta etiqueta--sucesso">sugerido · {sug.porque}</span>}
                          {p.ehTransfer && <span className="etiqueta etiqueta--atencao">transfer (custo adicional)</span>}
                          {p.endereco && <span className="campo__ajuda">{p.endereco}</span>}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
                <button type="button" className="botao botao--primario botao--bloco" disabled={!pontoId || enviando} onClick={() => void confirmar()}>
                  {enviando ? "Enviando…" : "Confirmar meu ponto de embarque"}
                </button>
            </>
          </>
        )}
      </main>
    </div>
  );
}
