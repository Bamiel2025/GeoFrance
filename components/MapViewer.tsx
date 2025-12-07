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

// Helper to fetch FeatureInfo from BRGM WMS
const fetchBrgmData = async (map: L.Map, latlng: L.LatLng): Promise<WMSData | null> => {
  try {
    const point = map.latLngToContainerPoint(latlng);
    const size = map.getSize();
    const bounds = map.getBounds();
    
    // --- 1. GetFeatureInfo (The Truth Data) ---
    // CRITICAL FIX: Use WMS 1.1.1. 
    // WMS 1.3.0 with EPSG:4326 expects axis order Lat,Lon. Leaflet sends Lon,Lat.
    // WMS 1.1.1 expects Lon,Lat which matches Leaflet's bounds.toBBoxString().
    const infoParams: Record<string, string> = {
      request: 'GetFeatureInfo',
      service: 'WMS',
      srs: 'EPSG:4326', // Coordinate system
      styles: '',
      transparent: 'true',
      version: '1.1.1', // Changed from 1.3.0 to fix coordinate inversion bug
      format: 'image/png',
      bbox: bounds.toBBoxString(), // "west,south,east,north" matches 1.1.1
      height: size.y.toString(),
      width: size.x.toString(),
      layers: 'SCAN_D_GEOL50',
      query_layers: 'SCAN_D_GEOL50',
      info_format: 'text/plain', // Request text for easier parsing, fall back to html if needed
      x: Math.round(point.x).toString(), // 'x' and 'y' for WMS 1.1.1 (instead of i,j)
      y: Math.round(point.y).toString()
    };

    const infoUrl = 'https://geoservices.brgm.fr/geologie?' + new URLSearchParams(infoParams).toString();
    const infoResponse = await fetch(infoUrl);
    const rawResponse = await infoResponse.text();

    // --- 2. GetMap (The Visual Context) ---
    // Fetch a small tile centered on the click to let AI "see" the map code
    // Create a small bbox around the click (approx 500m window)
    const delta = 0.01; 
    const mapBbox = `${latlng.lng - delta},${latlng.lat - delta},${latlng.lng + delta},${latlng.lat + delta}`;
    
    const mapParams: Record<string, string> = {
      request: 'GetMap',
      service: 'WMS',
      srs: 'EPSG:4326',
      styles: '',
      version: '1.1.1',
      format: 'image/jpeg',
      bbox: mapBbox,
      width: '512',
      height: '512',
      layers: 'SCAN_D_GEOL50'
    };

    const mapUrl = 'https://geoservices.brgm.fr/geologie?' + new URLSearchParams(mapParams).toString();
    const mapResponse = await fetch(mapUrl);
    let mapImageBase64 = undefined;
    
    if (mapResponse.ok) {
      const blob = await mapResponse.blob();
      mapImageBase64 = await blobToBase64(blob);
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

const MapEvents: React.FC<{ onLocationSelect: (coords: Coordinates, wmsData: WMSData | null) => void }> = ({ onLocationSelect }) => {
  const map = useMap();
  
  useMapEvents({
    async click(e) {
      // 1. Set coords immediately
      const coords = { lat: e.latlng.lat, lng: e.latlng.lng };
      
      // 2. Fetch data (WMS Info + Visual Tile)
      let wmsData = null;
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