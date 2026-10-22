import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: "normal" | "larga";
}

/**
 * Diálogo modal acessível baseado em <dialog> (foco preso pelo navegador, Esc fecha).
 * Devolve o foco ao elemento que abriu o diálogo.
 */
export function Modal({ aberto, titulo, aoFechar, children, rodape, largura = "normal" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const anterior = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      anterior.current = document.activeElement;
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!aberto && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
      (anterior.current as HTMLElement | null)?.focus?.();
    }
  }, [aberto]);

  if (!aberto) return <dialog ref={ref} className="modal" hidden />;

  return (
    <dialog
      ref={ref}
      className={`modal modal--${largura}`}
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        e.preventDefault();
        aoFechar();
      }}
    >
      <div className="modal__cabecalho">
        <h2 id={idTitulo} className="modal__titulo">
          {titulo}
        </h2>
        <button type="button" className="botao botao--icone" onClick={aoFechar} aria-label="Fechar">
          ×
        </button>
      </div>
      <div className="modal__corpo">{children}</div>
      {rodape && <div className="modal__rodape">{rodape}</div>}
    </dialog>
  );
}

/** Confirmação simples (substitui window.confirm, com texto claro e botão de ação nomeado). */
export function Confirmar({
  aberto,
  titulo,
  mensagem,
  textoConfirmar,
  perigo,
  ocupado,
  aoConfirmar,
  aoFechar,
}: {
  aberto: boolean;
  titulo: string;
  mensagem: ReactNode;
  textoConfirmar: string;
  perigo?: boolean;
  ocupado?: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}) {
  return (
    <Modal
      aberto={aberto}
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao botao--secundario" onClick={aoFechar}>
            Voltar
          </button>
          <button type="button" className={`botao ${perigo ? "botao--perigo" : "botao--primario"}`} onClick={aoConfirmar} disabled={ocupado}>
            {ocupado ? "Aguarde…" : textoConfirmar}
          </button>
        </>
      }
    >
      <div>{mensagem}</div>
    </Modal>
  );
}
