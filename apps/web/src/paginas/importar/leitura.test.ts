import { describe, expect, it } from "vitest";
import { decodificarCsv, separarEmails } from "./leitura";

describe("importação: leitura no navegador", () => {
  it("separa e-mails por linha ----- e usa a primeira linha como assunto", () => {
    const r = separarEmails("New booking: A\n| Booking ref. | X |\n-----\n| Booking ref. | Y |\n\n------\nCancelled booking: Z\n| Date | d |\n");
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ assunto: "New booking: A", corpo: "| Booking ref. | X |" });
    expect(r[1]!.assunto).toBe("");
    expect(r[1]!.corpo).toContain("Booking ref.");
    expect(r[2]!.assunto).toBe("Cancelled booking: Z");
  });

  it("ignora blocos vazios", () => {
    expect(separarEmails("\n-----\n   \n-----\n")).toEqual([]);
  });

  it("decodifica UTF-8 e cai para ISO-8859-1 quando há caracteres quebrados", () => {
    const utf8 = new TextEncoder().encode("﻿Código;Observações").buffer as ArrayBuffer;
    expect(decodificarCsv(utf8)).toEqual({ texto: "Código;Observações", codificacao: "UTF-8" });
    const latin1 = new Uint8Array([0x43, 0xf3, 0x64, 0x69, 0x67, 0x6f]).buffer; // "Código" em ISO-8859-1
    expect(decodificarCsv(latin1)).toEqual({ texto: "Código", codificacao: "ISO-8859-1" });
  });
});
