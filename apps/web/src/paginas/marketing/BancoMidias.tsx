import { useRef, useState } from "react";
import { api, mensagemDeErro, qs } from "../../api/cliente";
import { enviarArquivo } from "../../api/envio";
import { Aviso, Carregando, ErroCarga, Vazio } from "../../componentes/Estados";
import { Icone } from "../../componentes/Icone";
import { Confirmar, Modal } from "../../componentes/Modal";
import { CabecalhoPagina } from "../../componentes/Pagina";
import { useNotificar } from "../../componentes/Notificacoes";
import { useSessao } from "../../sessao/Sessao";
import { useCarregar } from "../../util/useCarregar";

export interface ItemBanco { previa?: string; id: string; nome: string; tipo: string; uso: "IMAGEM" | "VIDEO"; tamanho: number; passeio: string | null; pontoTuristico: string | null; temporada: string | null; criadoEm: string }
interface ListaBanco { itens: ItemBanco[]; etiquetas: { passeios: string[]; pontosTuristicos: string[]; temporadas: string[] } }
/** O Instagram só publica imagem JPEG e vídeo MP4 (a confirmar na doc oficial). */
export const publicavelNoInstagram = (tipo: string) => tipo === "image/jpeg" || tipo === "video/mp4";
const tamanhoLegivel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Miniatura({ item }: { item: ItemBanco }) {
  const url = item.previa ?? `/api/marketing/banco-midias/${item.id}/arquivo`; // `previa` só existe na demonstração
  return item.uso === "VIDEO" && !item.previa
    ? <video className="banco__midia" src={url} preload="metadata" muted aria-label={item.nome} />
    : <img className="banco__midia" src={url} alt={item.nome} loading="lazy" />;
}

function Etiquetas({ i }: { i: ItemBanco }) {
  return <span className="banco__etiquetas">{[i.passeio, i.pontoTuristico, i.temporada].filter(Boolean).map((e) => <span key={e} className="etiqueta etiqueta--neutra">{e}</span>)}</span>;
}

function Filtros({ dados, valor, aoMudar }: { dados: ListaBanco | null; valor: { passeio: string; pontoTuristico: string; temporada: string; busca: string }; aoMudar: (v: { passeio: string; pontoTuristico: string; temporada: string; busca: string }) => void }) {
  const opcoes = (rotulo: string, chave: "passeio" | "pontoTuristico" | "temporada", lista: string[]) => (
    <div className="campo campo--linha"><label htmlFor={`bm-${chave}`}>{rotulo}</label>
      <select id={`bm-${chave}`} value={valor[chave]} onChange={(e) => aoMudar({ ...valor, [chave]: e.target.value })}><option value="">Todos</option>{lista.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
  );
  return (
    <div className="filtros" role="search" aria-label="Filtrar mídias">
      {opcoes("Passeio", "passeio", dados?.etiquetas.passeios ?? [])}
      {opcoes("Ponto turístico", "pontoTuristico", dados?.etiquetas.pontosTuristicos ?? [])}
      {opcoes("Temporada", "temporada", dados?.etiquetas.temporadas ?? [])}
      <div className="campo campo--linha"><label htmlFor="bm-busca">Nome</label><input id="bm-busca" type="search" value={valor.busca} onChange={(e) => aoMudar({ ...valor, busca: e.target.value })} /></div>
    </div>
  );
}
const FILTRO_VAZIO = { passeio: "", pontoTuristico: "", temporada: "", busca: "" };

/** Escolher uma mídia do banco para o post (só aparecem as publicáveis no Instagram). */
export function SeletorBanco({ aoEscolher, aoFechar }: { aoEscolher: (i: ItemBanco) => Promise<void>; aoFechar: () => void }) {
  const [f, setF] = useState(FILTRO_VAZIO);
  const lista = useCarregar((s) => api.get<ListaBanco>(`/api/marketing/banco-midias${qs(f)}`, s), [f.passeio, f.pontoTuristico, f.temporada, f.busca]);
  const itens = (lista.dados?.itens ?? []).filter((i) => publicavelNoInstagram(i.tipo));
  return (
    <Modal aberto titulo="Escolher do banco de mídias" aoFechar={aoFechar} largura="larga">
      <Filtros dados={lista.dados} valor={f} aoMudar={setF} />
      {lista.carregando && !lista.dados ? <Carregando /> : itens.length === 0 ? <Vazio titulo="Nenhuma mídia publicável encontrada.">Só imagens JPEG e vídeos MP4 servem ao Instagram.</Vazio> : (
        <ul className="banco__grade">
          {itens.map((i) => (
            <li key={i.id} className="banco__item">
              <Miniatura item={i} />
              <strong className="banco__nome">{i.nome}</strong>
              <Etiquetas i={i} />
              <button type="button" className="botao botao--secundario botao--pequeno" onClick={() => void aoEscolher(i)}>Usar no post</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function BancoMidias() {
  const { pode } = useSessao();
  const notificar = useNotificar();
  const podeGerenciar = pode("marketing:gerenciar");
  const [f, setF] = useState(FILTRO_VAZIO);
  const lista = useCarregar((s) => api.get<ListaBanco>(`/api/marketing/banco-midias${qs(f)}`, s), [f.passeio, f.pontoTuristico, f.temporada, f.busca]);
  const entrada = useRef<HTMLInputElement>(null);
  const [novo, setNovo] = useState({ passeio: "", pontoTuristico: "", temporada: "" });
  const [enviando, setEnviando] = useState(false);
  const [editar, setEditar] = useState<ItemBanco | null>(null);
  const [excluir, setExcluir] = useState<ItemBanco | null>(null);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setEnviando(true);
    let ok = 0;
    for (const a of Array.from(arquivos)) {
      try {
        await enviarArquivo(`/api/marketing/banco-midias${qs({ nome: a.name, ...novo })}`, a);
        ok++;
      } catch (e) { notificar(`${a.name}: ${mensagemDeErro(e)}`, "erro"); }
    }
    if (entrada.current) entrada.current.value = "";
    setEnviando(false);
    if (ok) { notificar(ok === 1 ? "Mídia enviada." : `${ok} mídias enviadas.`); await lista.recarregar(); }
  }
  async function salvarEdicao() {
    if (!editar) return;
    try { await api.patch(`/api/marketing/banco-midias/${editar.id}`, { passeio: editar.passeio, pontoTuristico: editar.pontoTuristico, temporada: editar.temporada }); setEditar(null); notificar("Etiquetas salvas."); await lista.recarregar(); }
    catch (e) { notificar(mensagemDeErro(e), "erro"); }
  }
  async function confirmarExclusao() {
    if (!excluir) return;
    try { await api.delete(`/api/marketing/banco-midias/${excluir.id}`); setExcluir(null); notificar("Mídia excluída."); await lista.recarregar(); }
    catch (e) { notificar(mensagemDeErro(e), "erro"); }
  }
  const itens = lista.dados?.itens ?? [];

  return (
    <div className="pagina">
      <CabecalhoPagina titulo="Banco de mídias" descricao="Fotos e vídeos da empresa para reaproveitar nos posts, organizados por passeio, ponto turístico e temporada." />
      {podeGerenciar && (
        <section className="cartao banco__envio" aria-label="Enviar mídia">
          <div className="grade-campos">
            <div className="campo"><label htmlFor="bm-n-passeio">Passeio</label><input id="bm-n-passeio" list="bm-passeios" value={novo.passeio} maxLength={120} onChange={(e) => setNovo({ ...novo, passeio: e.target.value })} /></div>
            <div className="campo"><label htmlFor="bm-n-ponto">Ponto turístico</label><input id="bm-n-ponto" list="bm-pontos" value={novo.pontoTuristico} maxLength={120} onChange={(e) => setNovo({ ...novo, pontoTuristico: e.target.value })} /></div>
            <div className="campo"><label htmlFor="bm-n-temp">Temporada</label><input id="bm-n-temp" list="bm-temporadas" value={novo.temporada} maxLength={60} placeholder="Verão 2027" onChange={(e) => setNovo({ ...novo, temporada: e.target.value })} /></div>
            <div className="campo"><label htmlFor="bm-arquivo">Arquivos</label><input id="bm-arquivo" ref={entrada} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" disabled={enviando} onChange={(e) => void enviar(e.target.files)} /></div>
          </div>
          <datalist id="bm-passeios">{lista.dados?.etiquetas.passeios.map((x) => <option key={x} value={x} />)}</datalist>
          <datalist id="bm-pontos">{lista.dados?.etiquetas.pontosTuristicos.map((x) => <option key={x} value={x} />)}</datalist>
          <datalist id="bm-temporadas">{lista.dados?.etiquetas.temporadas.map((x) => <option key={x} value={x} />)}</datalist>
          <p className="campo__ajuda">As etiquetas acima valem para os arquivos que você enviar agora. Imagens até 8 MB e vídeos até 100 MB. Para o Instagram, só JPEG e MP4; os outros formatos ficam guardados para outras redes.</p>
        </section>
      )}
      <Filtros dados={lista.dados} valor={f} aoMudar={setF} />
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro && !lista.dados ? <ErroCarga mensagem={lista.erro} tentarDeNovo={lista.recarregar} /> : itens.length === 0 ? (
        <Vazio titulo="Nenhuma mídia encontrada.">{podeGerenciar ? "Envie as primeiras fotos e vídeos acima." : undefined}</Vazio>
      ) : (
        <ul className="banco__grade">
          {itens.map((i) => (
            <li key={i.id} className="banco__item">
              <Miniatura item={i} />
              <strong className="banco__nome" title={i.nome}>{i.nome}</strong>
              <span className="texto-fraco">{i.uso === "VIDEO" ? "Vídeo" : "Imagem"} · {tamanhoLegivel(i.tamanho)}{!publicavelNoInstagram(i.tipo) && " · não serve ao Instagram"}</span>
              <Etiquetas i={i} />
              {podeGerenciar && (
                <span className="banco__acoes">
                  <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setEditar(i)}>Etiquetas</button>
                  <button type="button" className="botao botao--fantasma botao--pequeno" onClick={() => setExcluir(i)}><Icone nome="x" tamanho={14} /> Excluir</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal aberto={!!editar} titulo="Etiquetas da mídia" aoFechar={() => setEditar(null)}>
        {editar && (
          <form onSubmit={(e) => { e.preventDefault(); void salvarEdicao(); }}>
            <Aviso tipo="info">{editar.nome}</Aviso>
            <div className="campo"><label htmlFor="be-passeio">Passeio</label><input id="be-passeio" value={editar.passeio ?? ""} maxLength={120} onChange={(e) => setEditar({ ...editar, passeio: e.target.value || null })} /></div>
            <div className="campo"><label htmlFor="be-ponto">Ponto turístico</label><input id="be-ponto" value={editar.pontoTuristico ?? ""} maxLength={120} onChange={(e) => setEditar({ ...editar, pontoTuristico: e.target.value || null })} /></div>
            <div className="campo"><label htmlFor="be-temp">Temporada</label><input id="be-temp" value={editar.temporada ?? ""} maxLength={60} onChange={(e) => setEditar({ ...editar, temporada: e.target.value || null })} /></div>
            <div className="modal__acoes"><button type="button" className="botao botao--secundario" onClick={() => setEditar(null)}>Cancelar</button><button type="submit" className="botao botao--primario">Salvar</button></div>
          </form>
        )}
      </Modal>
      <Confirmar aberto={!!excluir} titulo="Excluir mídia" perigo textoConfirmar="Excluir" aoFechar={() => setExcluir(null)} aoConfirmar={() => void confirmarExclusao()} mensagem={<>Excluir <strong>{excluir?.nome}</strong> do banco? Os posts que já usam essa mídia mantêm a própria cópia.</>} />
    </div>
  );
}
