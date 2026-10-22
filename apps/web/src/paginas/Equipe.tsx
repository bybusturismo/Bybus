import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, mensagemDeErro, qs } from "../api/cliente";
import { PAPEIS_PESSOA, TIPOS_DOCUMENTO, type PapelPessoa, type Pessoa, type TipoDocumento, type UnidadeResumo } from "../api/tipos";
import { EtiquetaValidade } from "../componentes/Etiquetas";
import { Aviso, Carregando, ErroCarga, Vazio } from "../componentes/Estados";
import { Icone } from "../componentes/Icone";
import { Modal } from "../componentes/Modal";
import { useNotificar } from "../componentes/Notificacoes";
import { CabecalhoOrdenavel, compararTexto, normalizarBusca, Paginacao, useTabela } from "../componentes/Tabela";
import { nomePraca, useSessao } from "../sessao/Sessao";
import { baixarCsv, gerarCsv } from "../util/csv";
import { mascararCpf, validarDocumento } from "../util/documento";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, situacaoValidade, textoDeCentavos } from "../util/formato";
import { ROTULO_DOCUMENTO, ROTULO_PAPEL } from "../util/rotulos";
import { useCarregar } from "../util/useCarregar";

const CATEGORIAS_CNH = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"];

/** Pessoa veio completa (quem pode editá-la recebe contato/documentos; os demais, só o resumo). */
const ehCompleta = (p: Pessoa) => "telefone" in p;

/** Documentos com validade vencida ou vencendo em 30 dias (CNH para motorista, Cadastur para guia). */
export function pendenciasValidade(p: Pessoa, hoje: string): string[] {
  const r: string[] = [];
  const cnh = p.papeis.includes("MOTORISTA") ? situacaoValidade(p.cnhValidade, hoje) : null;
  const cad = p.papeis.includes("GUIA") ? situacaoValidade(p.cadasturValidade, hoje) : null;
  if (cnh === "vencido" || cnh === "vencendo") r.push(`CNH ${cnh === "vencido" ? "vencida" : "vencendo"}`);
  if (cad === "vencido" || cad === "vencendo") r.push(`Cadastur ${cad === "vencido" ? "vencido" : "vencendo"}`);
  return r;
}

type Erros = Partial<Record<"nome" | "papeis" | "email" | "documento" | "diaria" | "idiomas", string>>;

export function FormPessoa({
  pessoa,
  unidades,
  todasUnidades,
  pracaPadrao,
  aoSalvar,
  aoCancelar,
}: {
  pessoa: Pessoa | null;
  unidades: UnidadeResumo[];
  todasUnidades: boolean;
  pracaPadrao: string;
  aoSalvar: (p: Pessoa) => Promise<void>;
  aoCancelar: () => void;
}) {
  const editando = !!pessoa;
  const [nome, setNome] = useState(pessoa?.nome ?? "");
  const [papeis, setPapeis] = useState<PapelPessoa[]>(pessoa?.papeis ?? []);
  const [unidadeId, setUnidadeId] = useState<string>(pessoa ? pessoa.unidadeId ?? "" : pracaPadrao || (todasUnidades ? "" : unidades[0]?.id ?? ""));
  const [telefone, setTelefone] = useState(pessoa?.telefone ?? "");
  const [email, setEmail] = useState(pessoa?.email ?? "");
  const [docTipo, setDocTipo] = useState<TipoDocumento | "">(pessoa?.documentoTipo ?? "");
  const [documento, setDocumento] = useState("");
  const [cnhCategoria, setCnhCategoria] = useState(pessoa?.cnhCategoria ?? "");
  const [cnhValidade, setCnhValidade] = useState(pessoa?.cnhValidade ?? "");
  const [cadastur, setCadastur] = useState(pessoa?.cadasturNumero ?? "");
  const [cadasturValidade, setCadasturValidade] = useState(pessoa?.cadasturValidade ?? "");
  const [idiomas, setIdiomas] = useState((pessoa?.idiomas ?? []).join(", "));
  const [diaria, setDiaria] = useState(textoDeCentavos(pessoa?.diariaCentavos));
  const [observacoes, setObservacoes] = useState(pessoa?.observacoes ?? "");
  const [ativo, setAtivo] = useState(pessoa?.ativo ?? true);
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const hoje = hojeIso();

  const ehMotorista = papeis.includes("MOTORISTA");
  const ehGuia = papeis.includes("GUIA");

  function alternarPapel(p: PapelPessoa, marcado: boolean) {
    setPapeis((atual) => (marcado ? [...atual, p] : atual.filter((x) => x !== p)));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const novos: Erros = {};
    if (nome.trim().length < 2) novos.nome = "Informe o nome (mínimo 2 letras).";
    if (papeis.length === 0) novos.papeis = "Marque ao menos um papel.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) novos.email = "E-mail inválido.";
    const erroDoc = documento.trim() ? validarDocumento(docTipo || null, documento) : null;
    if (erroDoc) novos.documento = erroDoc;
    const centavos = centavosDeTexto(diaria);
    if (Number.isNaN(centavos)) novos.diaria = "Valor inválido. Use o formato 300,00.";
    else if (centavos !== null && centavos > 1_000_000) novos.diaria = "Diária acima do limite (R$ 10.000,00).";
    const listaIdiomas = idiomas.split(",").map((i) => i.trim()).filter(Boolean);
    if (listaIdiomas.some((i) => i.length < 2 || i.length > 30)) novos.idiomas = "Cada idioma deve ter entre 2 e 30 letras.";
    setErros(novos);
    if (Object.keys(novos).length) {
      setErro("Revise os campos destacados.");
      return;
    }

    const corpo: Record<string, unknown> = {
      nome: nome.trim(),
      papeis,
      unidadeId: unidadeId || null,
      telefone: telefone.trim() || null,
      email: email.trim() || null,
      diariaCentavos: centavos,
      observacoes: observacoes.trim() || null,
    };
    // Campos de motorista/guia só vão quando o papel está marcado (desmarcar não apaga o que já existe).
    if (ehMotorista) Object.assign(corpo, { cnhCategoria: cnhCategoria || null, cnhValidade: cnhValidade || null });
    if (ehGuia) Object.assign(corpo, { cadasturNumero: cadastur.trim() || null, cadasturValidade: cadasturValidade || null, idiomas: listaIdiomas });
    // Documento: só envia quando digitado; tipo "nenhum" numa pessoa que tinha documento remove o documento.
    if (documento.trim()) Object.assign(corpo, { documentoTipo: docTipo, documento: documento.trim() });
    else if (editando && !docTipo && pessoa?.documentoTipo) Object.assign(corpo, { documentoTipo: null, documento: null });
    if (editando) corpo.ativo = ativo;

    setSalvando(true);
    try {
      const r = editando ? await api.patch<Pessoa>(`/api/pessoas/${pessoa!.id}`, corpo) : await api.post<Pessoa>("/api/pessoas", corpo);
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
        <div className="campo campo--largo">
          <label htmlFor="pe-nome">Nome completo</label>
          <input id="pe-nome" maxLength={150} value={nome} onChange={(e) => setNome(e.target.value)} aria-invalid={!!erros.nome} aria-describedby={erros.nome ? "pe-nome-erro" : undefined} />
          {erros.nome && <p id="pe-nome-erro" className="campo__erro">{erros.nome}</p>}
        </div>
        <fieldset className="campo campo--largo grupo-opcoes" aria-describedby={erros.papeis ? "pe-papeis-erro" : undefined}>
          <legend>Papéis</legend>
          {PAPEIS_PESSOA.map((p) => (
            <label key={p} className="caixa">
              <input type="checkbox" checked={papeis.includes(p)} onChange={(e) => alternarPapel(p, e.target.checked)} />
              {ROTULO_PAPEL[p]}
            </label>
          ))}
          {erros.papeis && <p id="pe-papeis-erro" className="campo__erro">{erros.papeis}</p>}
        </fieldset>
        <div className="campo">
          <label htmlFor="pe-praca">Praça</label>
          <select id="pe-praca" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            {(todasUnidades || unidadeId === "") && <option value="">Todas as praças</option>}
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pe-telefone">Telefone</label>
          <input id="pe-telefone" type="tel" maxLength={40} autoComplete="off" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="pe-email">E-mail</label>
          <input id="pe-email" type="email" maxLength={200} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!erros.email} aria-describedby={erros.email ? "pe-email-erro" : undefined} />
          {erros.email && <p id="pe-email-erro" className="campo__erro">{erros.email}</p>}
        </div>
        <div className="campo">
          <label htmlFor="pe-doc-tipo">Tipo de documento</label>
          <select id="pe-doc-tipo" value={docTipo} onChange={(e) => setDocTipo(e.target.value as TipoDocumento | "")}>
            <option value="">Nenhum</option>
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_DOCUMENTO[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pe-doc">Número do documento</label>
          <input
            id="pe-doc"
            maxLength={40}
            autoComplete="off"
            value={documento}
            disabled={!docTipo}
            onChange={(e) => setDocumento(docTipo === "CPF" ? mascararCpf(e.target.value) : e.target.value)}
            aria-invalid={!!erros.documento}
            aria-describedby="pe-doc-ajuda"
          />
          <p id="pe-doc-ajuda" className={erros.documento ? "campo__erro" : "campo__ajuda"}>
            {erros.documento ?? (editando && pessoa?.documento ? `Atual: ${pessoa.documento}. Deixe em branco para manter.` : "Guardado criptografado; na tela aparece mascarado.")}
          </p>
        </div>
      </div>

      {ehMotorista && (
        <fieldset className="grupo-campos">
          <legend>Motorista — CNH</legend>
          <div className="grade-campos">
            <div className="campo">
              <label htmlFor="pe-cnh-cat">Categoria da CNH</label>
              <select id="pe-cnh-cat" value={cnhCategoria} onChange={(e) => setCnhCategoria(e.target.value)}>
                <option value="">Não informada</option>
                {CATEGORIAS_CNH.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="pe-cnh-val">Validade da CNH</label>
              <input id="pe-cnh-val" type="date" value={cnhValidade} onChange={(e) => setCnhValidade(e.target.value)} aria-describedby="pe-cnh-situacao" />
              <p id="pe-cnh-situacao" className="campo__ajuda">
                <EtiquetaValidade rotulo="CNH" validade={cnhValidade} hoje={hoje} />
              </p>
            </div>
          </div>
        </fieldset>
      )}

      {ehGuia && (
        <fieldset className="grupo-campos">
          <legend>Guia — Cadastur e idiomas</legend>
          <div className="grade-campos">
            <div className="campo">
              <label htmlFor="pe-cadastur">Número no Cadastur</label>
              <input id="pe-cadastur" maxLength={40} value={cadastur} onChange={(e) => setCadastur(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="pe-cadastur-val">Validade do Cadastur</label>
              <input id="pe-cadastur-val" type="date" value={cadasturValidade} onChange={(e) => setCadasturValidade(e.target.value)} aria-describedby="pe-cadastur-situacao" />
              <p id="pe-cadastur-situacao" className="campo__ajuda">
                <EtiquetaValidade rotulo="Cadastur" validade={cadasturValidade} hoje={hoje} />
              </p>
            </div>
            <div className="campo campo--largo">
              <label htmlFor="pe-idiomas">Idiomas</label>
              <input id="pe-idiomas" maxLength={300} value={idiomas} onChange={(e) => setIdiomas(e.target.value)} aria-invalid={!!erros.idiomas} aria-describedby="pe-idiomas-ajuda" />
              <p id="pe-idiomas-ajuda" className={erros.idiomas ? "campo__erro" : "campo__ajuda"}>
                {erros.idiomas ?? "Separe por vírgula. Ex.: Português, Espanhol, Inglês"}
              </p>
            </div>
          </div>
        </fieldset>
      )}

      <div className="grade-campos">
        <div className="campo">
          <label htmlFor="pe-diaria">Diária (R$)</label>
          <input id="pe-diaria" inputMode="decimal" placeholder="0,00" maxLength={14} value={diaria} onChange={(e) => setDiaria(e.target.value)} aria-invalid={!!erros.diaria} aria-describedby="pe-diaria-ajuda" />
          <p id="pe-diaria-ajuda" className={erros.diaria ? "campo__erro" : "campo__ajuda"}>
            {erros.diaria ?? "Valor combinado por dia de trabalho. Deixe em branco se não se aplica."}
          </p>
        </div>
        {editando && (
          <div className="campo">
            <span>Situação</span>
            <label className="interruptor">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
              Ativo (aparece para escalar)
            </label>
          </div>
        )}
        <div className="campo campo--largo">
          <label htmlFor="pe-obs">Observações</label>
          <textarea id="pe-obs" rows={3} maxLength={2000} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
        </div>
      </div>
      <div className="modal__acoes">
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="botao botao--primario" disabled={salvando}>
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar"}
        </button>
      </div>
    </form>
  );
}

type Campo = "nome" | "praca";

export function Equipe() {
  const { pode, unidades, praca, usuario } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("pessoas:gerenciar");
  const [papel, setPapel] = useState<PapelPessoa | "">("");
  const [filtroPraca, setFiltroPraca] = useState(praca);
  const [busca, setBusca] = useState("");
  const [inativos, setInativos] = useState(false);
  const [formulario, setFormulario] = useState<{ pessoa: Pessoa | null } | null>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const tabela = useTabela<Campo>("nome");
  const hoje = hojeIso();

  // Acompanha o seletor de praça do topo.
  useEffect(() => setFiltroPraca(praca), [praca]);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        campoBusca.current?.focus();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const lista = useCarregar((s) => api.get<Pessoa[]>(`/api/pessoas${qs({ papel: papel || undefined, ativos: inativos ? "false" : undefined })}`, s), [papel, inativos]);

  const termo = normalizarBusca(busca.trim());
  const filtradas = (lista.dados ?? [])
    // Quem atende todas as praças aparece em qualquer filtro de praça.
    .filter((p) => !filtroPraca || !p.unidadeId || p.unidadeId === filtroPraca)
    .filter((p) => !termo || normalizarBusca(p.nome).includes(termo) || normalizarBusca(p.idiomas.join(" ")).includes(termo))
    .sort((a, b) => {
      const r = tabela.ordem.campo === "praca" ? compararTexto(nomePraca(unidades, a.unidadeId), nomePraca(unidades, b.unidadeId)) || compararTexto(a.nome, b.nome) : compararTexto(a.nome, b.nome);
      return tabela.ordem.asc ? r : -r;
    });
  const { visiveis, atual, paginas, total } = tabela.paginar(filtradas);
  const comPendencia = filtradas.filter((p) => p.ativo && pendenciasValidade(p, hoje).length > 0);
  const algumaCompleta = filtradas.some(ehCompleta);

  function exportar() {
    const csv = gerarCsv(
      ["Nome", "Papéis", "Praça", "Idiomas", "CNH categoria", "CNH validade", "Cadastur", "Cadastur validade", "Diária (R$)", "Situação"],
      filtradas.map((p) => [
        p.nome,
        p.papeis.map((x) => ROTULO_PAPEL[x]).join(", "),
        nomePraca(unidades, p.unidadeId),
        p.idiomas.join(", "),
        p.cnhCategoria ?? "",
        formatarData(p.cnhValidade),
        p.cadasturNumero ?? "",
        formatarData(p.cadasturValidade),
        p.diariaCentavos != null ? textoDeCentavos(p.diariaCentavos) : "",
        p.ativo ? "Ativo" : "Inativo",
      ]),
    );
    baixarCsv(`equipe-${hoje}.csv`, csv);
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Equipe</h1>
          <p className="pagina__descricao">Guias, motoristas, colaboradores e parceiros. Quem estiver aqui pode ser escalado nas saídas.</p>
        </div>
        {podeEditar && (
          <button type="button" className="botao botao--primario" onClick={() => setFormulario({ pessoa: null })}>
            <Icone nome="mais" /> Cadastrar pessoa
          </button>
        )}
      </div>

      <div className="filtros" role="search" aria-label="Filtrar equipe">
        <div className="campo">
          <label htmlFor="eq-filtro-papel">Papel</label>
          <select
            id="eq-filtro-papel"
            value={papel}
            onChange={(e) => {
              setPapel(e.target.value as PapelPessoa | "");
              tabela.setPagina(0);
            }}
          >
            <option value="">Todos</option>
            {PAPEIS_PESSOA.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PAPEL[p]}
              </option>
            ))}
          </select>
        </div>
        {unidades.length > 1 && (
          <div className="campo">
            <label htmlFor="eq-filtro-praca">Praça</label>
            <select
              id="eq-filtro-praca"
              value={filtroPraca}
              onChange={(e) => {
                setFiltroPraca(e.target.value);
                tabela.setPagina(0);
              }}
            >
              <option value="">Todas as praças</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="campo campo--busca">
          <label htmlFor="eq-busca">Buscar</label>
          <input
            id="eq-busca"
            ref={campoBusca}
            type="search"
            placeholder="Nome ou idioma (atalho /)"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              tabela.setPagina(0);
            }}
          />
        </div>
        <label className="interruptor">
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
          Mostrar inativos
        </label>
        <button type="button" className="botao botao--secundario" onClick={exportar} disabled={filtradas.length === 0}>
          <Icone nome="baixar" /> Exportar CSV
        </button>
      </div>

      {algumaCompleta && comPendencia.length > 0 && (
        <Aviso tipo="atencao" titulo="Documentos vencidos ou vencendo em 30 dias">
          {comPendencia.map((p) => `${p.nome} (${pendenciasValidade(p, hoje).join(", ")})`).join("; ")}.
        </Aviso>
      )}

      {lista.carregando && !lista.dados ? (
        <Carregando texto="Carregando equipe…" />
      ) : lista.erro ? (
        <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} />
      ) : filtradas.length === 0 ? (
        <Vazio titulo="Ninguém encontrado com estes filtros.">{podeEditar ? "Cadastre guias e motoristas pelo botão “Cadastrar pessoa”." : null}</Vazio>
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="visualmente-oculto">Equipe ({total} pessoas)</caption>
              <thead>
                <tr>
                  <CabecalhoOrdenavel campo="nome" rotulo="Nome" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  <th scope="col">Papéis</th>
                  <CabecalhoOrdenavel campo="praca" rotulo="Praça" ordem={tabela.ordem} ordenar={tabela.ordenar} />
                  {algumaCompleta && <th scope="col">Contato</th>}
                  <th scope="col">Idiomas</th>
                  {algumaCompleta && <th scope="col">CNH / Cadastur</th>}
                  {algumaCompleta && (
                    <th scope="col" className="num">
                      Diária
                    </th>
                  )}
                  {podeEditar && (
                    <th scope="col">
                      <span className="visualmente-oculto">Ações</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const completa = ehCompleta(p);
                  return (
                    <tr key={p.id} className={p.ativo ? "" : "linha--inativa"}>
                      <td>
                        {p.nome}
                        {!p.ativo && <span className="etiqueta etiqueta--perigo">inativo</span>}
                      </td>
                      <td>
                        {p.papeis.map((x) => (
                          <span key={x} className="etiqueta etiqueta--neutra">
                            {ROTULO_PAPEL[x]}
                          </span>
                        ))}
                      </td>
                      <td>{nomePraca(unidades, p.unidadeId)}</td>
                      {algumaCompleta && (
                        <td className="celula-pilha">
                          {p.telefone && <span className="sem-quebra">{p.telefone}</span>}
                          {p.email && <span>{p.email}</span>}
                        </td>
                      )}
                      <td>{p.idiomas.join(", ") || <span className="texto-fraco">—</span>}</td>
                      {algumaCompleta && (
                        <td className="celula-pilha">
                          {p.papeis.includes("MOTORISTA") && completa && (
                            <span>
                              {p.cnhCategoria ? `CNH ${p.cnhCategoria} ` : ""}
                              {p.cnhValidade ? <EtiquetaValidade rotulo="CNH" validade={p.cnhValidade} hoje={hoje} /> : <span className="texto-fraco">CNH sem validade informada</span>}
                            </span>
                          )}
                          {p.papeis.includes("GUIA") && completa && (
                            <span>
                              {p.cadasturValidade ? (
                                <EtiquetaValidade rotulo="Cadastur" validade={p.cadasturValidade} hoje={hoje} />
                              ) : (
                                <span className="texto-fraco">Cadastur sem validade informada</span>
                              )}
                            </span>
                          )}
                        </td>
                      )}
                      {algumaCompleta && <td className="num">{p.diariaCentavos != null ? formatarMoeda(p.diariaCentavos) : ""}</td>}
                      {podeEditar && (
                        <td className="celula-acoes">
                          {completa && (
                            <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setFormulario({ pessoa: p })} aria-label={`Editar ${p.nome}`}>
                              Editar
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginacao atual={atual} paginas={paginas} total={total} setPagina={tabela.setPagina} />
        </>
      )}

      <Modal aberto={!!formulario} titulo={formulario?.pessoa ? `Editar ${formulario.pessoa.nome}` : "Cadastrar pessoa"} aoFechar={() => setFormulario(null)} largura="larga">
        {formulario && (
          <FormPessoa
            pessoa={formulario.pessoa}
            unidades={unidades}
            todasUnidades={!!usuario?.todasUnidades}
            pracaPadrao={filtroPraca}
            aoCancelar={() => setFormulario(null)}
            aoSalvar={async (p) => {
              setFormulario(null);
              notificar(formulario.pessoa ? `${p.nome}: cadastro atualizado.` : `${p.nome} cadastrado(a) na equipe.`);
              await lista.recarregar();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
