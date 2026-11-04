import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { PropsMapa } from "./MapaRastreio";

/** Centro padrão (Florianópolis) quando ainda não há nenhuma coordenada. */
const CENTRO_PADRAO: L.LatLngTuple = [-27.5954, -48.548];

const icone = (classe: string, texto = "") => L.divIcon({ className: "", html: `<span class="mapa-marcador ${classe}">${texto}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });

/**
 * Mapa com Leaflet e blocos do OpenStreetMap (sem chave e sem custo; ver política de uso justo em docs/produto/modulo-rastreio.md).
 * Carregado sob demanda (ver MapaRastreio.tsx), para não pesar nas telas sem mapa.
 */
export default function Mapa({ onibus, pontos = [], trajeto = [], rotulo, altura }: PropsMapa) {
  const raiz = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camada = useRef<L.LayerGroup | null>(null);
  const ajustado = useRef(false);

  useEffect(() => {
    if (!raiz.current || mapa.current) return;
    const m = L.map(raiz.current, { center: CENTRO_PADRAO, zoom: 12, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      // O servidor de blocos do OSM exige o site de origem; sem isto o "Referrer-Policy: same-origin" do sistema o esconderia.
      // Com "strict-origin-when-cross-origin" só o domínio vai (nunca o caminho, que traz o token do link).
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(m);
    camada.current = L.layerGroup().addTo(m);
    mapa.current = m;
    return () => {
      m.remove();
      mapa.current = null;
      camada.current = null;
      ajustado.current = false;
    };
  }, []);

  useEffect(() => {
    const m = mapa.current;
    const g = camada.current;
    if (!m || !g) return;
    g.clearLayers();
    const todos: L.LatLngTuple[] = [];
    if (trajeto.length > 1) {
      L.polyline(trajeto, { color: "#0069ad", weight: 4, opacity: 0.7 }).addTo(g);
      todos.push(...trajeto);
    }
    pontos.forEach((p, i) => {
      const classe = p.destaque ? "mapa-marcador--cliente" : p.passou ? "mapa-marcador--passou" : "mapa-marcador--ponto";
      L.marker([p.lat, p.lng], { icon: icone(classe, p.destaque ? "★" : String(i + 1)), title: p.nome, keyboard: false }).addTo(g);
      todos.push([p.lat, p.lng]);
    });
    if (onibus) {
      L.marker([onibus.lat, onibus.lng], { icon: icone("mapa-marcador--onibus", "Ô"), title: "Ônibus", zIndexOffset: 1000, keyboard: false }).addTo(g);
      todos.push([onibus.lat, onibus.lng]);
    }
    if (!todos.length) return;
    if (!ajustado.current) {
      m.fitBounds(L.latLngBounds(todos), { padding: [30, 30], maxZoom: 16 });
      ajustado.current = true;
    } else if (onibus && !m.getBounds().contains([onibus.lat, onibus.lng])) {
      m.panTo([onibus.lat, onibus.lng]);
    }
  }, [onibus, pontos, trajeto]);

  return <div ref={raiz} className="mapa-rastreio" style={altura ? { height: altura } : undefined} role="region" aria-label={rotulo} />;
}
