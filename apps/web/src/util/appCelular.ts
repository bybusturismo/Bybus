/**
 * Recursos do app By Bus (Android, casca Capacitor que abre o sistema): o app injeta `window.Capacitor` com os plugins nativos.
 * No navegador comum nada disso existe e o sistema segue como sempre.
 */

interface PluginsNativos {
  BackgroundGeolocation?: {
    addWatcher: (
      opcoes: { backgroundTitle?: string; backgroundMessage?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
      callback: (l?: LocalizacaoNativa, e?: { code?: string; message?: string }) => void,
    ) => Promise<string>;
    removeWatcher: (o: { id: string }) => Promise<void>;
    openSettings: () => Promise<void>;
  };
  /** Plugin próprio do app (MainActivity): abre a tela "Imprimir" do Android com a página atual. */
  Impressao?: { imprimir: (o: { titulo: string }) => Promise<void> };
  CapacitorHttp?: {
    request: (o: { url: string; method: string; headers?: Record<string, string>; data?: unknown; responseType?: string }) => Promise<{ status: number; data: unknown }>;
  };
}

export interface LocalizacaoNativa {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  bearing: number | null;
  time: number | null;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: PluginsNativos;
}

function capacitor(): CapacitorGlobal | null {
  const c = (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return c && typeof c.isNativePlatform === "function" && c.isNativePlatform() ? c : null;
}

/** Está dentro do app By Bus (e não no navegador)? */
export const noApp = () => capacitor() !== null;

/** GPS em segundo plano do app (continua com a tela apagada ou outro app aberto). */
export const gpsDoApp = () => capacitor()?.Plugins?.BackgroundGeolocation ?? null;

/**
 * POST pelo HTTP nativo do app: no Android, pedidos feitos pela página ficam lentos depois de alguns minutos em segundo
 * plano; o nativo não. Usa os mesmos cookies de sessão da página. Devolve null fora do app (use o fetch comum).
 */
export async function postarPeloApp(url: string, corpo: unknown): Promise<{ status: number; data: unknown } | null> {
  const http = capacitor()?.Plugins?.CapacitorHttp;
  if (!http) return null;
  const absoluta = new URL(url, window.location.origin).toString();
  return http.request({ url: absoluta, method: "POST", headers: { "Content-Type": "application/json", "X-Bybus": "1" }, data: corpo, responseType: "json" });
}

/**
 * Imprime a página atual. No app By Bus usa a impressão do Android (o window.print() do navegador não funciona dentro do
 * app); no navegador comum, o window.print() de sempre. Devolve uma mensagem de erro, ou null se abriu a impressão.
 */
export async function imprimirPagina(titulo: string): Promise<string | null> {
  const c = capacitor();
  if (c) {
    const plugin = c.Plugins?.Impressao;
    if (!plugin) return "Para imprimir pelo app, atualize o app By Bus (baixe a versão nova no link de instalação).";
    window.dispatchEvent(new Event("beforeprint"));
    try {
      await plugin.imprimir({ titulo });
      return null;
    } catch {
      return "Não foi possível abrir a impressão do celular. Tente de novo.";
    }
  }
  window.print();
  return null;
}
