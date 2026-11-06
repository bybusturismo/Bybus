import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

const DEMO = import.meta.env.VITE_DEMO === "1";

/**
 * Botão "Ver página pública": abre a página pública aqui mesmo (pré-visualização, sem sair do sistema).
 * Fora da demonstração também oferece o endereço real para abrir em outra aba.
 */
export function VerPublica({ titulo, caminho, children, rotulo = "Ver página pública" }: { titulo: string; caminho?: string; children: ReactNode; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className="botao botao--secundario" onClick={() => setAberto(true)}>{rotulo}</button>
      <Modal aberto={aberto} titulo={titulo} aoFechar={() => setAberto(false)} largura="larga">
        {aberto && children}
        {!DEMO && caminho && <p className="texto-fraco"><a href={caminho} target="_blank" rel="noopener noreferrer">Abrir em outra aba ({caminho})</a></p>}
      </Modal>
    </>
  );
}
