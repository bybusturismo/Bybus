import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarDataExtenso, formatarMoeda } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { CLASSE_SITUACAO, descricaoTaxa, ROTULO_SITUACAO, type ParadaTransfer, type RespostaTransfer } from "./tipos";
import "./transfer.css";

interface RespostaMotorista { hoje: string; amanha: string; transfers: RespostaTransfer[] }

/** Tela do motorista do transfer, no celular: lista do dia em ordem, botões grandes de buscado / não apareceu / taxa recebida. */
export function MotoristaTransfer() {
  const notificar = useNotificar();
  const carga = useCarregar((s) => api.get<RespostaMotorista>("/api/transfer/motorista", s), []);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(p: ParadaTransfer, rota: string, corpo: unknown, aviso: string) {
    if (ocupado) return;
    setOcupado(p.id);
    setErro(null);
    try {
      await api.post(`/api/transfer/reservas/${p.id}/${rota}`, corpo);
      notificar(aviso);
      await carga.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
    }
  }

  const d = carga.dados;
  return (
    <div className="pagina transfer transfer--motorista">
      <div className="pagina__cabecalho"><div><h1>Meu transfer</h1><p className="pagina__descricao">Busca dos passageiros na porta do hotel, na ordem da lista.</p></div></div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carga.carregando && !d ? <Carregando /> : carga.erro ? <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} /> : d?.transfers.length === 0 ? (
        <Vazio titulo="Você não tem transfer para hoje nem para amanhã." />
      ) : d?.transfers.map((t) => (
        <section key={t.saida!.id} className="cartao transfer__dia" aria-label={`Transfer de ${t.saida!.data}`}>
          <h2>{t.saida!.data === d.hoje ? "Hoje" : "Amanhã"} — {formatarDataExtenso(t.saida!.data)}</h2>
          <p className="texto-fraco">{t.saida!.passeio}{t.dia?.veiculo ? ` · ${t.dia.veiculo}` : ""}</p>
          <p><strong>Encontro com o ônibus:</strong> {t.encontro ? `${t.encontro.nome} às ${t.encontro.horario}` : "a definir"}</p>
          <p className="texto-fraco">{t.totais?.buscados ?? 0} de {t.totais?.reservas ?? 0} reservas buscadas · {t.totais?.assentos ?? 0} passageiros{t.dia?.lugares ? ` · ${t.dia.lugares} lugares` : ""}</p>
          <p className="transfer__a-receber">Taxa a receber: <strong>{formatarMoeda(t.totais?.taxa.aReceber ?? 0)}</strong></p>
          <ol className="transfer__paradas">
            {t.reservas?.map((p) => {
              const aReceber = p.taxaSituacao === "A_RECEBER" && p.taxaCentavos > 0;
              return (
                <li key={p.id} className={`transfer__parada transfer__parada--${p.situacao.toLowerCase()}`}>
                  <div className="transfer__parada-topo">
                    <strong className="transfer__hora">{p.horario ?? "--:--"}</strong>
                    <span className="transfer__bairro">{p.bairro ?? "Bairro a definir"}</span>
                    <span className={`etiqueta ${CLASSE_SITUACAO[p.situacao]}`}>{ROTULO_SITUACAO[p.situacao]}</span>
                  </div>
                  <p className="transfer__hotel">{p.endereco ?? "Hotel a informar"}</p>
                  <p>{p.titular} · {p.pax} {p.pax === 1 ? "pessoa" : "pessoas"}{p.telefone ? <> · <a href={`tel:${p.telefone.replace(/[^\d+]/g, "")}`}>{p.telefone}</a></> : null}</p>
                  {p.observacoes && <p className="texto-fraco">{p.observacoes}</p>}
                  <p className={aReceber ? "transfer__taxa transfer__taxa--receber" : "transfer__taxa"}>{descricaoTaxa(p, formatarMoeda)}</p>
                  <div className="transfer__botoes">
                    <button type="button" className="botao botao--primario transfer__botao-grande" disabled={!!ocupado || p.situacao === "BUSCADO"} onClick={() => void enviar(p, "situacao", { situacao: "BUSCADO" }, "Marcado como buscado.")}>Buscado</button>
                    <button type="button" className="botao botao--secundario transfer__botao-grande" disabled={!!ocupado || p.situacao === "NAO_APARECEU"} onClick={() => void enviar(p, "situacao", { situacao: "NAO_APARECEU" }, "Marcado como não apareceu.")}>Não apareceu</button>
                  </div>
                  {aReceber && (
                    <div className="transfer__botoes">
                      <button type="button" className="botao botao--secundario transfer__botao-grande" disabled={!!ocupado} onClick={() => void enviar(p, "recebimento", { forma: "PIX", valorCentavos: p.taxaCentavos }, "Taxa recebida por PIX.")}>Recebi {formatarMoeda(p.taxaCentavos)} — PIX</button>
                      <button type="button" className="botao botao--secundario transfer__botao-grande" disabled={!!ocupado} onClick={() => void enviar(p, "recebimento", { forma: "DINHEIRO", valorCentavos: p.taxaCentavos }, "Taxa recebida em dinheiro.")}>Recebi {formatarMoeda(p.taxaCentavos)} — Dinheiro</button>
                    </div>
                  )}
                  {(p.situacao === "BUSCADO" || p.situacao === "NAO_APARECEU") && (
                    <button type="button" className="botao botao--fantasma botao--pequeno" disabled={!!ocupado} onClick={() => void enviar(p, "situacao", { situacao: "CONFIRMADO" }, "Marcação desfeita.")}>Desfazer marcação</button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
