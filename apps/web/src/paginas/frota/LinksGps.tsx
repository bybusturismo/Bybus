import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { Modal } from "../../componentes/Modal";
import { useNotificar } from "../../componentes/Notificacoes";
import { formatarData, formatarDataHora } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import type { Veiculo } from "./tipos";

interface LinkGps { id: string; descricao: string; expiraEm: string | null; revogadoEm: string | null; ultimoAcessoEm: string | null; criadoEm: string; ativo: boolean }

/**
 * Links de compartilhamento do GPS de um veículo (dono, 13/11/2026). Um link por destinatário (hotel, parceiro, escritório),
 * com validade opcional; o link completo só aparece ao criar (o sistema guarda só uma "impressão digital" dele).
 */
export function LinksGps({ veiculo, podeEditar, aoFechar }: { veiculo: Veiculo; podeEditar: boolean; aoFechar: () => void }) {
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<LinkGps[]>(`/api/frota/veiculos/${veiculo.id}/links-gps`, s), [veiculo.id]);
  const [descricao, setDescricao] = useState("");
  const [dias, setDias] = useState("");
  const [novo, setNovo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (descricao.trim().length < 2) return setErro("Diga para quem é o link (ex.: Recepção do hotel X).");
    setOcupado(true);
    try {
      const r = await api.post<{ caminho: string }>(`/api/frota/veiculos/${veiculo.id}/links-gps`, { descricao: descricao.trim(), dias: dias ? Number(dias) : null });
      setNovo(`${window.location.origin}${r.caminho}`);
      setDescricao("");
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setOcupado(false);
    }
  }
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      notificar("Link copiado.");
    } catch {
      setErro("Não consegui copiar: selecione o link e copie à mão.");
    }
  }
  async function cancelar(l: LinkGps) {
    try {
      await api.delete(`/api/frota/links-gps/${l.id}`);
      notificar("Link cancelado: quem tinha o link não vê mais o ônibus.");
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <Modal aberto titulo={`Link do GPS — ${veiculo.placa}${veiculo.apelido ? ` (${veiculo.apelido})` : ""}`} aoFechar={aoFechar}>
      <p className="texto-fraco">
        Quem abre o link vê o veículo no mapa enquanto o motorista estiver com o rastreio ligado nele (City Tour ou transfer). Fora de serviço, o mapa não aparece.
        Não mostra passageiros nem dados da equipe. Crie um link para cada destinatário: assim dá para cancelar só o de um.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {novo && (
        <Aviso tipo="sucesso">
          Link criado. Copie agora (ele não aparece de novo): <br />
          <code className="frota-link">{novo}</code>{" "}
          <button type="button" className="botao botao--pequeno botao--primario" onClick={() => void copiar(novo)}>Copiar link</button>
        </Aviso>
      )}
      {podeEditar && (
        <form className="filtros" onSubmit={(e) => void criar(e)}>
          <div className="campo campo--linha"><label htmlFor="gps-desc">Para quem</label><input id="gps-desc" value={descricao} maxLength={120} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Recepção do hotel X" /></div>
          <div className="campo campo--linha">
            <label htmlFor="gps-dias">Validade</label>
            <select id="gps-dias" value={dias} onChange={(e) => setDias(e.target.value)}>
              <option value="">Sem prazo (até cancelar)</option>
              <option value="1">1 dia</option>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
            </select>
          </div>
          <button type="submit" className="botao botao--primario" disabled={ocupado}>{ocupado ? "Criando…" : "Criar link"}</button>
        </form>
      )}
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : !lista.dados?.length ? <p className="texto-fraco">Nenhum link criado ainda.</p> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th scope="col">Para quem</th><th scope="col">Criado</th><th scope="col">Validade</th><th scope="col">Último acesso</th><th scope="col">Situação</th>{podeEditar && <th scope="col"><span className="visualmente-oculto">Ações</span></th>}</tr></thead>
            <tbody>
              {lista.dados.map((l) => (
                <tr key={l.id} className={l.ativo ? "" : "linha--inativa"}>
                  <td>{l.descricao}</td>
                  <td className="sem-quebra">{formatarData(l.criadoEm.slice(0, 10))}</td>
                  <td className="sem-quebra">{l.expiraEm ? formatarDataHora(l.expiraEm) : "Sem prazo"}</td>
                  <td className="sem-quebra">{l.ultimoAcessoEm ? formatarDataHora(l.ultimoAcessoEm) : "—"}</td>
                  <td><span className={`etiqueta ${l.ativo ? "etiqueta--sucesso" : "etiqueta--neutra"}`}>{l.revogadoEm ? "Cancelado" : l.ativo ? "Ativo" : "Vencido"}</span></td>
                  {podeEditar && <td>{l.ativo && <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => void cancelar(l)} aria-label={`Cancelar link de ${l.descricao}`}>Cancelar</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
