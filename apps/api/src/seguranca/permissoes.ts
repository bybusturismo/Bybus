import type { Perfil } from "../db/schema.js";

export const PERMISSOES = [
  "usuarios:gerenciar",
  "auditoria:ver",
  "pontos:gerenciar",
  "saidas:gerenciar",
  "saidas:decidir",
  "reservas:editar",
  "importacoes:executar",
  "manifesto:ver",
  "manifesto:documentos",
  "manifesto:contatos",
  "embarque:registrar",
] as const;
export type Permissao = (typeof PERMISSOES)[number];

/**
 * Matriz de acesso (menor privilégio).
 * Documento completo só para ADMIN e SUPERVISOR, sempre registrado em auditoria.
 */
export const MATRIZ: Record<Perfil, readonly Permissao[]> = {
  ADMIN: PERMISSOES,
  SUPERVISOR: [
    "auditoria:ver", "pontos:gerenciar", "saidas:gerenciar", "saidas:decidir", "reservas:editar", "importacoes:executar",
    "manifesto:ver", "manifesto:documentos", "manifesto:contatos", "embarque:registrar",
  ],
  ATENDENTE: ["saidas:gerenciar", "reservas:editar", "importacoes:executar", "manifesto:ver", "manifesto:contatos"],
  GUIA: ["manifesto:ver", "manifesto:contatos", "embarque:registrar"],
  MOTORISTA: ["manifesto:ver"],
};

export function pode(perfil: Perfil, permissao: Permissao): boolean {
  return MATRIZ[perfil].includes(permissao);
}

export const PERFIS_COM_MFA_OBRIGATORIO: readonly Perfil[] = ["ADMIN", "SUPERVISOR"];
