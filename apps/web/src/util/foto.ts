/** Reduz a foto no navegador (quadrado de 256 px, JPEG) antes de enviar: arquivo pequeno e sem metadados (GPS etc.). */
export async function reduzirFoto(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const tela = document.createElement("canvas");
  tela.width = tela.height = 256;
  tela.getContext("2d")!.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  return tela.toDataURL("image/jpeg", 0.85);
}

/** Arquivo → base64 puro (sem o prefixo data:), para anexos. */
export function lerBase64(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => falha(r.error);
    r.readAsDataURL(arquivo);
  });
}

/**
 * Foto de documento (cupom de combustível, 18/11/2026): mantém legível, só reduz se for grande (lado maior até 2000 px, JPEG 85%)
 * para caber no limite da leitura automática. PDF e o que o navegador não conseguir abrir vão como estão.
 */
export async function prepararFotoDocumento(arquivo: File): Promise<{ nome: string; base64: string }> {
  if (!arquivo.type.startsWith("image/") || arquivo.size < 1_500_000) return { nome: arquivo.name, base64: await lerBase64(arquivo) };
  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(bitmap.width * escala);
    tela.height = Math.round(bitmap.height * escala);
    tela.getContext("2d")!.drawImage(bitmap, 0, 0, tela.width, tela.height);
    return { nome: arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", base64: tela.toDataURL("image/jpeg", 0.85).replace(/^data:[^,]*,/, "") };
  } catch {
    return { nome: arquivo.name, base64: await lerBase64(arquivo) };
  }
}
