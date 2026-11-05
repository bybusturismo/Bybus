import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ACEITA_IMAGEM } from "./anexos";
import { doEditor, htmlDaPagina } from "./htmlSeguro";

/**
 * Editor visual das páginas, sem pacote de editor: usa a edição do próprio navegador (contentEditable + execCommand).
 * Guarda HTML; tudo o que entra e sai passa pelo DOMPurify (mesmas listas do servidor).
 */
export interface EditorRicoRef {
  /** Insere HTML (já limpo pelo servidor ou gerado pelo próprio editor) onde está o cursor, ou no fim do texto. */
  inserir: (html: string) => void;
  html: () => string;
}

interface Props {
  conteudo: string;
  salvando: boolean;
  aoSalvar: (conteudoGuardar: string) => void;
  aoCancelar: () => void;
  /** Envia uma imagem para a página e devolve o endereço dela. */
  aoEnviarImagem: (arquivo: File) => Promise<string | null>;
}

const BLOCOS: Array<[string, string]> = [["p", "Texto"], ["h1", "Título 1"], ["h2", "Título 2"], ["h3", "Título 3"], ["blockquote", "Citação"]];
const CORES: Array<[string, string]> = [["#231f20", "Preto"], ["#e7791e", "Laranja"], ["#db2e53", "Rosa"], ["#009b44", "Verde"], ["#007ac8", "Azul"], ["#4a4395", "Violeta"], ["#5a5354", "Cinza"]];

export const EditorRico = forwardRef<EditorRicoRef, Props>(function EditorRico({ conteudo, salvando, aoSalvar, aoCancelar, aoEnviarImagem }, ref) {
  const area = useRef<HTMLDivElement>(null);
  const [naTabela, setNaTabela] = useState(false);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.innerHTML = htmlDaPagina(conteudo) || "<p><br></p>";
    el.focus();
    const sel = window.getSelection();
    if (sel && el.childNodes.length) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    // só ao abrir o editor: trocar `conteudo` no meio da edição apagaria o que a pessoa digitou
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a barra de tabela aparece quando o cursor está dentro de uma
  useEffect(() => {
    const ver = () => {
      const n = window.getSelection()?.anchorNode;
      const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
      setNaTabela(!!(el && area.current?.contains(el) && el.closest("table")));
    };
    document.addEventListener("selectionchange", ver);
    return () => document.removeEventListener("selectionchange", ver);
  }, []);

  const cmd = (nome: string, valor?: string, css = false) => {
    area.current?.focus();
    if (css) document.execCommand("styleWithCSS", false, "true");
    document.execCommand(nome, false, valor);
    if (css) document.execCommand("styleWithCSS", false, "false");
  };
  const inserir = (html: string) => {
    const el = area.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    document.execCommand("insertHTML", false, html);
  };
  useImperativeHandle(ref, () => ({ inserir, html: () => area.current?.innerHTML ?? "" }));

  const salvar = () => aoSalvar(doEditor(area.current?.innerHTML ?? ""));

  const link = () => {
    const u = window.prompt("Endereço do link (https://…):", "https://");
    if (u && u !== "https://") cmd("createLink", u);
  };
  const tabela = () => {
    const m = window.prompt("Tamanho da tabela (linhas x colunas):", "3x3")?.match(/(\d+)\s*[x×*]\s*(\d+)/i);
    if (!m) return;
    const lin = Math.min(Number(m[1]) || 3, 50);
    const col = Math.min(Number(m[2]) || 3, 12);
    const cel = (t: string) => Array.from({ length: col }, () => `<${t}><br></${t}>`).join("");
    inserir(`<table><thead><tr>${cel("th")}</tr></thead><tbody>${Array.from({ length: Math.max(1, lin - 1) }, () => `<tr>${cel("td")}</tr>`).join("")}</tbody></table><p><br></p>`);
  };
  const celula = () => {
    const n = window.getSelection()?.anchorNode;
    return ((n?.nodeType === 1 ? (n as Element) : n?.parentElement) ?? null)?.closest("td, th") ?? null;
  };
  const mexerTabela = (acao: "linha" | "coluna" | "sem-linha" | "sem-coluna" | "apagar") => {
    const c = celula();
    if (!c) return;
    const tr = c.parentElement as HTMLTableRowElement;
    const tab = c.closest("table") as HTMLTableElement;
    const i = Array.from(tr.children).indexOf(c);
    const vazia = (tag: string) => {
      const x = document.createElement(tag);
      x.innerHTML = "<br>";
      return x;
    };
    if (acao === "linha") {
      const nova = tr.cloneNode(true) as HTMLTableRowElement;
      Array.from(nova.children).forEach((x) => x.replaceWith(vazia("td")));
      if (tr.parentElement?.tagName === "THEAD") (tab.tBodies[0] ?? tab).prepend(nova);
      else tr.after(nova);
    }
    if (acao === "coluna") tab.querySelectorAll("tr").forEach((r) => { const ref = r.children[i]; const x = vazia(ref?.tagName === "TH" ? "th" : "td"); if (ref) ref.after(x); else r.appendChild(x); });
    if (acao === "sem-linha") { if (tab.querySelectorAll("tr").length > 1) tr.remove(); else tab.remove(); }
    if (acao === "sem-coluna") { if (tr.children.length > 1) tab.querySelectorAll("tr").forEach((r) => r.children[i]?.remove()); else tab.remove(); }
    if (acao === "apagar" && window.confirm("Apagar a tabela inteira?")) tab.remove();
    area.current?.focus();
  };
  const imagem = async (f: File) => {
    const src = await aoEnviarImagem(f);
    if (src) inserir(`<img src="${src}" alt="${f.name.replace(/[^\w .-]/g, "")}">`);
  };

  const B = ({ t, on, children }: { t: string; on: () => void; children: ReactNode }) => (
    <button type="button" className="editor__botao" title={t} aria-label={t} onMouseDown={(e) => e.preventDefault()} onClick={on}>{children}</button>
  );
  const sep = <span className="editor__sep" aria-hidden="true" />;

  return (
    <section className="editor" aria-label="Editor da página">
      <div className="editor__barra" role="toolbar" aria-label="Formatação">
        <B t="Desfazer (Ctrl+Z)" on={() => cmd("undo")}>↶</B>
        <B t="Refazer (Ctrl+Y)" on={() => cmd("redo")}>↷</B>
        {sep}
        <select className="editor__select" value="" aria-label="Estilo do parágrafo" onChange={(e) => e.target.value && cmd("formatBlock", e.target.value)}>
          <option value="" disabled>Estilo</option>
          {BLOCOS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </select>
        {sep}
        <B t="Negrito (Ctrl+B)" on={() => cmd("bold")}><b>B</b></B>
        <B t="Itálico (Ctrl+I)" on={() => cmd("italic")}><i>I</i></B>
        <B t="Sublinhado (Ctrl+U)" on={() => cmd("underline")}><u>U</u></B>
        <B t="Tachado" on={() => cmd("strikeThrough")}><s>S</s></B>
        <select className="editor__select" value="" aria-label="Cor do texto" onChange={(e) => e.target.value && cmd("foreColor", e.target.value, true)}>
          <option value="" disabled>Cor</option>
          {CORES.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
        </select>
        {sep}
        <B t="Lista com marcadores" on={() => cmd("insertUnorderedList")}>• Lista</B>
        <B t="Lista numerada" on={() => cmd("insertOrderedList")}>1. Lista</B>
        <B t="Alinhar à esquerda" on={() => cmd("justifyLeft")}>⯇</B>
        <B t="Centralizar" on={() => cmd("justifyCenter")}>≡</B>
        <B t="Alinhar à direita" on={() => cmd("justifyRight")}>⯈</B>
        {sep}
        <B t="Link" on={link}>Link</B>
        <label className="editor__botao" title="Imagem" onMouseDown={(e) => e.preventDefault()}>
          Imagem
          <input type="file" accept={ACEITA_IMAGEM} className="visualmente-oculto" aria-label="Inserir imagem" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void imagem(f); }} />
        </label>
        <B t="Tabela" on={tabela}>Tabela</B>
        <B t="Linha horizontal" on={() => cmd("insertHorizontalRule")}>―</B>
        <B t="Quebra de página (no PDF, o que vem depois começa numa página nova)" on={() => inserir('<hr class="quebra-pagina"><p><br></p>')}>Quebra de página</B>
        <B t="Limpar formatação" on={() => cmd("removeFormat")}>Limpar</B>
      </div>
      {naTabela && (
        <div className="editor__tabela" role="toolbar" aria-label="Tabela" onMouseDown={(e) => e.preventDefault()}>
          <strong>Tabela:</strong>
          <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => mexerTabela("linha")}>+ linha</button>
          <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => mexerTabela("coluna")}>+ coluna</button>
          <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => mexerTabela("sem-linha")}>− linha</button>
          <button type="button" className="botao botao--pequeno botao--secundario" onClick={() => mexerTabela("sem-coluna")}>− coluna</button>
          <button type="button" className="botao botao--pequeno botao--fantasma" onClick={() => mexerTabela("apagar")}>Apagar tabela</button>
        </div>
      )}
      <div
        ref={area}
        className="md editor__area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Texto da página"
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
          const k = e.key.toLowerCase();
          if (k === "s") { e.preventDefault(); salvar(); }
          else if (k === "b" || k === "i" || k === "u") { e.preventDefault(); cmd({ b: "bold", i: "italic", u: "underline" }[k]!); }
        }}
      />
      <div className="editor__rodape">
        <button type="button" className="botao botao--primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</button>
        <button type="button" className="botao botao--secundario" onClick={aoCancelar}>Cancelar</button>
        <span className="texto-fraco">Ctrl/⌘ + S salva · B negrito · I itálico · U sublinhado</span>
      </div>
    </section>
  );
});
