import type { ReactNode } from "react";

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="estado estado--carregando" role="status" aria-live="polite">
      <span className="girador" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="estado estado--vazio">
      <p className="estado__titulo">{titulo}</p>
      {children && <div className="estado__texto">{children}</div>}
    </div>
  );
}

export function ErroCarga({ mensagem, tentarDeNovo }: { mensagem: string; tentarDeNovo?: () => void }) {
  return (
    <div className="estado estado--erro" role="alert">
      <p className="estado__titulo">Não foi possível carregar.</p>
      <p className="estado__texto">{mensagem}</p>
      {tentarDeNovo && (
        <button type="button" className="botao botao--secundario" onClick={tentarDeNovo}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

type TipoAviso = "erro" | "sucesso" | "atencao" | "info";

/** Caixa de mensagem dentro de formulários. Erros são anunciados a leitores de tela (role=alert). */
export function Aviso({ tipo = "info", children, titulo }: { tipo?: TipoAviso; titulo?: string; children: ReactNode }) {
  return (
    <div className={`aviso aviso--${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      {titulo && <strong className="aviso__titulo">{titulo}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function SemAcesso() {
  return (
    <div className="estado estado--erro" role="alert">
      <p className="estado__titulo">Sem acesso</p>
      <p className="estado__texto">Seu perfil não tem acesso a esta tela. Fale com o administrador se precisar.</p>
    </div>
  );
}
