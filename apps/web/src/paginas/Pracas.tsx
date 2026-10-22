import { useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import type { Unidade } from "../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { useSessao } from "../sessao/Sessao";
import { useCarregar } from "../util/useCarregar";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export function FormPraca({ praca, aoSalvar, aoCancelar }: { praca: Unidade | null; aoSalvar: (u: Unidade) => Promise<void>; aoCancelar: () => void }) {
  const [codigo, setCodigo] = useState(praca?.codigo ?? "");
  const [nome, setNome] = useState(praca?.nome ?? "");
  const [cidade, setCidade] = useState(praca?.cidade ?? "");
  const [uf, setUf] = useState(praca?.uf ?? "SC");
  const [ativa, setAtiva] = useState(praca?.ativa ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!praca && !/^[A-Za-z0-9]{2,10}$/.test(codigo.trim())) return setErro("Código: de 2 a 10 letras ou números, sem espaços (ex.: FLN).");
    if (nome.trim().length < 2) return setErro("Informe o nome da praça.");
    if (cidade.trim().length < 2) return setErro("Informe a cidade.");
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), cidade: cidade.trim(), uf, ativa };
      const r = praca ? await api.patch<Unidade>(`/api/unidades/${praca.id}`, corpo) : await api.post<Unidade>("/api/unidades", { ...corpo, codigo: codigo.trim().toUpperCase() });
      await aoSalvar(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} noValidate>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="pr-codigo">Código</label>
          <input
            id="pr-codigo"
            maxLength={10}
            value={codigo}
            disabled={!!praca}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            aria-describedby="pr-codigo-ajuda"
          />
          <p id="pr-codigo-ajuda" className="campo__ajuda">
            {praca ? "O código não muda depois de criado." : "Sigla curta, ex.: FLN, BC."}
          </p>
        </div>
        <div className="campo campo--largo">
          <label htmlFor="pr-nome">Nome</label>
          <input id="pr-nome" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="pr-cidade">Cidade</label>
          <input id="pr-cidade" maxLength={120} value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="pr-uf">UF</label>
          <select id="pr-uf" value={uf} onChange={(e) => setUf(e.target.value)}>
            {UFS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="interruptor">
        <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
        Praça ativa (recebe novos passeios, saídas e pessoas)
      </label>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : praca ? "Salvar praça" : "Criar praça"}
        </button>
      </div>
    </form>
  );
}

export function Pracas() {
  const { usuario, recarregar } = useSessao();
  const notificar = useNotificar();
  const lista = useCarregar((s) => api.get<Unidade[]>("/api/unidades", s), []);
  const [form, setForm] = useState<{ praca: Unidade | null } | null>(null);
  // A API só deixa criar/editar praças a quem acessa todas as praças.
  const podeEditar = !!usuario?.todasUnidades;

  return (
    <div className="pagina pagina--estreita">
      <div className="pagina__cabecalho">
        <div>
          <h1>Praças</h1>
          <p className="pagina__descricao">Unidades da operação (Florianópolis, Balneário Camboriú e futuras franquias). Toda saída, passeio e pessoa pertence a uma praça.</p>
        </div>
        {podeEditar && (
          <button type="button" className="botao botao--primario" onClick={() => setForm({ praca: null })}>
            <Icone nome="mais" /> Nova praça
          </button>
        )}
      </div>
      {!podeEditar && <Aviso tipo="info">Só quem tem acesso a todas as praças pode criar ou editar praças.</Aviso>}
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : !lista.dados?.length ? (
        <Vazio titulo="Nenhuma praça cadastrada." />
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <caption className="visualmente-oculto">Praças</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Nome</th>
                <th scope="col">Cidade/UF</th>
                <th scope="col">Situação</th>
                {podeEditar && (
                  <th scope="col">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((u) => (
                <tr key={u.id} className={u.ativa ? "" : "linha--inativa"}>
                  <td className="mono">{u.codigo}</td>
                  <td>{u.nome}</td>
                  <td>
                    {u.cidade}/{u.uf}
                  </td>
                  <td>{u.ativa ? <span className="etiqueta etiqueta--sucesso">Ativa</span> : <span className="etiqueta etiqueta--perigo">Inativa</span>}</td>
                  {podeEditar && (
                    <td className="celula-acoes">
                      <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ praca: u })} aria-label={`Editar praça ${u.nome}`}>
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal aberto={!!form} titulo={form?.praca ? `Editar praça ${form.praca.codigo}` : "Nova praça"} aoFechar={() => setForm(null)}>
        {form && (
          <FormPraca
            praca={form.praca}
            aoCancelar={() => setForm(null)}
            aoSalvar={async (u) => {
              setForm(null);
              notificar(form.praca ? `Praça ${u.codigo} atualizada.` : `Praça ${u.codigo} criada.`);
              // A lista de praças do topo vem de /api/auth/eu: recarrega a sessão para refletir.
              await Promise.all([lista.recarregar(), recarregar()]);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
