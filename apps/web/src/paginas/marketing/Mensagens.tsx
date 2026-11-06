import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import { ROTULO_IDIOMA } from "./comum";

type Idioma = "pt" | "en" | "es";
interface Fluxo {
  codigo: string; rotulo: string; quando: string; editavel: boolean; variaveis: string[]; ligado: boolean; textos: Record<Idioma, string>; padroes: Record<Idioma, string>;
  personalizado: Record<Idioma, boolean>; extra: string | null; origemDoLigado: string;
}
interface Resposta { envio: { real: boolean; nota: string }; fluxos: Fluxo[] }
const ORIGEM: Record<string, string> = { FECHAMENTO: "Operação › Fechamento (sempre ligada)", TELA: "definido aqui", VARIAVEL_DE_AMBIENTE: "segue a configuração do servidor (MENSAGEM_VOUCHER_AUTOMATICA)", PADRAO: "padrão do sistema" };

function Cartao({ f, edita, aoMudar }: { f: Fluxo; edita: boolean; aoMudar: () => Promise<void> }) {
  const notificar = useNotificar();
  const [textos, setTextos] = useState(f.textos);
  const [extra, setExtra] = useState(f.extra ?? "");
  const [erro, setErro] = useState<string | null>(null);
  async function salvar(corpo: Record<string, unknown>, ok: string) {
    setErro(null);
    try { await api.patch(`/api/marketing/mensagens/${f.codigo}`, corpo); notificar(ok); await aoMudar(); } catch (x) { setErro(mensagemDeErro(x)); }
  }
  const mudou = (["pt", "en", "es"] as Idioma[]).some((i) => textos[i] !== f.textos[i]) || (f.codigo === "CUPOM_RETORNO" && extra !== (f.extra ?? ""));
  return (
    <section className="cartao" aria-labelledby={`fl-${f.codigo}`}>
      <div className="m2-linha-acoes">
        <h2 id={`fl-${f.codigo}`}>{f.rotulo}</h2>
        <span className={`etiqueta ${f.ligado ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{f.ligado ? "Ligado" : "Desligado"}</span>
      </div>
      <p className="texto-fraco">{f.quando} Situação: {ORIGEM[f.origemDoLigado]}.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {f.codigo !== "VESPERA" && edita && (
        <label className="interruptor"><input type="checkbox" checked={f.ligado} onChange={(e) => void salvar({ ligado: e.target.checked }, e.target.checked ? "Fluxo ligado." : "Fluxo desligado.")} /> Enviar automaticamente</label>
      )}
      {f.codigo === "CUPOM_RETORNO" && (
        <div className="campo"><label htmlFor="fl-cupom">Código do cupom de retorno</label><input id="fl-cupom" value={extra} maxLength={30} disabled={!edita} onChange={(e) => setExtra(e.target.value)} /></div>
      )}
      {f.editavel && (["pt", "en", "es"] as Idioma[]).map((i) => (
        <div className="campo" key={i}>
          <label htmlFor={`fl-${f.codigo}-${i}`}>Texto em {ROTULO_IDIOMA[i]}{f.personalizado[i] ? " (personalizado)" : " (padrão)"}</label>
          <textarea id={`fl-${f.codigo}-${i}`} rows={3} maxLength={1000} disabled={!edita} value={textos[i]} onChange={(e) => setTextos({ ...textos, [i]: e.target.value })} />
        </div>
      ))}
      {f.editavel && <p className="campo__ajuda">Variáveis: {f.variaveis.map((v) => `{${v}}`).join(", ")}.</p>}
      {f.editavel && edita && (
        <div className="m2-linha-acoes">
          <button type="button" className="botao botao--primario" disabled={!mudou} onClick={() => void salvar({ textos: Object.fromEntries((["pt", "en", "es"] as Idioma[]).map((i) => [i, textos[i] === f.padroes[i] ? null : textos[i]])), ...(f.codigo === "CUPOM_RETORNO" ? { extra: extra.trim() || null } : {}) }, "Textos salvos.")}>Salvar textos</button>
          <button type="button" className="botao botao--fantasma" onClick={() => setTextos(f.padroes)}>Voltar aos textos padrão</button>
        </div>
      )}
    </section>
  );
}

export function Mensagens() {
  const { pode, usuario } = useSessao();
  const notificar = useNotificar();
  const edita = pode("marketing:gerenciar") && !!usuario?.todasUnidades;
  const r = useCarregar((s) => api.get<Resposta>("/api/marketing/mensagens", s), []);
  const [rodando, setRodando] = useState(false);
  async function rodar() {
    setRodando(true);
    try {
      const x = await api.post<{ pedidosCriados: number; compra: number; posPasseio: number; avaliacoesEnviadas: number; simulado: boolean }>("/api/marketing/mensagens/rodar", {});
      notificar(`${x.compra} confirmação(ões), ${x.posPasseio} NPS, ${x.avaliacoesEnviadas} convite(s) de avaliação${x.simulado ? " (simulado: nada saiu de verdade)" : ""}.`);
    } catch (e) { notificar(mensagemDeErro(e), "erro"); } finally { setRodando(false); }
  }
  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Mensagens automáticas" descricao="Mensagens ao longo da reserva: confirmação, véspera, pós-passeio com NPS e cupom de retorno. Cada fluxo liga e desliga, com texto por idioma."
        acoes={edita && <button type="button" className="botao botao--secundario" disabled={rodando} onClick={() => void rodar()}>{rodando ? "Rodando…" : "Rodar agora"}</button>} />
      {!edita && <Aviso tipo="info">Só quem enxerga todas as praças e gerencia o marketing altera os fluxos.</Aviso>}
      {r.dados && <Aviso tipo={r.dados.envio.real ? "atencao" : "info"}>{r.dados.envio.nota}</Aviso>}
      {r.carregando && !r.dados ? <Carregando /> : r.erro ? <ErroCarga mensagem={r.erro} tentarDeNovo={r.recarregar} /> : r.dados?.fluxos.map((f) => <Cartao key={f.codigo + JSON.stringify(f.textos) + f.ligado + f.extra} f={f} edita={edita} aoMudar={r.recarregar} />)}
    </div>
  );
}
