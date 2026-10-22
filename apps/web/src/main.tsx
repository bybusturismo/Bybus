import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { aplicarTema } from "./componentes/Tema";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/telas.css";
import "./estilos/impressao.css";

aplicarTema();

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
