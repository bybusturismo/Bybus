import { useState } from "react";
import { api } from "../api/cliente";
import type { RegistroAuditoria } from "../api/tipos";
import { Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { formatarDataHora } from "../util/formato";
import { ROTULO_ACAO_AUDITORIA } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

const POR_PAGINA = 25;

function resumoDados(d: Record<string, unknown> | null): string {
  if (!d) return "";
  return Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function Auditoria() {
  const [limite, setLimite] = useState(200);
  const carga = useCarregar((s) => api.get<RegistroAuditoria[]>(`/api/auditoria?limite=${limite}`, s), [limite]);
  const [busca, setBusca] = useState("");
  const [acao, setAcao] = useState("");
  const [pagina, setPagina] = useState(0);

  const dados = carga.dados ?? [];
  const acoes = [...new Set(dados.map((r) => r.acao))].sort();
  const termo = busca.trim().toLowerCase();
  const filtrados = dados.filter(
    (r) =>
      (!acao || r.acao === acao) &&
      (!termo || [r.usuario ?? "", r.acao, ROTULO_ACAO_AUDITORIA[r.acao] ?? "", r.entidade ?? "", r.ip ?? ""].some((x) => x.toLowerCase().includes(termo))),
  );
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const visiveis = filtrados.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Auditoria</h1>
          <p className="pagina__descricao">Últimas ações registradas no sistema (horário de Brasília).</p>
        </div>
        <button type="button" className="botao botao--secundario" onClick={() => void carga.recarregar()} disabled={carga.carregando}>
          Atualizar
        </button>
      </div>
      <div className="filtros">
        <div className="campo campo--busca">
          <label htmlFor="aud-busca">Buscar</label>
          <input
            id="aud-busca"
            type="search"
            placeholder="Usuário, ação, IP…"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(0);
            }}
          />
        </div>
        <div className="campo">
          <label htmlFor="aud-acao">Ação</label>
          <select
            id="aud-acao"
            value={acao}
            onChange={(e) => {
              setAcao(e.target.value);
              setPagina(0);
            }}
          >
            <option value="">Todas</option>
            {acoes.map((a) => (
              <option key={a} value={a}>
                {ROTULO_ACAO_AUDITORIA[a] ?? a}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="aud-limite">Registros carregados</label>
          <select id="aud-limite" value={limite} onChange={(e) => setLimite(Number(e.target.value))}>
            {[100, 200, 500].map((n) => (
              <option key={n} value={n}>
                Últimos {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {carga.carregando && !carga.dados ? (
        <Carregando />
      ) : carga.erro ? (
        <ErroCarga mensagem={carga.erro} tentarDeNovo={carga.recarregar} />
      ) : filtrados.length === 0 ? (
        <Vazio titulo="Nenhum registro encontrado." />
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th scope="col">Data e hora</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Entidade</th>
                  <th scope="col">Detalhes</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((r) => (
                  <tr key={r.id}>
                    <td className="sem-quebra">{formatarDataHora(r.criadoEm)}</td>
                    <td>{r.usuario ?? <span className="texto-fraco">—</span>}</td>
                    <td>
                      <span title={r.acao}>{ROTULO_ACAO_AUDITORIA[r.acao] ?? r.acao}</span>
                    </td>
                    <td>
                      {r.entidade ?? ""}
                      {r.entidadeId && <span className="mono texto-fraco"> {r.entidadeId.slice(0, 8)}</span>}
                    </td>
                    <td className="celula-detalhes">{resumoDados(r.dados)}</td>
                    <td className="mono">{r.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="paginacao" aria-label="Paginação">
            <button type="button" className="botao botao--secundario botao--pequeno" disabled={atual === 0} onClick={() => setPagina(atual - 1)}>
              ← Anterior
            </button>
            <span>
              Página {atual + 1} de {paginas} · {filtrados.length} registro(s)
            </span>
            <button type="button" className="botao botao--secundario botao--pequeno" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)}>
              Próxima →
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
