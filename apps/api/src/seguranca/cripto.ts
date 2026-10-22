import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Criptografia simétrica AES-256-GCM. Formato: base64(iv[12] | tag[16] | dados). */
export class Cofre {
  private readonly chave: Buffer;

  constructor(chaveBase64: string) {
    this.chave = Buffer.from(chaveBase64, "base64");
    if (this.chave.length !== 32) throw new Error("Chave de criptografia deve ter 32 bytes.");
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.chave, iv);
    const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), dados]).toString("base64");
  }

  decifrar(cifrado: string): string {
    const b = Buffer.from(cifrado, "base64");
    const d = createDecipheriv("aes-256-gcm", this.chave, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  }
}

export function gerarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(texto: string): string {
  return createHash("sha256").update(texto).digest("hex");
}
