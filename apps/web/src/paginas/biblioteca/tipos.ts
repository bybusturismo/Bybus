export type Acesso = "EQUIPE" | "RESTRITO";

export interface Meta {
  id: string;
  paiId: string | null;
  titulo: string;
  icone: string | null;
  acesso: Acesso;
  acessoEfetivo: Acesso;
  ordem: number;
  atualizadoEm: string;
  podeEditar: boolean;
}
export interface Lista {
  podeEditar: boolean;
  paginas: Meta[];
}
export interface Anexo {
  id: string;
  nome: string;
  tipo: string;
  uso: "IMAGEM" | "VIDEO" | "ARQUIVO";
  tamanho: number;
}
export interface Pagina {
  id: string;
  paiId: string | null;
  titulo: string;
  icone: string | null;
  conteudo: string;
  formato: "html" | "markdown";
  acesso: Acesso;
  acessoEfetivo: Acesso;
  atualizadoEm: string;
  criadoEm: string;
  autor: string | null;
  atualizadoPor: string | null;
  colaboradores: string[];
  podeEditar: boolean;
  podeGerenciarAcesso: boolean;
  caminho: Array<{ id: string; titulo: string; icone: string | null }>;
  subpaginas: Array<{ id: string; titulo: string; icone: string | null; proprietario: string | null; colaboradores: string[] }>;
  anexos: Anexo[];
}
export interface Achado {
  id: string;
  titulo: string;
  noTitulo: boolean;
  trecho: string;
  caminho: string[];
}
export interface ItemLixeira {
  id: string;
  titulo: string;
  icone: string | null;
  excluidaEm: string;
  paginas: number;
}
