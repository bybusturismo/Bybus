/**
 * Cliente HTTP do Bybus Gestão.
 * - Toda requisição que não é GET envia "X-Bybus: 1" (proteção CSRF exigida pela API).
 * - Cookies de sessão só na mesma origem (credentials "same-origin").
 * - Erros da API viram ErroApi com status, código e mensagem em português.
 */

export interface DetalheErro {
  campo: string;
  mensagem: string;
}

export class ErroApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public detalhes: DetalheErro[] = [],
  ) {
    super(mensagem);
    this.name = "ErroApi";
  }
}

type Ouvinte = (erro: ErroApi) => void;
const ouvintes = new Set<Ouvinte>();

/** Avisa a sessão quando a API diz que o login expirou ou que há pendência (troca de senha/MFA). */
export function aoErroDeSessao(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

const MENSAGENS_PADRAO: Record<number, string> = {
  400: "Dados inválidos. Revise os campos.",
  401: "Faça login para continuar.",
  403: "Seu perfil não tem acesso a esta função.",
  404: "Registro não encontrado.",
  409: "Conflito: o registro já existe ou foi alterado.",
  423: "Usuário bloqueado temporariamente. Tente novamente em alguns minutos.",
  429: "Muitas tentativas. Aguarde um minuto e tente de novo.",
  500: "Erro interno. Tente novamente.",
};

export interface OpcoesRequisicao {
  metodo?: "GET" | "POST" | "PATCH" | "DELETE";
  corpo?: unknown;
  sinal?: AbortSignal;
  /** Não notificar a sessão em 401 (usado no login e no /eu inicial). */
  semAvisoSessao?: boolean;
}

export async function requisitar<T>(caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
  const metodo = opcoes.metodo ?? "GET";
  const cabecalhos: Record<string, string> = { Accept: "application/json" };
  if (metodo !== "GET") cabecalhos["X-Bybus"] = "1";
  if (opcoes.corpo !== undefined) cabecalhos["Content-Type"] = "application/json";

  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      method: metodo,
      headers: cabecalhos,
      credentials: "same-origin",
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: opcoes.sinal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ErroApi(0, "SEM_CONEXAO", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }

  const tipo = resposta.headers.get("Content-Type") ?? "";
  const dados: unknown = tipo.includes("application/json") ? await resposta.json().catch(() => null) : await resposta.text().catch(() => null);

  if (!resposta.ok) {
    const d = (dados && typeof dados === "object" ? dados : {}) as { codigo?: string; mensagem?: string; detalhes?: DetalheErro[] };
    const erro = new ErroApi(
      resposta.status,
      d.codigo ?? `HTTP_${resposta.status}`,
      d.mensagem ?? MENSAGENS_PADRAO[resposta.status] ?? `Erro ${resposta.status}.`,
      d.detalhes ?? [],
    );
    const erroDeSessao =
      (erro.status === 401 && erro.codigo === "NAO_AUTENTICADO") ||
      (erro.status === 403 && (erro.codigo === "TROCAR_SENHA" || erro.codigo === "CONFIGURAR_MFA"));
    if (erroDeSessao && !opcoes.semAvisoSessao) ouvintes.forEach((fn) => fn(erro));
    throw erro;
  }
  return dados as T;
}

export const api = {
  get: <T>(caminho: string, sinal?: AbortSignal) => requisitar<T>(caminho, { sinal }),
  post: <T>(caminho: string, corpo?: unknown) => requisitar<T>(caminho, { metodo: "POST", corpo: corpo ?? {} }),
  patch: <T>(caminho: string, corpo: unknown) => requisitar<T>(caminho, { metodo: "PATCH", corpo }),
  delete: <T>(caminho: string) => requisitar<T>(caminho, { metodo: "DELETE" }),
};

/** Mensagem amigável para qualquer erro (inclui os detalhes de validação do servidor). */
export function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroApi) {
    if (e.detalhes.length) return `${e.message} ${e.detalhes.map((d) => (d.campo ? `${d.campo}: ${d.mensagem}` : d.mensagem)).join("; ")}`;
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Erro inesperado.";
}

/** Monta query string ignorando valores vazios. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
