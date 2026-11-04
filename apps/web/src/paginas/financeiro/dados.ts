import { api } from "../../api/cliente";
import { useCarregar } from "../../util/useCarregar";
import type { CategoriaFin, ContaFin } from "./tipos";

/** Contas financeiras visíveis ao usuário (já filtradas por praça no servidor). */
export function useContas() {
  return useCarregar((s) => api.get<ContaFin[]>("/api/financeiro/contas", s), []);
}

export function useCategorias() {
  return useCarregar((s) => api.get<CategoriaFin[]>("/api/financeiro/categorias", s), []);
}
