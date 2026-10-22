import { hash, verify } from "@node-rs/argon2";

// Parâmetros recomendados pela OWASP para Argon2id.
const OPCOES = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, OPCOES);
}

export async function conferirSenha(hashGuardado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha);
  } catch {
    return false;
  }
}

let hashFalso: Promise<string> | null = null;
/** Hash real de uma senha aleatória, para gastar o mesmo tempo quando o e-mail não existe (evita descobrir usuários). */
export function obterHashFalso(): Promise<string> {
  hashFalso ??= hash(crypto.randomUUID(), OPCOES);
  return hashFalso;
}

/** Política: mínimo 10 caracteres, com letras e números. Retorna a mensagem de erro ou null. */
export function validarPoliticaSenha(senha: string): string | null {
  if (senha.length < 10) return "A senha deve ter pelo menos 10 caracteres.";
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return "A senha deve ter letras e números.";
  if (senha.length > 200) return "Senha muito longa.";
  return null;
}
