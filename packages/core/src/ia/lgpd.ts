/**
 * Trava de LGPD: tudo que vai para o modelo de IA deve ser agregado. Esta verificação é uma segunda barreira
 * (as funções de retrato já só devolvem números): barra textos que pareçam e-mail, telefone ou CPF/CNPJ
 * e chaves que sugiram dado pessoal.
 */
const PADROES: Array<[string, RegExp]> = [
  ["e-mail", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["CPF", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/],
  ["CNPJ", /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/],
  ["telefone", /(?:\+55\s?)?\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b|\b\d{2}\s?9\d{4}[-\s]?\d{4}\b/],
];

const CHAVES_PROIBIDAS = /^(nome|email|e_mail|telefone|celular|cpf|cnpj|documento|passaporte|rg|endereco|contato|senha|token)/i;

/** Lista (sem repetição) os problemas achados: "caminho: motivo". Vazia = seguro. */
export function acharDadoPessoal(valor: unknown, caminho = "retrato"): string[] {
  const achados: string[] = [];
  const visitar = (v: unknown, c: string) => {
    if (typeof v === "string") {
      for (const [rotulo, re] of PADROES) if (re.test(v)) achados.push(`${c}: parece ${rotulo}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visitar(x, `${c}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (CHAVES_PROIBIDAS.test(k)) achados.push(`${c}.${k}: chave sugere dado pessoal`);
        visitar(x, `${c}.${k}`);
      }
    }
  };
  visitar(valor, caminho);
  return [...new Set(achados)];
}

export function garantirAgregado(valor: unknown, caminho = "retrato"): void {
  const a = acharDadoPessoal(valor, caminho);
  if (a.length) throw new Error(`Dado possivelmente pessoal bloqueado antes de ir à IA — ${a.slice(0, 5).join("; ")}`);
}
