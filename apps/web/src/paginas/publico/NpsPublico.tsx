import { useEffect, useState, type FormEvent } from "react";
import { mensagemDeErro, requisitar } from "../../api/cliente";
import logo from "../../marca/bybus-vertical.png";

type Idioma = "pt" | "en" | "es";
interface Info { passeio: string; data: string; titular: string; idioma: Idioma; respondido: boolean }
interface Resposta { ok: boolean; convite: { viator: boolean; canais: Array<{ tipo: "GOOGLE" | "TRIPADVISOR"; link: string }> } | null; cupom: { codigo: string; texto: string } | null }

const T: Record<Idioma, Record<string, string>> = {
  pt: {
    titulo: "Como foi o seu passeio?", ola: "Olá", pergunta: "De 0 a 10, o quanto você recomendaria a By Bus a um amigo?", pouco: "Nada provável", muito: "Muito provável",
    comentario: "Quer contar mais? (opcional, sem dados pessoais)", aceito: "Aceito receber o convite para avaliar a By Bus publicamente (Google ou Tripadvisor). É opcional e não depende da sua nota.",
    enviar: "Enviar resposta", enviando: "Enviando…", falta: "Escolha uma nota de 0 a 10.", ja: "Esta pesquisa já foi respondida. Obrigado!", obrigado: "Obrigado pela sua resposta!",
    convite: "Se quiser, conte para outras pessoas como foi:", google: "Avaliar no Google", trip: "Avaliar no Tripadvisor", viator: "Como você reservou pela Viator, a avaliação é feita na própria Viator, pelo e-mail ou app da sua reserva.",
    baixa: "Sentimos muito que a experiência não tenha sido boa. Nossa equipe vai olhar o seu comentário com atenção.",
  },
  en: {
    titulo: "How was your tour?", ola: "Hi", pergunta: "From 0 to 10, how likely are you to recommend By Bus to a friend?", pouco: "Not likely", muito: "Very likely",
    comentario: "Want to tell us more? (optional, no personal data)", aceito: "I agree to receive an invitation to review By Bus publicly (Google or Tripadvisor). It is optional and does not depend on your score.",
    enviar: "Send answer", enviando: "Sending…", falta: "Choose a score from 0 to 10.", ja: "This survey has already been answered. Thank you!", obrigado: "Thank you for your answer!",
    convite: "If you like, tell others how it went:", google: "Review on Google", trip: "Review on Tripadvisor", viator: "Since you booked through Viator, you can leave your review on Viator itself, from the email or app of your booking.",
    baixa: "We are sorry the experience was not great. Our team will read your comment carefully.",
  },
  es: {
    titulo: "¿Cómo fue tu paseo?", ola: "Hola", pergunta: "De 0 a 10, ¿cuánto recomendarías By Bus a un amigo?", pouco: "Nada probable", muito: "Muy probable",
    comentario: "¿Quieres contarnos más? (opcional, sin datos personales)", aceito: "Acepto recibir la invitación para valorar públicamente a By Bus (Google o Tripadvisor). Es opcional y no depende de tu nota.",
    enviar: "Enviar respuesta", enviando: "Enviando…", falta: "Elige una nota de 0 a 10.", ja: "Esta encuesta ya fue respondida. ¡Gracias!", obrigado: "¡Gracias por tu respuesta!",
    convite: "Si quieres, cuéntales a otras personas cómo fue:", google: "Valorar en Google", trip: "Valorar en Tripadvisor", viator: "Como reservaste por Viator, la reseña se hace en la propia Viator, desde el correo o la app de tu reserva.",
    baixa: "Lamentamos que la experiencia no haya sido buena. Nuestro equipo leerá tu comentario con atención.",
  },
};

/** Página pública /nps/<token>: uma pergunta (0 a 10) e um comentário. O convite de avaliação pública vai para quem concordar, qualquer que seja a nota. */
export function NpsPublico({ token, incorporado = false }: { token: string; incorporado?: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState("");
  const [aceita, setAceita] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ r: Resposta; nota: number } | null>(null);
  const [faltaNota, setFaltaNota] = useState(false);
  const base = `/api/publico/nps/${encodeURIComponent(token)}`;

  useEffect(() => { requisitar<Info>(base, { semAvisoSessao: true }).then(setInfo).catch((e) => setErro(mensagemDeErro(e))); }, [base]);

  const t = T[info?.idioma ?? "pt"];
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (nota == null) return setFaltaNota(true);
    setEnviando(true);
    setErro(null);
    try {
      setFeito({ r: await requisitar<Resposta>(base, { metodo: "POST", semAvisoSessao: true, corpo: { nota, comentario: comentario.trim() || undefined, aceitaConvite: aceita } }), nota });
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={incorporado ? "" : "tela-acesso"}>
      <main className="cartao-acesso cartao-acesso--largo pub-nps" id="conteudo">
        <div className="cartao-acesso__marca cartao-acesso__marca--centro">
          <img className="cartao-acesso__logo" src={logo} alt="By Bus Turismo" width={66} height={96} />
          <h1>{t.titulo}</h1>
        </div>
        {erro && <div className="aviso aviso--erro" role="alert">{erro}</div>}
        {!info && !erro && <p className="texto-fraco">…</p>}
        {info?.respondido && !feito && <div className="aviso aviso--sucesso" role="status">{t.ja}</div>}
        {info && feito && (
          <div role="status">
            <div className="aviso aviso--sucesso"><strong>{t.obrigado}</strong>{feito.nota <= 6 && <><br />{t.baixa}</>}</div>
            {feito.r.convite && (
              <section aria-label={t.convite}>
                {feito.r.convite.viator ? <p>{t.viator}</p> : feito.r.convite.canais.length > 0 && (
                  <>
                    <p>{t.convite}</p>
                    <p className="m2-linha-acoes">{feito.r.convite.canais.map((c) => <a key={c.tipo} className="botao botao--secundario" href={c.link} target="_blank" rel="noopener noreferrer">{c.tipo === "GOOGLE" ? t.google : t.trip}</a>)}</p>
                  </>
                )}
              </section>
            )}
            {feito.r.cupom && <p className="aviso aviso--info">{feito.r.cupom.texto}</p>}
          </div>
        )}
        {info && !info.respondido && !feito && (
          <form onSubmit={(e) => void enviar(e)} noValidate>
            <p className="cartao-acesso__subtitulo">{t.ola}{info.titular ? `, ${info.titular}` : ""}! <strong>{info.passeio}</strong></p>
            <fieldset className="pub-nps__notas">
              <legend>{t.pergunta}</legend>
              {Array.from({ length: 11 }, (_, n) => (
                <label key={n} className="pub-nps__nota"><input type="radio" name="nota" value={n} checked={nota === n} onChange={() => { setNota(n); setFaltaNota(false); }} /><span>{n}</span></label>
              ))}
            </fieldset>
            <div className="pub-nps__pontas" aria-hidden="true"><span>0 · {t.pouco}</span><span>10 · {t.muito}</span></div>
            {faltaNota && <p className="campo__erro" role="alert">{t.falta}</p>}
            <div className="campo"><label htmlFor="n-com">{t.comentario}</label><textarea id="n-com" rows={3} maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} /></div>
            <label className="interruptor"><input type="checkbox" checked={aceita} onChange={(e) => setAceita(e.target.checked)} /> {t.aceito}</label>
            <button type="submit" className="botao botao--primario botao--bloco" disabled={enviando}>{enviando ? t.enviando : t.enviar}</button>
          </form>
        )}
      </main>
    </div>
  );
}
