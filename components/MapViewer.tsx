import React, { useState } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, useMapEvents, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, WMSData } from '../types';

// Fix Leaflet marker icon issue in React
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapViewerProps {
  onLocationSelect: (coords: Coordinates, wmsData: WMSData | null) => void;
  selectedCoords: Coordinates | null;
}

// Helper to convert blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix to get just base64 for Gemini
      const base64 = base64String.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Helper to separate coordinate conversion logic
const latLngToWebMercator = (lat: number, lng: number) => {
  const r = 6378137;
  const x = r * (lng * Math.PI) / 180;
  const y = r * Math.log(Math.tan((Math.PI / 4) + (lat * Math.PI) / 360));
  return { x, y };
};

// Helper to fetch FeatureInfo from BRGM WMS
const fetchBrgmData = async (map: L.Map, latlng: L.LatLng): Promise<WMSData | null> => {
  try {
    const point = map.latLngToContainerPoint(latlng);
    const size = map.getSize();
    const bounds = map.getBounds();

    // --- 1. GetFeatureInfo (Keep 4326 for feature info as it works for text) ---
    // Use GEO50K_HARM which is the harmonized vector geological layer
    const vectorParams: Record<string, string> = {
      request: 'GetFeatureInfo',
      service: 'WMS',
      srs: 'EPSG:4326',
      styles: '',
      transparent: 'true',
      version: '1.1.1',
      format: 'image/png', // Format of the map image being queried (virtual)
      bbox: bounds.toBBoxString(),
      height: size.y.toString(),
      width: size.x.toString(),
      layers: 'GEO50K_HARM',
      query_layers: 'GEO50K_HARM',
      info_format: 'application/json',
      x: Math.round(point.x).toString(),
      y: Math.round(point.y).toString(),
      feature_count: '1'
    };

    const vectorUrl = 'https://geoservices.brgm.fr/geologie?' + new URLSearchParams(vectorParams).toString();
    const vectorResponse = await fetch(vectorUrl);
    let rawResponse = '';

    if (vectorResponse.ok) {
      const vectorData = await vectorResponse.text();
      rawResponse = vectorData;
      console.log("WMS Vector Response:", vectorData);
    }

    // --- 2. GetMap (The Visual Context - Force EPSG:3857) ---
    // We explicitly calculate Web Mercator bounds to match Leaflet's view
    const delta = 0.005; // degree delta roughly
    const p1 = latLngToWebMercator(latlng.lat - delta, latlng.lng - delta);
    const p2 = latLngToWebMercator(latlng.lat + delta, latlng.lng + delta);
    const mapBbox = `${p1.x},${p1.y},${p2.x},${p2.y}`;

    const mapParams: Record<string, string> = {
      request: 'GetMap',
      service: 'WMS',
      srs: 'EPSG:3857', // Use Web Mercator to match visual tiles
      styles: '',
      version: '1.1.1',
      format: 'image/jpeg',
      bbox: mapBbox,
      width: '512',
      height: '512',
      layers: 'SCAN_D_GEOL50'
    };

    const mapUrl = 'https://geoservices.brgm.fr/geologie?' + new URLSearchParams(mapParams).toString();
    console.log("Fetching WMS Image:", mapUrl);
    const mapResponse = await fetch(mapUrl);
    let mapImageBase64 = undefined;

    if (mapResponse.ok) {
      const blob = await mapResponse.blob();
      // Verify usage of blob
      if (blob.size > 2000) { // arbitrary threshold to filter out tiny XML errors
        mapImageBase64 = await blobToBase64(blob);
      } else {
        console.warn("WMS Image too small, likely error or blank:", blob.size);
      }
    }

    return {
      rawResponse,
      mapImageBase64
    };

  } catch (error) {
    console.warn("WMS fetch failed:", error);
    return null;
  }
};

// --- Search Component ---
const SearchControl = () => {
  const map = useMap();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      // Limit search to France (codes 'fr')
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=fr&limit=5`);
      const data = await response.json();
      setResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (lat: string, lon: string) => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lon);
    map.setView([latNum, lngNum], 13); // Zoom level 13 is good for context
    setResults([]);
    setQuery('');
  };

  return (
    <div className="absolute top-4 left-14 md:left-16 z-[1000] w-64 md:w-80 font-sans">
      <div className="relative group">
        <form onSubmit={handleSearch}>
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <input
            type="text"
            className="block w-full p-2.5 pl-10 text-sm text-slate-900 bg-white/95 backdrop-blur border border-slate-300 rounded-lg shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 placeholder-slate-500"
            placeholder="Rechercher une ville..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="absolute inset-y-0 right-0 flex items-center pr-3">
            {loading ? (
              <div className="animate-spin h-4 w-4 border-2 border-emerald-500 rounded-full border-t-transparent"></div>
            ) : (
              <span className="sr-only">Rechercher</span>
            )}
          </button>
        </form>

        {results.length > 0 && (
          <div className="absolute z-20 w-full mt-1 bg-white rounded-lg shadow-xl border border-slate-100 max-h-60 overflow-y-auto">
            <ul className="py-1 text-sm text-slate-700">
              {results.map((place, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="inline-flex w-full px-4 py-2 hover:bg-emerald-50 text-left border-b border-slate-50 last:border-0"
                    onClick={() => handleSelect(place.lat, place.lon)}
                  >
                    <span className="truncate">{place.display_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

const MapEvents: React.FC<{
  onLocationSelect: (coords: Coordinates, wmsData: WMSData | null) => void
}> = ({ onLocationSelect }) => {
  const map = useMap();
  const lastClickTime = React.useRef<number>(0);

  useMapEvents({
    async click(e) {
      const now = Date.now();
      if (now - lastClickTime.current < 1000) {
        console.log("Blocking duplicate map click");
        return;
      }
      lastClickTime.current = now;

      // 1. Set coords immediately
      const coords = { lat: e.latlng.lat, lng: e.latlng.lng };

      // 2. Fetch data (WMS Info + Visual Tile)
      let wmsData: WMSData | null = null;
      try {
        wmsData = await fetchBrgmData(map, e.latlng);
      } catch (err) {
        console.error("Error fetching WMS data", err);
      }

      onLocationSelect(coords, wmsData);
    },
  });
  return null;
};

const MapViewer: React.FC<MapViewerProps> = ({ onLocationSelect, selectedCoords }) => {
  // Default center of France
  const position: [number, number] = [46.603354, 1.888334];

  return (
    <div className="h-full w-full relative z-0">
      <MapContainer center={position} zoom={6} scrollWheelZoom={true} className="h-full w-full">
        <SearchControl />

        {/* Background Layer: OpenStreetMap for context */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          opacity={0.4}
        />

        {/* BRGM WMS Layer - Geology 1/50 000 (Image Scan) */}
        <WMSTileLayer
          url="https://geoservices.brgm.fr/geologie"
          layers="SCAN_D_GEOL50"
          format="image/png"
          transparent={true}
          opacity={0.75}
          attribution='&copy; <a href="http://www.brgm.fr/">BRGM</a>'
        />

        <MapEvents onLocationSelect={onLocationSelect} />

        {selectedCoords && (
          <Marker position={[selectedCoords.lat, selectedCoords.lng]}>
            <Popup>
              Point d'analyse<br />
              {selectedCoords.lat.toFixed(4)}, {selectedCoords.lng.toFixed(4)}
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Legend Overlay Hint */}
      <div className="absolute bottom-6 left-6 z-[1000] bg-white/90 p-3 rounded-lg shadow-md backdrop-blur-sm text-xs max-w-xs pointer-events-none">
        <p className="font-semibold text-slate-800 mb-1">Couche : BRGM 1/50 000</p>
        <p className="text-slate-600">Double validation : Serveur WMS + Vision IA</p>
      </div>
    </div>
  );
};

export default MapViewer;