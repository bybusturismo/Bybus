import { describe, expect, it } from "vitest";
import { gerarCsv } from "./csv";

describe("CSV", () => {
  it("usa ; com BOM, aspas quando preciso e neutraliza fórmulas", () => {
    const csv = gerarCsv(["Nome", "Obs"], [["Ana; Silva", '=1+1'], ["Bia", null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["Nome;Obs", '"Ana; Silva";\'=1+1', "Bia;"]);
  });
});
