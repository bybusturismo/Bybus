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
