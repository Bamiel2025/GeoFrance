import React, { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import AnalysisPanel from './components/AnalysisPanel';
import { GeologyAnalysis, LoadingState, Coordinates, WMSData } from './types';
import { analyzeGeologyAtLocation } from './services/geminiService';

// Dynamic import for MapViewer to avoid SSR issues with Leaflet (window is not defined)
const MapViewer = dynamic(() => import('./components/MapViewer'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-slate-200">
      <div className="animate-spin h-8 w-8 border-4 border-emerald-500 rounded-full border-t-transparent"></div>
    </div>
  )
});

const App: React.FC = () => {
  const [status, setStatus] = useState<LoadingState>(LoadingState.IDLE);
  const [analysisData, setAnalysisData] = useState<GeologyAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<Coordinates | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [currentWmsData, setCurrentWmsData] = useState<WMSData | null>(null);

  const handleLocationSelect = useCallback(async (coords: Coordinates, wmsData: WMSData | null) => {
    setSelectedCoords(coords);
    setCurrentWmsData(wmsData); // Save for potential re-analysis
    setStatus(LoadingState.LOADING);
    setAnalysisData(null);
    setError(null);
    setIsPanelOpen(true);

    try {
      // Pass the raw WMS data to the service if available
      const data = await analyzeGeologyAtLocation(coords.lat, coords.lng, wmsData);
      setAnalysisData(data);
      setStatus(LoadingState.SUCCESS);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Une erreur est survenue lors de l'analyse.");
      setStatus(LoadingState.ERROR);
    }
  }, []);

  const handleManualCorrection = async (manualCode: string) => {
    if (!selectedCoords) return;

    setStatus(LoadingState.LOADING);
    // Keep existing data to minimize flicker or just show loading
    // setAnalysisData(null); 
    setError(null);

    try {
      // Construct updated WMS data with the manual code
      const updatedWmsData: WMSData = {
        ...(currentWmsData || { rawResponse: '' }),
        manualCode: manualCode
      };

      const data = await analyzeGeologyAtLocation(selectedCoords.lat, selectedCoords.lng, updatedWmsData);
      setAnalysisData(data);
      setStatus(LoadingState.SUCCESS);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Une erreur est survenue lors de la correction.");
      setStatus(LoadingState.ERROR);
    }
  };

  const closePanel = () => setIsPanelOpen(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100">
      {/* Main Map Area */}
      <div className={`flex-grow h-full relative transition-all duration-300 ease-in-out ${isPanelOpen ? 'md:mr-0' : ''}`}>
        <MapViewer
          onLocationSelect={handleLocationSelect}
          selectedCoords={selectedCoords}
        />

        {/* Mobile toggle if panel is closed but we have data */}
        {!isPanelOpen && analysisData && (
          <button
            onClick={() => setIsPanelOpen(true)}
            className="absolute bottom-6 right-6 z-[1000] bg-emerald-600 text-white p-3 rounded-full shadow-lg hover:bg-emerald-700 transition-colors md:hidden"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}
      </div>

      {/* Side Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-[2000] w-full md:w-96 transform transition-transform duration-300 ease-in-out md:relative md:transform-none shadow-2xl md:shadow-none ${isPanelOpen ? 'translate-x-0' : 'translate-x-full md:hidden'
          }`}
      >
        <AnalysisPanel
          status={status}
          data={analysisData}
          error={error}
          onClose={closePanel}
          onManualCorrection={handleManualCorrection}
        />
      </div>
    </div>
  );
};

export default App;