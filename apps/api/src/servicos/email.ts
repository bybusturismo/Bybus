import nodemailer from "nodemailer";
import type { Config } from "../config.js";

/** E-mail de saída configurado? (Gmail com senha de app, ou outro SMTP.) */
export const emailConfigurado = (c: Config) => !!c.EMAIL_USUARIO && !!c.EMAIL_SENHA;

/** Só no ambiente de testes: o que "sairia" (para os testes conferirem o link). */
export const emailsDeTeste: Array<{ para: string; assunto: string; texto: string }> = [];

export type EnviarEmail = (m: { para: string; assunto: string; texto: string }) => Promise<void>;

/**
 * Envia um e-mail de texto simples. No ambiente de testes nada sai (fica só o registro de que "sairia").
 * Nunca registra o conteúdo nem o destinatário.
 */
export function criarEnvioEmail(c: Config): EnviarEmail {
  return async (m) => {
    if (!emailConfigurado(c)) throw new Error("EMAIL_NAO_CONFIGURADO");
    if (c.AMBIENTE === "testes") { emailsDeTeste.push(m); return; }
    const t = nodemailer.createTransport({ host: c.EMAIL_SMTP_HOST, port: c.EMAIL_SMTP_PORTA, secure: c.EMAIL_SMTP_PORTA === 465, auth: { user: c.EMAIL_USUARIO, pass: c.EMAIL_SENHA } });
    await t.sendMail({ from: `"${c.EMAIL_REMETENTE_NOME}" <${c.EMAIL_USUARIO}>`, to: m.para, subject: m.assunto, text: m.texto });
  };
}
