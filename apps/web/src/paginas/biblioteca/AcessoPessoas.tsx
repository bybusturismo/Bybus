import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../../api/cliente";
import { Aviso, Carregando, ErroCarga } from "../../componentes/Estados";
import { useCarregar } from "../../util/useCarregar";

type Nivel = "VER" | "EDITAR";
interface Pessoa { usuarioId: string; nivel: Nivel; nome: string }
interface Usuario { id: string; nome: string }

/** Acesso por pessoa (ver ou editar) de uma página; vale também para as subpáginas. Só quem edita a Biblioteca abre isto. */
export function AcessoPessoas({ paginaId, aoSalvar, aoCancelar }: { paginaId: string; aoSalvar: () => Promise<void>; aoCancelar: () => void }) {
  const atuais = useCarregar((s) => api.get<Pessoa[]>(`/api/biblioteca/paginas/${paginaId}/pessoas`, s), [paginaId]);
  const usuarios = useCarregar((s) => api.get<Usuario[]>("/api/biblioteca/usuarios", s), []);
  const [mudancas, setMudancas] = useState<Record<string, Nivel | "">>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  if ((atuais.carregando && !atuais.dados) || (usuarios.carregando && !usuarios.dados)) return <Carregando />;
  if (atuais.erro || usuarios.erro) return <ErroCarga mensagem={atuais.erro ?? usuarios.erro ?? ""} />;

  const nivelDe = (id: string): Nivel | "" => mudancas[id] ?? atuais.dados?.find((p) => p.usuarioId === id)?.nivel ?? "";

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const pessoas = (usuarios.dados ?? []).map((u) => ({ usuarioId: u.id, nivel: nivelDe(u.id) })).filter((p): p is { usuarioId: string; nivel: Nivel } => p.nivel !== "");
      await api.put(`/api/biblioteca/paginas/${paginaId}/pessoas`, { pessoas });
      await aoSalvar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="texto-fraco">Pessoas da lista leem (<strong>Ver</strong>) ou leem e editam (<strong>Editar</strong>) esta página e as subpáginas dela, mesmo se ela for restrita. Quem edita a Biblioteca sempre tem acesso.</p>
      <div className="tabela-rolagem">
        <table className="tabela">
          <thead><tr><th>Pessoa</th><th>Acesso</th></tr></thead>
          <tbody>
            {(usuarios.dados ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>
                  <select aria-label={`Acesso de ${u.nome}`} value={nivelDe(u.id)} onChange={(e) => setMudancas({ ...mudancas, [u.id]: e.target.value as Nivel | "" })}>
                    <option value="">Sem acesso por pessoa</option>
                    <option value="VER">Ver</option>
                    <option value="EDITAR">Editar</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : "Salvar acesso"}</button>
      </div>
    </form>
  );
}
