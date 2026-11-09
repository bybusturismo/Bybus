import { useState } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { formatarDataHora, formatarMoeda, plural } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { useCategorias } from "./dados";

interface Pendencias {
  itens: Array<{ chave: string; grupo: string; categoria: string; qtd: number; totalCentavos: number; abas: number }>;
  abas: Array<{ id: string; arquivo: string | null; unidadeId: string | null; atualizadoEm: string; linhas: number }>;
}

/**
 * Pendências de categoria da planilha (pedido do dono, 09/11/2026): o que ficou "não importar ainda" fica guardado aqui
 * para classificar quando houver certeza, sem importar a aba de novo.
 */
export function PendenciasPlanilha() {
  const notificar = useNotificar();
  const { pode } = useSessao();
  const podeEditar = pode("financeiro:gerenciar");
  const lista = useCarregar((s) => api.get<Pendencias>("/api/financeiro/planilha/pendencias", s), []);
  const categorias = useCategorias();
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [lembrar, setLembrar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const cats = (categorias.dados ?? []).filter((c) => c.ativa);
  const escolhidas = Object.fromEntries(Object.entries(escolhas).filter(([, v]) => v));

  async function aplicar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api.post<{ lancamentos: number; transferencias: number; restantes: number }>("/api/financeiro/planilha/pendencias/resolver", { mapeamentos: escolhidas, salvarSinonimos: lembrar });
      notificar(`${plural(r.lancamentos, "lançamento importado", "lançamentos importados")}${r.transferencias ? ` e ${plural(r.transferencias, "transferência", "transferências")}` : ""}. ${r.restantes ? `${plural(r.restantes, "linha continua pendente", "linhas continuam pendentes")}.` : "Nada pendente."}`);
      setEscolhas({});
      await lista.recarregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const d = lista.dados;
  return (
    <div className="pagina pagina--estreita">
      <div className="pagina__cabecalho">
        <div>
          <h1>Pendências de categoria</h1>
          <p className="pagina__descricao">O que ficou como “não importar ainda” na importação da planilha. Escolha a categoria quando tiver certeza: as linhas entram direto, sem importar a aba de novo.</p>
        </div>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {lista.carregando && !d ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : !d?.itens.length ? (
        <Vazio titulo="Nenhuma pendência.">Tudo o que foi importado da planilha já tem categoria.</Vazio>
      ) : (
        <section className="cartao" aria-label="Pendências">
          <p className="texto-fraco">{plural(d.abas.length, "aba guardada", "abas guardadas")}: {d.abas.map((a) => `${a.arquivo ?? "sem nome"} (${a.linhas}, ${formatarDataHora(a.atualizadoEm)})`).join(" · ")}</p>
          {d.itens.map((n) => (
            <div key={n.chave} className="campo campo--linha">
              <label htmlFor={`pend-${n.chave}`}>{n.grupo || "(sem grupo)"} › {n.categoria || "(sem categoria)"} <span className="texto-fraco">({plural(n.qtd, "linha", "linhas")}, {formatarMoeda(n.totalCentavos)})</span></label>
              <select id={`pend-${n.chave}`} value={escolhas[n.chave] ?? ""} disabled={!podeEditar || ocupado} onChange={(e) => setEscolhas((m) => ({ ...m, [n.chave]: e.target.value }))}>
                <option value="">Ainda não sei</option>
                <option value="IGNORAR">Ignorar estas linhas</option>
                <option value="TRANSFERENCIA">É transferência entre contas</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          ))}
          {podeEditar && (
            <>
              <label className="caixa"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar estas escolhas nas próximas importações</label>
              <div className="modal__acoes">
                <button type="button" className="botao botao--primario" disabled={ocupado || !Object.keys(escolhidas).length} onClick={() => void aplicar()}>
                  {ocupado ? "Aplicando…" : `Aplicar ${plural(Object.keys(escolhidas).length, "escolha", "escolhas")}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
