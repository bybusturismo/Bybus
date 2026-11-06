import { createHash } from "node:crypto";
/** Hash para comparar segredos em tempo constante (timingSafeEqual exige o mesmo tamanho). */
export const hash = (v: string) => createHash("sha256").update(v).digest();
