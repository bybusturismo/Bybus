import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { aplicarTema } from "./componentes/Tema";
import "./estilos/fontes.css";
import "./estilos/tokens.css";
import "./estilos/base.css";
import "./estilos/telas.css";
import "./estilos/rastreio.css";
import "./estilos/padrao.css";
import "./estilos/impressao.css";
import "./estilos/marketing2.css";
import "./estilos/demo.css";
import "./estilos/limpo.css";

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

// Proposta de layout limpo (20/11/2026, em validação): ?layout=limpo liga e ?layout=padrao desliga; a escolha fica neste navegador.
try {
  const pedido = new URLSearchParams(location.search).get("layout");
  if (pedido === "limpo" || pedido === "padrao") localStorage.setItem("bybus.layout", pedido);
  if (localStorage.getItem("bybus.layout") === "limpo") document.documentElement.setAttribute("data-layout", "limpo");
} catch { /* sem armazenamento: fica o padrão */ }

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
