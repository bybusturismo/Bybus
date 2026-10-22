import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { aplicarTema } from "./componentes/Tema";
import "./estilos/fontes.css";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/telas.css";
import "./estilos/impressao.css";
import "./estilos/demo.css";

// Modo demonstração: API simulada no navegador (dados fictícios).
if (import.meta.env.VITE_DEMO === "1") {
  await import("./demo/apiFalsa");
  const aviso = document.createElement("div");
  aviso.className = "demo-aviso";
  aviso.setAttribute("role", "note");
  aviso.innerHTML = "<strong>Demonstração com dados fictícios.</strong> Entre com <code>admin@bybus.test</code> (ou supervisor@, atendente@, guia@, motorista@bybus.test) e a senha <code>Bybus-teste-2026</code>. Nada é salvo: ao recarregar, tudo volta ao início.";
  document.body.insertBefore(aviso, document.getElementById("raiz"));
}

aplicarTema();

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
