import { createContext, useContext, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { api, qs } from "../../api/cliente";
import type { RespostaManifesto, RespostaSaida } from "../../api/tipos";
import { Carregando, ErroCarga } from "../../componentes/Estados";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { formatarDataExtenso } from "../../util/formato";
import { ROTULO_STATUS_SAIDA } from "../../util/rotulos";
import { EtiquetaLinha } from "../../componentes/Etiquetas";
import { useCarregar, type Carregamento } from "../../util/useCarregar";

interface ValorSaida {
  id: string;
  carga: Carregamento<RespostaManifesto>;
  dados: RespostaManifesto;
  documentosCompletos: boolean;
  setDocumentosCompletos: (v: boolean) => void;
  /** Recarrega só o cabeçalho (saída + passeio) via GET /api/saidas/:id — não recarrega nem audita a lista. */
  atualizarCabecalho: () => Promise<void>;
}

const Contexto = createContext<ValorSaida | null>(null);

export function useSaida(): ValorSaida {
  const v = useContext(Contexto);
  if (!v) throw new Error("useSaida fora de SaidaLayout");
  return v;
}

/**
 * Carrega a saída (via manifesto, que traz saída + passeio + lista) uma vez e compartilha entre as abas
 * Lista de passageiros / Reservas / Modo embarque.
 */
export function SaidaLayout() {
  const { id = "" } = useParams();
  const { pode, unidades } = useSessao();
  const [documentosCompletos, setDocs] = useState(false);
  const completos = documentosCompletos && pode("manifesto:documentos");
  const carga = useCarregar(
    (s) => api.get<RespostaManifesto>(`/api/saidas/${encodeURIComponent(id)}/manifesto${qs({ documentos: completos ? "completos" : undefined })}`, s),
    [id, completos],
  );

  if (!carga.dados) {
    if (carga.erro) return <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} />;
    return <Carregando texto="Carregando lista de passageiros…" />;
  }

  const { saida, passeio } = carga.dados;
  async function atualizarCabecalho() {
    const r = await api.get<RespostaSaida>(`/api/saidas/${encodeURIComponent(id)}`);
    carga.definir((d) => (d ? { ...d, saida: r.saida, passeio: { ...d.passeio, ...r.passeio } } : d));
  }
  return (
    <Contexto.Provider value={{ id, carga, dados: carga.dados, documentosCompletos: completos, setDocumentosCompletos: setDocs, atualizarCabecalho }}>
      <div className="pagina pagina--saida">
        <nav className="migalhas nao-imprimir" aria-label="Você está em">
          <Link to="/saidas">Saídas</Link> <span aria-hidden="true">›</span> <span aria-current="page">{formatarDataExtenso(saida.data)}</span>
        </nav>
        <div className="pagina__cabecalho nao-imprimir">
          <div>
            <h1>
              {formatarDataExtenso(saida.data)}{" "}
              <span className={`etiqueta etiqueta--status-${saida.status.toLowerCase()}`}>{ROTULO_STATUS_SAIDA[saida.status]}</span>
            </h1>
            <p className="pagina__descricao">
              {passeio.nome}
              {unidades.length > 1 && passeio.unidadeId && <> · {nomePraca(unidades, passeio.unidadeId)}</>} <EtiquetaLinha linha={passeio.linha} />
            </p>
          </div>
        </div>
        <nav className="abas nao-imprimir" aria-label="Seções da saída">
          <NavLink end to={`/saidas/${id}`} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
            Lista de passageiros
          </NavLink>
          <NavLink to={`/saidas/${id}/reservas`} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
            Reservas
          </NavLink>
          <NavLink to={`/saidas/${id}/embarque`} className={({ isActive }) => `aba${isActive ? " aba--ativa" : ""}`}>
            Modo embarque
          </NavLink>
        </nav>
        {carga.erro && <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} />}
        <Outlet />
      </div>
    </Contexto.Provider>
  );
}
