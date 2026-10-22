import { useEffect, useState, type FormEvent } from "react";
import { api, mensagemDeErro } from "../api/cliente";
import { LINHAS_NEGOCIO, type LinhaNegocio, type Passeio, type UnidadeResumo } from "../api/tipos";
import { EtiquetaLinha } from "../componentes/Etiquetas";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { CabecalhoOrdenavel, compararTexto, normalizarBusca, Paginacao, useTabela } from "../componentes/Tabela";
import { nomePraca, useSessao } from "../sessao/Sessao";
import { ROTULO_LINHA } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

function inteiro(v: string, min: number, max: number): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function FormPasseio({
  passeio,
  unidades,
  pracaPadrao,
  aoSalvar,
  aoCancelar,
}: {
  passeio: Passeio | null;
  unidades: UnidadeResumo[];
  pracaPadrao: string;
  aoSalvar: (p: Passeio) => Promise<void>;
  aoCancelar: () => void;
}) {
  const [codigo, setCodigo] = useState(passeio?.codigo ?? "");
  const [nome, setNome] = useState(passeio?.nome ?? "");
  const [unidadeId, setUnidadeId] = useState(passeio?.unidadeId ?? (pracaPadrao || unidades[0]?.id || ""));
  const [cidade, setCidade] = useState(passeio?.cidade ?? "");
  const [linha, setLinha] = useState<LinhaNegocio>(passeio?.linha ?? "CITY_TOUR");
  const [capacidade, setCapacidade] = useState(String(passeio?.capacidadePadrao ?? 46));
  const [minimo, setMinimo] = useState(String(passeio?.minimoConfirmacao ?? 0));
  const [minimoSup, setMinimoSup] = useState(String(passeio?.minimoSupervisor ?? 0));
  const [ativo, setAtivo] = useState(passeio?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const cap = inteiro(capacidade, 1, 200);
    const min = inteiro(minimo, 0, 200);
    const minSup = inteiro(minimoSup, 0, 200);
    if (!passeio && !/^[A-Za-z0-9_]{2,40}$/.test(codigo.trim())) return setErro("Código: de 2 a 40 letras sem acento, números ou _ (ex.: TODA_ILHA).");
    if (nome.trim().length < 2) return setErro("Informe o nome do passeio.");
    if (!unidadeId) return setErro("Escolha a praça.");
    if (cidade.trim().length < 2) return setErro("Informe a cidade.");
    if (cap === null) return setErro("Capacidade padrão: número inteiro de 1 a 200.");
    if (min === null || minSup === null) return setErro("Mínimos: números inteiros de 0 a 200.");
    if (minSup > min) return setErro("O mínimo com aval do supervisor não pode ser maior que o mínimo para confirmar.");
    setSalvando(true);
    try {
      const corpo = { nome: nome.trim(), cidade: cidade.trim(), linha, capacidadePadrao: cap, minimoConfirmacao: min, minimoSupervisor: minSup, ativo };
      const r = passeio
        ? await api.patch<Passeio>(`/api/passeios/${passeio.id}`, corpo)
        : await api.post<Passeio>("/api/passeios", { ...corpo, codigo: codigo.trim().toUpperCase(), unidadeId });
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
          <label htmlFor="ps-codigo">Código</label>
          <input id="ps-codigo" maxLength={40} value={codigo} disabled={!!passeio} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/\s/g, "_"))} aria-describedby="ps-codigo-ajuda" />
          <p id="ps-codigo-ajuda" className="campo__ajuda">
            {passeio ? "O código não muda depois de criado." : "Identificador fixo. Ex.: TODA_ILHA"}
          </p>
        </div>
        <div className="campo campo--largo">
          <label htmlFor="ps-nome">Nome</label>
          <input id="ps-nome" maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ps-praca">Praça</label>
          <select id="ps-praca" value={unidadeId} disabled={!!passeio} onChange={(e) => setUnidadeId(e.target.value)} aria-describedby={passeio ? "ps-praca-ajuda" : undefined}>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
          {passeio && (
            <p id="ps-praca-ajuda" className="campo__ajuda">
              A praça não muda depois de criado (as saídas pertencem a ela).
            </p>
          )}
        </div>
        <div className="campo">
          <label htmlFor="ps-cidade">Cidade</label>
          <input id="ps-cidade" maxLength={120} value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ps-linha">Linha de negócio</label>
          <select id="ps-linha" value={linha} onChange={(e) => setLinha(e.target.value as LinhaNegocio)}>
            {LINHAS_NEGOCIO.map((l) => (
              <option key={l} value={l}>
                {ROTULO_LINHA[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="ps-capacidade">Capacidade padrão</label>
          <input id="ps-capacidade" type="number" min={1} max={200} value={capacidade} onChange={(e) => setCapacidade(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ps-minimo">Mínimo de pagantes para confirmar</label>
          <input id="ps-minimo" type="number" min={0} max={200} value={minimo} onChange={(e) => setMinimo(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ps-minimo-sup">Mínimo com aval do supervisor</label>
          <input id="ps-minimo-sup" type="number" min={0} max={200} value={minimoSup} onChange={(e) => setMinimoSup(e.target.value)} />
        </div>
      </div>
      <label className="interruptor">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Passeio ativo (aparece para criar saídas)
      </label>
      {passeio && !ativo && passeio.ativo && <Aviso tipo="atencao">Ao desativar, o passeio deixa de aparecer nas listas e não recebe novas saídas.</Aviso>}
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : passeio ? "Salvar passeio" : "Criar passeio"}
        </button>
      </div>
    </form>
  );
}

type Campo = "nome" | "praca" | "linha";

export function Passeios() {
  const { unidades, praca, pode } = useSessao();
  const notificar = useNotificar();
  const [filtroPraca, setFiltroPraca] = useState(praca);
  const [filtroLinha, setFiltroLinha] = useState<LinhaNegocio | "">("");
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState<{ passeio: Passeio | null } | null>(null);
  const tabela = useTabela<Campo>("praca");
  useEffect(() => setFiltroPraca(praca), [praca]);

  const lista = useCarregar((s) => api.get<Passeio[]>("/api/passeios", s), []);
  const termo = normalizarBusca(busca.trim());
  const filtrados = (lista.dados ?? [])
    .filter((p) => !filtroPraca || p.unidadeId === filtroPraca)
    .filter((p) => !filtroLinha || p.linha === filtroLinha)
    .filter((p) => !termo || normalizarBusca(p.nome).includes(termo) || normalizarBusca(p.codigo).includes(termo))
    .sort((a, b) => {
      const c = tabela.ordem.campo;
      const r =
        c === "praca"
          ? compararTexto(a.unidade ?? nomePraca(unidades, a.unidadeId), b.unidade ?? nomePraca(unidades, b.unidadeId)) || compararTexto(a.nome, b.nome)
          : c === "linha"
            ? compararTexto(ROTULO_LINHA[a.linha], ROTULO_LINHA[b.linha]) || compararTexto(a.nome, b.nome)
            : compararTexto(a.nome, b.nome);
      return tabela.ordem.asc ? r : -r;
    });
  const { visiveis, atual, paginas, total } = tabela.paginar(filtrados);

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Passeios</h1>
          <p className="pagina__descricao">Produtos de cada praça, com a linha de negócio. As saídas são criadas a partir deles.</p>
        </div>
        <button type="button" className="botao botao--primario" onClick={() => setForm({ passeio: null })} disabled={unidades.length === 0}>
          <Icone nome="mais" /> Novo passeio
        </button>
      </div>
      <div className="filtros" role="search" aria-label="Filtrar passeios">
        {unidades.length > 1 && (
          <div className="campo">
            <label htmlFor="ps-filtro-praca">Praça</label>
            <select id="ps-filtro-praca" value={filtroPraca} onChange={(e) => setFiltroPraca(e.target.value)}>
              <option value="">Todas as praças</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="campo">
          <label htmlFor="ps-filtro-linha">Linha de negócio</label>
          <select id="ps-filtro-linha" value={filtroLinha} onChange={(e) => setFiltroLinha(e.target.value as LinhaNegocio | "")}>
            <option value="">Todas</option>
            {LINHAS_NEGOCIO.map((l) => (
              <option key={l} value={l}>
                {ROTULO_LINHA[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo campo--busca">
          <label htmlFor="ps-busca">Buscar</label>
          <input id="ps-busca" type="search" placeholder="Nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      {!pode("manifesto:ver") && (
        <Aviso tipo="info">A lista de passeios depende da permissão “Ver a lista de passageiros”. Se ela não carregar, peça ao administrador para ajustar seu perfil.</Aviso>
      )}
      <p className="campo__ajuda">Passeios desativados não aparecem nesta lista.</p>
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : filtrados.length === 0 ? (
        <Vazio titulo="Nenhum passeio encontrado com estes filtros." />
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="visualmente-oculto">Passeios ({total})</caption>
              <thead>
                <tr>
                  <CabecalhoOrdenavel campo="nome" rotulo="Passeio" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <CabecalhoOrdenavel campo="praca" rotulo="Praça" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <CabecalhoOrdenavel campo="linha" rotulo="Linha" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <th scope="col" className="num">
                    Capacidade
                  </th>
                  <th scope="col" className="num">
                    Mínimo (supervisor)
                  </th>
                  <th scope="col">
                    <span className="visualmente-oculto">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.nome}
                      <div className="texto-fraco mono">{p.codigo}</div>
                    </td>
                    <td>
                      {p.unidade ?? nomePraca(unidades, p.unidadeId)}
                      <div className="texto-fraco">{p.cidade}</div>
                    </td>
                    <td>
                      <EtiquetaLinha linha={p.linha} />
                    </td>
                    <td className="num">{p.capacidadePadrao}</td>
                    <td className="num">
                      {p.minimoConfirmacao} ({p.minimoSupervisor})
                    </td>
                    <td className="celula-acoes">
                      <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setForm({ passeio: p })} aria-label={`Editar passeio ${p.nome}`}>
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacao atual={atual} paginas={paginas} total={total} setPagina={tabela.setPagina} />
        </>
      )}
      <Modal aberto={!!form} titulo={form?.passeio ? `Editar ${form.passeio.nome}` : "Novo passeio"} aoFechar={() => setForm(null)} largura="larga">
        {form && (
          <FormPasseio
            passeio={form.passeio}
            unidades={unidades}
            pracaPadrao={filtroPraca}
            aoCancelar={() => setForm(null)}
            aoSalvar={async (p) => {
              setForm(null);
              notificar(form.passeio ? `Passeio “${p.nome}” atualizado.` : `Passeio “${p.nome}” criado.`);
              await lista.recarregar();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
