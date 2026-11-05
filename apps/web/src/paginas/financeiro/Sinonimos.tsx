import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { normalizarBusca } from "../../componentes/Tabela";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";
import { useCategorias } from "./dados";
import type { SinonimoFin } from "./tipos";

const GRUPOS = ["RECEITA", "FROTA", "RH", "FIXO", "ADM", "PESSOAL", "TAXAS", "IMPOSTOS", "POSTO", "AGENDA", "APLICACAO", "QUIO"];
const ALVOS_ESPECIAIS: Array<[string, string]> = [["@TRANSFERENCIA", "Transferência entre contas"], ["@APLICACAO", "Aplicação ou resgate"], ["@IGNORAR", "Ignorar a linha"]];

/** Dicionário de sinônimos da planilha: variações e erros de digitação do grupo e da categoria → a categoria certa. Editável. */
export function Sinonimos() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("financeiro:gerenciar");
  const categorias = useCategorias();
  const lista = useCarregar((s) => api.get<SinonimoFin[]>("/api/financeiro/sinonimos", s), []);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"GRUPO" | "CATEGORIA">("CATEGORIA");
  const [texto, setTexto] = useState("");
  const [alvo, setAlvo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const cats = (categorias.dados ?? []).filter((c) => c.ativa);
  const filtrados = (lista.dados ?? []).filter((s) => !busca.trim() || normalizarBusca(`${s.texto} ${s.alvoNome}`).includes(normalizarBusca(busca.trim())));

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!texto.trim() || !alvo) return setErro("Informe o texto e para onde ele aponta.");
    try {
      await api.post("/api/financeiro/sinonimos", { tipo, texto: texto.trim(), alvo });
      setTexto("");
      notificar("Sinônimo adicionado.");
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function mudar(s: SinonimoFin, novo: string) {
    setErro(null);
    try {
      await api.patch(`/api/financeiro/sinonimos/${s.id}`, { alvo: novo });
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function apagar(s: SinonimoFin) {
    setErro(null);
    try {
      await api.delete(`/api/financeiro/sinonimos/${s.id}`);
      await lista.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  return (
    <section className="cartao" aria-labelledby="titulo-sinonimos">
      <h2 id="titulo-sinonimos">Dicionário de sinônimos da planilha</h2>
      <p className="texto-fraco">Usado na importação da planilha de controle: grafias diferentes do grupo (ex.: FOTA → FROTA) e da categoria (formato GRUPO|CATEGORIA; * vale para qualquer grupo) apontam para a categoria certa.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {podeEditar && (
        <form className="barra-ferramentas" onSubmit={adicionar}>
          <div className="campo"><label htmlFor="sn-tipo">Tipo</label><select id="sn-tipo" value={tipo} onChange={(e) => { setTipo(e.target.value as "GRUPO" | "CATEGORIA"); setAlvo(""); }}><option value="CATEGORIA">Categoria</option><option value="GRUPO">Grupo</option></select></div>
          <div className="campo"><label htmlFor="sn-texto">Texto na planilha</label><input id="sn-texto" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === "GRUPO" ? "Ex.: FOTA" : "Ex.: FROTA|MANUT."} /></div>
          <div className="campo">
            <label htmlFor="sn-alvo">Aponta para</label>
            <select id="sn-alvo" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
              <option value="">Escolha…</option>
              {tipo === "GRUPO" ? GRUPOS.map((g) => <option key={g} value={g}>{g}</option>) : <>{ALVOS_ESPECIAIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}{cats.map((c) => <option key={c.id} value={c.codigo}>{c.nome}</option>)}</>}
            </select>
          </div>
          <button type="submit" className="botao botao--secundario">Adicionar</button>
        </form>
      )}
      <details>
        <summary>Ver e editar os {lista.dados?.length ?? 0} sinônimos</summary>
        <div className="campo campo--busca"><label htmlFor="sn-busca" className="fin-oculto-visual">Buscar no dicionário</label><input id="sn-busca" type="search" placeholder="Buscar no dicionário" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : (
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta">
              <thead><tr><th scope="col">Tipo</th><th scope="col">Texto na planilha</th><th scope="col">Aponta para</th>{podeEditar && <th scope="col"><span className="fin-oculto-visual">Ações</span></th>}</tr></thead>
              <tbody>
                {filtrados.slice(0, 200).map((s) => (
                  <tr key={s.id}>
                    <td>{s.tipo === "GRUPO" ? "Grupo" : "Categoria"}</td><td>{s.texto}</td>
                    <td>
                      {podeEditar ? (
                        <select aria-label={`Destino de ${s.texto}`} value={s.alvo} onChange={(e) => void mudar(s, e.target.value)}>
                          {s.tipo === "GRUPO" ? GRUPOS.map((g) => <option key={g} value={g}>{g}</option>) : <>{ALVOS_ESPECIAIS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}{cats.map((c) => <option key={c.id} value={c.codigo}>{c.nome}</option>)}</>}
                        </select>
                      ) : s.alvoNome}
                    </td>
                    {podeEditar && <td><button type="button" className="botao botao--pequeno botao--perigo-contorno" onClick={() => void apagar(s)}>Excluir</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrados.length > 200 && <p className="texto-fraco">Mostrando 200 de {filtrados.length}. Use a busca.</p>}
          </div>
        )}
      </details>
    </section>
  );
}
