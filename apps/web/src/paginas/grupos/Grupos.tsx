import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ROTULO_ANEXO_GRUPO, ROTULO_STATUS_GRUPO, ROTULO_TIPO_GRUPO, STATUS_GRUPO, TIPOS_ANEXO_GRUPO, TIPOS_GRUPO, totalDoGrupo,
  type StatusGrupo, type TipoAnexoGrupo, type TipoGrupo,
} from "@bybus/core";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import type { Pessoa } from "../../api/tipos";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { useNotificar } from "../../componentes/Notificacoes";
import { nomePraca, useSessao } from "../../sessao/Sessao";
import { lerBase64 } from "../../util/foto";
import { centavosDeTexto, formatarData, formatarMoeda, hojeIso, textoDeCentavos } from "../../util/formato";
import { useAtraso } from "../../util/useAtraso";
import { imprimirPagina } from "../../util/appCelular";
import { corpoLista, EditorLista, linhaVazia, paraLinhas, type LinhaLista } from "./EditorLista";
import { Modal } from "../../componentes/Modal";
import { AssinaturaGrupo } from "./AssinaturaGrupo";

interface DadosEmpresa { razaoSocial: string; cnpj: string; endereco: string; cidadeForo: string; assinanteNome: string | null; assinanteCargo: string | null }

/** Dados da empresa no contrato e no recibo (quem assina etc.): todos veem; só o administrador altera. */
function DadosContrato({ aoFechar }: { aoFechar: () => void }) {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeEditar = pode("usuarios:gerenciar");
  const dados = useCarregar((s) => api.get<DadosEmpresa>("/api/configuracoes/contrato", s), []);
  const [f, setF] = useState<DadosEmpresa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (dados.dados) setF(dados.dados); }, [dados.dados]);
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    try {
      await api.put("/api/configuracoes/contrato", f);
      notificar("Dados do contrato salvos.");
      aoFechar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  const c = (k: keyof DadosEmpresa, rotulo: string, id: string) => (
    <div className="campo campo--largo"><label htmlFor={id}>{rotulo}</label><input id={id} value={f?.[k] ?? ""} disabled={!podeEditar} onChange={(e) => f && setF({ ...f, [k]: e.target.value })} /></div>
  );
  return (
    <Modal aberto titulo="Dados da empresa no contrato e no recibo" aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!f ? <Carregando /> : (
        <form onSubmit={(e) => void salvar(e)}>
          {!podeEditar && <p className="texto-fraco">Só o administrador altera estes dados.</p>}
          <div className="grade-campos">
            {c("razaoSocial", "Razão social", "dc-razao")}
            {c("cnpj", "CNPJ", "dc-cnpj")}
            {c("endereco", "Endereço", "dc-end")}
            {c("cidadeForo", "Cidade (foro e local da assinatura)", "dc-foro")}
            {c("assinanteNome", "Quem assina pela By Bus", "dc-assinante")}
            {c("assinanteCargo", "Cargo de quem assina", "dc-cargo")}
          </div>
          {podeEditar && <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={aoFechar}>Cancelar</button><button type="submit" className="botao botao--primario">Salvar</button></div>}
        </form>
      )}
    </Modal>
  );
}
import { useCarregar } from "../../util/useCarregar";

interface GrupoLista {
  id: string; nome: string; estilo: TipoGrupo; status: StatusGrupo; dataPasseio: string | null; pessoas: number | null;
  valorPorPessoaCentavos: number | null; valorTotalCentavos: number | null; representanteNome: string | null; representanteTelefone: string | null;
  nfEmitida: boolean; unidadeId: string | null; guia: string | null; cobradoCentavos: number; recebidoCentavos: number;
}
interface Cobranca { id: string; descricao: string; valorCentavos: number; vencimento: string; situacao: string; pagoEm: string | null; valorPagoCentavos: number | null }
interface Anexo { id: string; tipo: TipoAnexoGrupo; nomeArquivo: string; tamanho: number; criadoEm: string }
interface GrupoDetalhe {
  id: string; unidadeId: string | null; nome: string; estilo: TipoGrupo; status: StatusGrupo; dataPasseio: string | null; horarioInicio: string | null; localInicio: string | null;
  guiaId: string | null; veiculo: string | null; roteiro: string | null; duracaoTexto: string | null; almoco: boolean; localAlmoco: string | null;
  pessoas: number | null; pessoasMinimo: number | null; cortesias: number; valorPorPessoaCentavos: number | null; valorTotalCentavos: number | null; sinalPercentual: number;
  nfEmitida: boolean; nfNumero: string | null; razaoSocial: string | null; cnpj: string | null; endereco: string | null;
  representanteNome: string | null; representanteCargo: string | null; representanteTelefone: string | null; representanteEmail: string | null; representanteCpf: string | null;
  observacoes: string | null; cobrancas: Cobranca[]; anexos: Anexo[]; passageirosNaLista: number;
  anteriores: Array<{ id: string; dataPasseio: string | null; status: StatusGrupo; pessoas: number | null; valorPorPessoaCentavos: number | null; valorTotalCentavos: number | null; roteiro: string | null }>;
}

const ETIQUETA_STATUS: Record<StatusGrupo, string> = { ORCAMENTO: "etiqueta--neutra", CONFIRMADO: "etiqueta--atencao", REALIZADO: "etiqueta--sucesso", CANCELADO: "etiqueta--perigo" };

/** Grupos fechados (dono, 13/11/2026): lista com busca, filtros e o que já foi recebido de cada grupo. */
export function Grupos() {
  const [texto, setTexto] = useState("");
  const q = useAtraso(texto.trim(), 300);
  const [status, setStatus] = useState("");
  const [estilo, setEstilo] = useState("");
  const [ano, setAno] = useState("");
  const lista = useCarregar((s) => api.get<GrupoLista[]>(`/api/grupos${qs({ q: q || undefined, status: status || undefined, estilo: estilo || undefined, ano: ano || undefined })}`, s), [q, status, estilo, ano]);
  const anoAtual = Number(hojeIso().slice(0, 4));
  const [dadosContrato, setDadosContrato] = useState(false);
  return (
    <div className="pagina">
      <div className="pagina__cabecalho">
        <div>
          <h1>Grupos fechados</h1>
          <p className="pagina__descricao">Escolas, empresas e excursões: data, roteiro, valores, representante, pagamentos, contrato e histórico de anos anteriores.</p>
        </div>
        <div className="barra-acoes">
          <button type="button" className="botao botao--secundario" onClick={() => setDadosContrato(true)}><Icone nome="engrenagem" /> Dados do contrato</button>
          <Link className="botao botao--primario" to="/grupos/novo"><Icone nome="mais" /> Novo grupo</Link>
        </div>
      </div>
      <div className="filtros" role="search" aria-label="Filtros dos grupos">
        <div className="campo campo--linha campo--busca"><label htmlFor="gr-busca">Buscar</label><input id="gr-busca" type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Grupo, representante ou roteiro" /></div>
        <div className="campo campo--linha"><label htmlFor="gr-status">Situação</label>
          <select id="gr-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option>{STATUS_GRUPO.map((s) => <option key={s} value={s}>{ROTULO_STATUS_GRUPO[s]}</option>)}</select>
        </div>
        <div className="campo campo--linha"><label htmlFor="gr-estilo">Estilo</label>
          <select id="gr-estilo" value={estilo} onChange={(e) => setEstilo(e.target.value)}><option value="">Todos</option>{TIPOS_GRUPO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_GRUPO[t]}</option>)}</select>
        </div>
        <div className="campo campo--linha"><label htmlFor="gr-ano">Ano</label>
          <select id="gr-ano" value={ano} onChange={(e) => setAno(e.target.value)}><option value="">Todos</option>{[anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => <option key={a} value={a}>{a}</option>)}</select>
        </div>
      </div>
      {dadosContrato && <DadosContrato aoFechar={() => setDadosContrato(false)} />}
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : !lista.dados?.length ? <Vazio titulo="Nenhum grupo encontrado." /> : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th scope="col">Data</th><th scope="col">Grupo</th><th scope="col">Representante</th><th scope="col" className="num">Pessoas</th><th scope="col" className="num">Valor</th><th scope="col" className="num">Recebido</th><th scope="col">Situação</th></tr></thead>
            <tbody>
              {lista.dados.map((g) => (
                <tr key={g.id}>
                  <td className="sem-quebra">{g.dataPasseio ? formatarData(g.dataPasseio) : "A definir"}</td>
                  <td><Link to={`/grupos/${g.id}`}><strong>{g.nome}</strong></Link><div className="texto-fraco">{ROTULO_TIPO_GRUPO[g.estilo]}{g.guia ? ` · Guia: ${g.guia}` : ""}{g.nfEmitida ? " · NF emitida" : ""}</div></td>
                  <td>{g.representanteNome ?? "—"}{g.representanteTelefone && <div className="texto-fraco">{g.representanteTelefone}</div>}</td>
                  <td className="num">{g.pessoas ?? "—"}</td>
                  <td className="num">{g.valorTotalCentavos != null ? formatarMoeda(g.valorTotalCentavos) : "—"}{g.valorPorPessoaCentavos != null && <div className="texto-fraco">{formatarMoeda(g.valorPorPessoaCentavos)}/pessoa</div>}</td>
                  <td className="num">{g.cobradoCentavos ? formatarMoeda(g.recebidoCentavos) : "—"}{g.cobradoCentavos > 0 && g.recebidoCentavos < g.cobradoCentavos && <div className="texto-fraco">falta {formatarMoeda(g.cobradoCentavos - g.recebidoCentavos)}</div>}</td>
                  <td><span className={`etiqueta ${ETIQUETA_STATUS[g.status]}`}>{ROTULO_STATUS_GRUPO[g.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Form = Record<string, string | boolean>;
const vazio = (): Form => ({
  unidadeId: "", nome: "", estilo: "ESCOLA", status: "ORCAMENTO", dataPasseio: "", horarioInicio: "", localInicio: "", guiaId: "", veiculo: "", roteiro: "", duracaoTexto: "",
  almoco: false, localAlmoco: "", pessoas: "", pessoasMinimo: "", cortesias: "0", valorPorPessoa: "", valorTotal: "", sinalPercentual: "50", nfEmitida: false, nfNumero: "",
  razaoSocial: "", cnpj: "", endereco: "", representanteNome: "", representanteCargo: "", representanteTelefone: "", representanteEmail: "", representanteCpf: "", observacoes: "",
});
function doDetalhe(g: GrupoDetalhe): Form {
  const s = (v: string | number | null | undefined) => (v == null ? "" : String(v));
  return {
    unidadeId: s(g.unidadeId), nome: g.nome, estilo: g.estilo, status: g.status, dataPasseio: s(g.dataPasseio), horarioInicio: s(g.horarioInicio), localInicio: s(g.localInicio),
    guiaId: s(g.guiaId), veiculo: s(g.veiculo), roteiro: s(g.roteiro), duracaoTexto: s(g.duracaoTexto), almoco: g.almoco, localAlmoco: s(g.localAlmoco),
    pessoas: s(g.pessoas), pessoasMinimo: s(g.pessoasMinimo), cortesias: s(g.cortesias), valorPorPessoa: textoDeCentavos(g.valorPorPessoaCentavos), valorTotal: "",
    sinalPercentual: s(g.sinalPercentual), nfEmitida: g.nfEmitida, nfNumero: s(g.nfNumero), razaoSocial: s(g.razaoSocial), cnpj: s(g.cnpj), endereco: s(g.endereco),
    representanteNome: s(g.representanteNome), representanteCargo: s(g.representanteCargo), representanteTelefone: s(g.representanteTelefone), representanteEmail: s(g.representanteEmail),
    representanteCpf: s(g.representanteCpf), observacoes: s(g.observacoes),
  };
}
const inteiro = (t: string | boolean) => (t === "" ? null : Number(t));

interface RespostaLista {
  passageiros: Array<{ nome: string; tipoDocumento: string | null; documento: string | null; nascimento: string | null; categoria: string; origem: string }>;
  totais: Record<string, number>;
  link: { ativo: boolean; expiraEm: string | null; atualizadaEm: string | null };
}

/** Lista de passageiros do grupo: planilha online da equipe, link para o representante e impressão (13/11/2026). */
function ListaDoGrupo({ grupoId, nome, estilo }: { grupoId: string; nome: string; estilo: TipoGrupo }) {
  const notificar = useNotificar();
  const dados = useCarregar((s) => api.get<RespostaLista>(`/api/grupos/${grupoId}/passageiros`, s), [grupoId]);
  const padrao = estilo === "ESCOLA" ? "ALUNO" : "OUTRO";
  const [linhas, setLinhas] = useState<LinhaLista[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (dados.dados) setLinhas(dados.dados.passageiros.length ? paraLinhas(dados.dados.passageiros as never) : Array.from({ length: 5 }, () => linhaVazia(padrao))); }, [dados.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  async function salvar() {
    if (!linhas) return;
    setErro(null);
    setSalvando(true);
    try {
      const r = await api.put<{ quantidade: number }>(`/api/grupos/${grupoId}/passageiros`, { passageiros: corpoLista(linhas) });
      notificar(`Lista salva: ${r.quantidade} pessoa(s).`);
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  async function gerarLink() {
    setErro(null);
    try {
      const r = await api.post<{ caminho: string }>(`/api/grupos/${grupoId}/link-lista`, { dias: 30 });
      setLink(`${window.location.origin}${r.caminho}`);
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function cancelarLink() {
    try {
      await api.delete(`/api/grupos/${grupoId}/link-lista`);
      setLink(null);
      notificar("Link cancelado.");
      await dados.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  const d = dados.dados;
  return (
    <section className="cartao" aria-labelledby="g-tit-lista">
      <h2 id="g-tit-lista">Lista de passageiros <span className="so-impressao">— {nome}</span></h2>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {d && (
        <div className="nao-imprimir">
          <p className="texto-fraco">
            {d.passageiros.length} na lista ({Object.entries(d.totais).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k === "ALUNO" ? "aluno(s)" : k === "PROFESSOR" ? "professor(es)/monitor(es)" : k === "ACOMPANHANTE" ? "acompanhante(s)" : "outro(s)"}`).join(", ") || "vazia"})
            {d.link.atualizadaEm ? ` · atualizada em ${new Date(d.link.atualizadaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </p>
          <div className="filtros">
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void gerarLink()}>{d.link.ativo ? "Gerar novo link para o representante" : "Link para o representante preencher"}</button>
            {d.link.ativo && <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => void cancelarLink()}>Cancelar link</button>}
            <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void imprimirPagina(`Lista de passageiros - ${nome}`)}><Icone nome="imprimir" tamanho={14} /> Imprimir lista</button>
            {d.link.ativo && !link && <span className="texto-fraco">Link ativo até {d.link.expiraEm ? new Date(d.link.expiraEm).toLocaleDateString("pt-BR") : "—"}.</span>}
          </div>
          {link && (
            <Aviso tipo="sucesso">
              Link criado (vale 30 dias; o anterior deixa de valer). Copie e mande ao representante: <br /><code className="frota-link">{link}</code>{" "}
              <button type="button" className="botao botao--pequeno botao--primario" onClick={() => void navigator.clipboard.writeText(link).then(() => notificar("Link copiado."), () => setErro("Selecione o link e copie à mão."))}>Copiar link</button>
            </Aviso>
          )}
        </div>
      )}
      {linhas && <EditorLista linhas={linhas} mudar={setLinhas} padrao={padrao} />}
      <div className="barra-acoes nao-imprimir"><button type="button" className="botao botao--primario" disabled={salvando || !linhas} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar lista"}</button></div>
    </section>
  );
}

/** Cadastro e acompanhamento de um grupo: dados, cobrança (financeiro), anexos e histórico. */
export function GrupoFicha() {
  const { id = "novo" } = useParams();
  const novo = id === "novo";
  const navegar = useNavigate();
  const notificar = useNotificar();
  const { unidades } = useSessao();
  const det = useCarregar((s) => (novo ? Promise.resolve(null) : api.get<GrupoDetalhe>(`/api/grupos/${id}`, s)), [id]);
  const guias = useCarregar((s) => api.get<Pessoa[]>("/api/pessoas?papel=GUIA", s).catch(() => [] as Pessoa[]), []);
  const [f, setF] = useState<Form>(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [vencSinal, setVencSinal] = useState(hojeIso());
  const [tipoAnexo, setTipoAnexo] = useState<TipoAnexoGrupo>("CONTRATO");
  useEffect(() => { if (det.dados) setF(doDetalhe(det.dados)); }, [det.dados]);
  const campo = (k: string) => ({ value: String(f[k] ?? ""), onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  const vpp = centavosDeTexto(String(f.valorPorPessoa));
  const totalManual = centavosDeTexto(String(f.valorTotal));
  const calculado = totalDoGrupo({ valorPorPessoaCentavos: vpp == null || Number.isNaN(vpp) ? null : vpp, pessoas: inteiro(f.pessoas!), pessoasMinimo: inteiro(f.pessoasMinimo!) });

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (String(f.nome).trim().length < 2) return setErro("Informe o nome do grupo ou da instituição.");
    if (Number.isNaN(vpp) || Number.isNaN(totalManual)) return setErro("Valores em reais (ex.: 130,00).");
    const corpo = {
      unidadeId: f.unidadeId || null, nome: String(f.nome).trim(), estilo: f.estilo, status: f.status, dataPasseio: f.dataPasseio || null, horarioInicio: f.horarioInicio || null,
      localInicio: f.localInicio, guiaId: f.guiaId || null, veiculo: f.veiculo, roteiro: f.roteiro, duracaoTexto: f.duracaoTexto, almoco: !!f.almoco, localAlmoco: f.almoco ? f.localAlmoco : null,
      pessoas: inteiro(f.pessoas!), pessoasMinimo: inteiro(f.pessoasMinimo!), cortesias: inteiro(f.cortesias!) ?? 0, valorPorPessoaCentavos: vpp, valorTotalCentavos: totalManual ?? null,
      sinalPercentual: inteiro(f.sinalPercentual!) ?? 50, nfEmitida: !!f.nfEmitida, nfNumero: f.nfNumero, razaoSocial: f.razaoSocial, cnpj: f.cnpj, endereco: f.endereco,
      representanteNome: f.representanteNome, representanteCargo: f.representanteCargo, representanteTelefone: f.representanteTelefone, representanteEmail: f.representanteEmail,
      representanteCpf: f.representanteCpf, observacoes: f.observacoes,
    };
    setSalvando(true);
    try {
      if (novo) {
        const r = await api.post<{ id: string }>("/api/grupos", corpo);
        notificar("Grupo cadastrado.");
        navegar(`/grupos/${r.id}`, { replace: true });
      } else {
        await api.patch(`/api/grupos/${id}`, corpo);
        notificar("Grupo salvo.");
        await det.recarregar();
      }
    } catch (x) {
      setErro(mensagemDeErro(x));
    } finally {
      setSalvando(false);
    }
  }
  async function gerarCobranca() {
    setErro(null);
    try {
      await api.post(`/api/grupos/${id}/cobranca`, { vencimentoSinal: vencSinal });
      notificar("Cobrança criada em Financeiro › A receber.");
      await det.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function anexar(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    if (arquivo.size > 15 * 1024 * 1024) return setErro("O arquivo pode ter até 15 MB.");
    try {
      await api.post(`/api/grupos/${id}/anexos`, { tipo: tipoAnexo, nome: arquivo.name, base64: await lerBase64(arquivo) });
      notificar("Anexo enviado.");
      await det.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }
  async function excluirAnexo(a: Anexo) {
    try {
      await api.delete(`/api/grupos/anexos/${a.id}`);
      notificar("Anexo excluído.");
      await det.recarregar();
    } catch (x) {
      setErro(mensagemDeErro(x));
    }
  }

  if (!novo && det.carregando && !det.dados) return <div className="pagina"><Carregando /></div>;
  if (!novo && det.erro) return <div className="pagina"><ErroCarga mensagem={det.erro} tentarDeNovo={det.recarregar} /></div>;
  const g = det.dados;
  return (
    <div className="pagina">
      <nav className="migalhas nao-imprimir" aria-label="Você está em"><Link to="/grupos">Grupos fechados</Link> <span aria-hidden="true">›</span> <span aria-current="page">{novo ? "Novo grupo" : g?.nome}</span></nav>
      <div className="pagina__cabecalho">
        <h1>{novo ? "Novo grupo" : g?.nome}</h1>
        {g && (
          <div className="barra-acoes nao-imprimir">
            <a className="botao botao--secundario" href={`/api/grupos/${g.id}/contrato.pdf`} target="_blank" rel="noopener noreferrer"><Icone nome="imprimir" /> Contrato (PDF)</a>
          </div>
        )}
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <form onSubmit={(e) => void salvar(e)} className="grupo-ficha nao-imprimir">
        <fieldset className="cartao"><legend>Grupo e passeio</legend>
          <div className="grade-campos">
            <div className="campo campo--largo"><label htmlFor="g-nome">Nome do grupo / instituição</label><input id="g-nome" maxLength={160} {...campo("nome")} /></div>
            <div className="campo"><label htmlFor="g-estilo">Estilo do grupo</label><select id="g-estilo" {...campo("estilo")}>{TIPOS_GRUPO.map((t) => <option key={t} value={t}>{ROTULO_TIPO_GRUPO[t]}</option>)}</select></div>
            <div className="campo"><label htmlFor="g-status">Situação</label><select id="g-status" {...campo("status")}>{STATUS_GRUPO.map((s) => <option key={s} value={s}>{ROTULO_STATUS_GRUPO[s]}</option>)}</select></div>
            {unidades.length > 1 && <div className="campo"><label htmlFor="g-praca">Praça</label><select id="g-praca" {...campo("unidadeId")}><option value="">Todas</option>{unidades.map((u) => <option key={u.id} value={u.id}>{nomePraca(unidades, u.id)}</option>)}</select></div>}
            <div className="campo"><label htmlFor="g-data">Data do passeio</label><input id="g-data" type="date" {...campo("dataPasseio")} /></div>
            <div className="campo"><label htmlFor="g-hora">Horário de início</label><input id="g-hora" type="time" {...campo("horarioInicio")} /></div>
            <div className="campo"><label htmlFor="g-local">Local de início</label><input id="g-local" maxLength={200} {...campo("localInicio")} /></div>
            <div className="campo"><label htmlFor="g-guia">Guia</label><select id="g-guia" {...campo("guiaId")}><option value="">A definir</option>{(guias.dados ?? []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></div>
            <div className="campo"><label htmlFor="g-veiculo">Veículo</label><input id="g-veiculo" maxLength={120} {...campo("veiculo")} placeholder="Ex.: ônibus, van, placa" /></div>
            <div className="campo"><label htmlFor="g-duracao">Duração</label><input id="g-duracao" maxLength={120} {...campo("duracaoTexto")} placeholder="Ex.: 8h a 8h30" /></div>
            <div className="campo campo--largo"><label htmlFor="g-roteiro">Roteiro</label><textarea id="g-roteiro" rows={8} maxLength={8000} {...campo("roteiro")} placeholder="Paradas, tempos e observações do roteiro" /></div>
          </div>
          <label className="interruptor"><input type="checkbox" checked={!!f.almoco} onChange={(e) => setF({ ...f, almoco: e.target.checked })} /> Houve parada para almoço</label>
          {f.almoco && <div className="campo"><label htmlFor="g-almoco">Onde foi o almoço</label><input id="g-almoco" maxLength={200} {...campo("localAlmoco")} /></div>}
        </fieldset>

        <fieldset className="cartao"><legend>Valores</legend>
          <div className="grade-campos">
            <div className="campo"><label htmlFor="g-pessoas">Pessoas (pagantes)</label><input id="g-pessoas" inputMode="numeric" {...campo("pessoas")} /></div>
            <div className="campo"><label htmlFor="g-minimo">Mínimo contratado</label><input id="g-minimo" inputMode="numeric" {...campo("pessoasMinimo")} /></div>
            <div className="campo"><label htmlFor="g-cortesias">Cortesias</label><input id="g-cortesias" inputMode="numeric" {...campo("cortesias")} /></div>
            <div className="campo"><label htmlFor="g-vpp">Valor por pessoa (R$)</label><input id="g-vpp" inputMode="decimal" {...campo("valorPorPessoa")} placeholder="0,00" /></div>
            <div className="campo"><label htmlFor="g-total">Valor total (R$)</label><input id="g-total" inputMode="decimal" {...campo("valorTotal")} placeholder={calculado != null ? textoDeCentavos(calculado) : "calculado"} /><span className="campo__ajuda">Vazio = valor por pessoa × pessoas (respeitando o mínimo){g?.valorTotalCentavos != null ? `. Atual: ${formatarMoeda(g.valorTotalCentavos)}` : ""}</span></div>
            <div className="campo"><label htmlFor="g-sinal">Sinal antecipado (%)</label><input id="g-sinal" inputMode="numeric" {...campo("sinalPercentual")} /></div>
            <div className="campo"><label htmlFor="g-nfnum">Nº da NF</label><input id="g-nfnum" maxLength={60} {...campo("nfNumero")} /></div>
          </div>
          <label className="interruptor"><input type="checkbox" checked={!!f.nfEmitida} onChange={(e) => setF({ ...f, nfEmitida: e.target.checked })} /> Nota fiscal emitida</label>
        </fieldset>

        <fieldset className="cartao"><legend>Contratante e representante</legend>
          <div className="grade-campos">
            <div className="campo campo--largo"><label htmlFor="g-razao">Razão social</label><input id="g-razao" maxLength={200} {...campo("razaoSocial")} /></div>
            <div className="campo"><label htmlFor="g-cnpj">CNPJ</label><input id="g-cnpj" maxLength={20} {...campo("cnpj")} /></div>
            <div className="campo campo--largo"><label htmlFor="g-endereco">Endereço</label><input id="g-endereco" maxLength={300} {...campo("endereco")} /></div>
            <div className="campo"><label htmlFor="g-rep">Representante</label><input id="g-rep" maxLength={160} {...campo("representanteNome")} /></div>
            <div className="campo"><label htmlFor="g-cargo">Cargo</label><input id="g-cargo" maxLength={80} {...campo("representanteCargo")} /></div>
            <div className="campo"><label htmlFor="g-cpf">CPF do representante</label><input id="g-cpf" inputMode="numeric" maxLength={20} {...campo("representanteCpf")} /></div>
            <div className="campo"><label htmlFor="g-tel">Telefone</label><input id="g-tel" maxLength={40} {...campo("representanteTelefone")} /></div>
            <div className="campo"><label htmlFor="g-email">E-mail</label><input id="g-email" type="email" maxLength={160} {...campo("representanteEmail")} /></div>
          </div>
        </fieldset>

        <fieldset className="cartao"><legend>Observações</legend>
          <textarea id="g-obs" aria-label="Observações" rows={4} maxLength={4000} {...campo("observacoes")} />
        </fieldset>
        <div className="barra-acoes"><button type="submit" className="botao botao--primario" disabled={salvando}>{salvando ? "Salvando…" : novo ? "Cadastrar grupo" : "Salvar"}</button></div>
      </form>

      {g && (
        <>
          <ListaDoGrupo grupoId={g.id} nome={g.nome} estilo={g.estilo} />

          <AssinaturaGrupo grupoId={g.id} representante={{ nome: g.representanteNome, email: g.representanteEmail, cpf: g.representanteCpf }} empresa={{ nome: null }} />

          <section className="cartao nao-imprimir" aria-labelledby="g-tit-cobranca">
            <h2 id="g-tit-cobranca">Pagamentos</h2>
            {g.cobrancas.length === 0 ? (
              <>
                <p className="texto-fraco">Gera as contas a receber em Financeiro › A receber: sinal de {g.sinalPercentual}% e o saldo até o dia do passeio. A baixa (pagamento) é feita no financeiro.</p>
                <div className="filtros">
                  <div className="campo campo--linha"><label htmlFor="g-venc-sinal">Vencimento do sinal</label><input id="g-venc-sinal" type="date" value={vencSinal} onChange={(e) => setVencSinal(e.target.value)} /></div>
                  <button type="button" className="botao botao--primario" onClick={() => void gerarCobranca()} disabled={!g.valorTotalCentavos}>Gerar cobrança</button>
                </div>
              </>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th scope="col">Parcela</th><th scope="col">Vencimento</th><th scope="col" className="num">Valor</th><th scope="col">Situação</th><th scope="col"><span className="visualmente-oculto">Recibo</span></th></tr></thead>
                  <tbody>
                    {g.cobrancas.map((c) => (
                      <tr key={c.id}>
                        <td>{c.descricao.replace(`${g.nome} — `, "")}</td>
                        <td className="sem-quebra">{formatarData(c.vencimento)}</td>
                        <td className="num">{formatarMoeda(c.valorCentavos)}</td>
                        <td>{c.situacao === "REALIZADO" ? <span className="etiqueta etiqueta--sucesso">Pago em {formatarData(c.pagoEm)}</span> : c.vencimento < hojeIso() ? <span className="etiqueta etiqueta--perigo">Vencido</span> : <span className="etiqueta etiqueta--neutra">Em aberto</span>}</td>
                        <td>{c.situacao === "REALIZADO" && <a className="botao botao--pequeno botao--secundario" href={`/api/grupos/${g.id}/recibo/${c.id}`} target="_blank" rel="noopener noreferrer">Recibo</a>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cartao nao-imprimir" aria-labelledby="g-tit-anexos">
            <h2 id="g-tit-anexos">Contrato, comprovantes e anexos</h2>
            <div className="filtros">
              <div className="campo campo--linha"><label htmlFor="g-tipo-anexo">Tipo</label><select id="g-tipo-anexo" value={tipoAnexo} onChange={(e) => setTipoAnexo(e.target.value as TipoAnexoGrupo)}>{TIPOS_ANEXO_GRUPO.map((t) => <option key={t} value={t}>{ROTULO_ANEXO_GRUPO[t]}</option>)}</select></div>
              <div className="campo campo--linha"><label htmlFor="g-arquivo">Arquivo</label><input id="g-arquivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.xml,.doc,.docx,.xls,.xlsx" onChange={(e) => { void anexar(e.target.files?.[0]); e.target.value = ""; }} /></div>
            </div>
            {g.anexos.length === 0 ? <p className="texto-fraco">Nenhum anexo.</p> : (
              <ul className="lista-simples">
                {g.anexos.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/grupos/anexos/${a.id}`} target="_blank" rel="noopener noreferrer">{ROTULO_ANEXO_GRUPO[a.tipo]} — {a.nomeArquivo}</a>{" "}
                    <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => void excluirAnexo(a)} aria-label={`Excluir ${a.nomeArquivo}`}>Excluir</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cartao nao-imprimir" aria-labelledby="g-tit-hist">
            <h2 id="g-tit-hist">Histórico deste grupo</h2>
            {g.anteriores.length === 0 ? <p className="texto-fraco">Nenhum outro passeio deste grupo (mesmo nome ou CNPJ).</p> : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead><tr><th scope="col">Data</th><th scope="col" className="num">Pessoas</th><th scope="col" className="num">Por pessoa</th><th scope="col" className="num">Total</th><th scope="col">Roteiro</th><th scope="col">Situação</th></tr></thead>
                  <tbody>
                    {g.anteriores.map((a) => (
                      <tr key={a.id}>
                        <td><Link to={`/grupos/${a.id}`}>{a.dataPasseio ? formatarData(a.dataPasseio) : "A definir"}</Link></td>
                        <td className="num">{a.pessoas ?? "—"}</td>
                        <td className="num">{a.valorPorPessoaCentavos != null ? formatarMoeda(a.valorPorPessoaCentavos) : "—"}</td>
                        <td className="num">{a.valorTotalCentavos != null ? formatarMoeda(a.valorTotalCentavos) : "—"}</td>
                        <td className="grupo-roteiro-curto">{a.roteiro ?? "—"}</td>
                        <td><span className={`etiqueta ${ETIQUETA_STATUS[a.status]}`}>{ROTULO_STATUS_GRUPO[a.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
