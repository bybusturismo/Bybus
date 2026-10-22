import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Notificacao {
  id: number;
  texto: string;
  tipo: "sucesso" | "erro";
}

const Contexto = createContext<(texto: string, tipo?: Notificacao["tipo"]) => void>(() => {});

/** Mensagens rápidas ("Reserva salva.") anunciadas por leitores de tela. */
export function ProvedorNotificacoes({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Notificacao[]>([]);
  const notificar = useCallback((texto: string, tipo: Notificacao["tipo"] = "sucesso") => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-2), { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((n) => n.id !== id)), tipo === "erro" ? 8000 : 4000);
  }, []);
  return (
    <Contexto.Provider value={notificar}>
      {children}
      <div className="notificacoes" aria-live="polite" aria-atomic="false">
        {lista.map((n) => (
          <div key={n.id} className={`notificacao notificacao--${n.tipo}`} role={n.tipo === "erro" ? "alert" : "status"}>
            {n.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  );
}

export function useNotificar() {
  return useContext(Contexto);
}
