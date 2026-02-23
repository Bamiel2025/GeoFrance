import React, { useState, useEffect } from 'react';
import { GeologyAnalysis, LoadingState } from '../types';

interface AnalysisPanelProps {
  status: LoadingState;
  data: GeologyAnalysis | null;
  error: string | null;
  onClose: () => void;
  onManualCorrection: (code: string) => void;
}

type Tab = 'strati' | 'paleo' | 'fossils';

const AnalysisPanel: React.FC<AnalysisPanelProps> = ({ status, data, error, onClose, onManualCorrection }) => {
  const [activeTab, setActiveTab] = useState<Tab>('strati');
  const [isEditing, setIsEditing] = useState(false);
  const [editCode, setEditCode] = useState('');

  const [fossilImages, setFossilImages] = useState<Record<string, string | null>>({});
  const [isLoadingFossil, setIsLoadingFossil] = useState<Record<string, boolean>>({});
  const [paleoMapImage, setPaleoMapImage] = useState<string | null>(null);
  const [isLoadingMap, setIsLoadingMap] = useState<boolean>(false);

  const fetchWikiImage = async (query: string) => {
    try {
      const searchUrl = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&origin=*`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      if (searchData.query?.search?.length > 0) {
        const pageTitle = searchData.query.search[0].title;
        const imgUrl = `https://fr.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=500&origin=*`;
        const imgRes = await fetch(imgUrl);
        const imgData = await imgRes.json();

        const pages = imgData.query.pages;
        const firstPageId = Object.keys(pages)[0];
        if (pages[firstPageId]?.thumbnail) {
          return pages[firstPageId].thumbnail.source;
        }
      }
      return null;
    } catch (e) {
      console.error("Wiki fetch error", e);
      return null;
    }
  };

  const handleFossilClick = async (fossil: string) => {
    if (fossilImages[fossil] !== undefined) return;
    setIsLoadingFossil(prev => ({ ...prev, [fossil]: true }));
    const cleanName = fossil.split('(')[0].trim().split(' ')[0];
    const imageUrl = await fetchWikiImage(cleanName);
    setFossilImages(prev => ({ ...prev, [fossil]: imageUrl }));
    setIsLoadingFossil(prev => ({ ...prev, [fossil]: false }));
  };

  useEffect(() => {
    if (activeTab === 'paleo' && data?.age && paleoMapImage === null && !isLoadingMap) {
      const fetchMap = async () => {
        setIsLoadingMap(true);
        try {
          const baseAge = data.age.split('(')[0].trim();
          const query = `paleogeography ${baseAge}`;
          const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&format=json&origin=*`;
          const searchRes = await fetch(searchUrl);
          const searchData = await searchRes.json();

          if (searchData.query?.search?.length > 0) {
            const fileTitle = searchData.query.search[0].title;
            const imgUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
            const imgRes = await fetch(imgUrl);
            const imgData = await imgRes.json();

            const pages = imgData.query.pages;
            const firstKey = Object.keys(pages)[0];
            if (pages[firstKey]?.imageinfo?.length > 0) {
              setPaleoMapImage(pages[firstKey].imageinfo[0].url);
            }
          }
        } catch (e) {
          console.error("Map fetch error", e);
        }
        setIsLoadingMap(false);
      };
      fetchMap();
    }
  }, [activeTab, data]);

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editCode.trim()) {
      onManualCorrection(editCode.trim());
      setIsEditing(false);
      setEditCode('');
    }
  };

  if (status === LoadingState.IDLE) {
    return (
      <div className="hidden md:flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center border-l border-slate-200 bg-slate-50">
        <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
        <p className="text-sm font-medium">Sélectionnez un point sur la carte pour une analyse complète (Géologie, Paléoenvironnement, Fossiles).</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white border-l border-slate-200 shadow-xl overflow-hidden w-full md:w-96 absolute right-0 top-0 z-[2000] md:relative font-sans">

      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === LoadingState.SUCCESS ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`}></span>
          Analyse Géologique
        </h2>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 md:hidden">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {status === LoadingState.LOADING && (
          <div className="flex flex-col items-center justify-center h-64 space-y-4 p-6">
            <div className="relative">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
              <div className="absolute top-0 left-0 h-12 w-12 rounded-full border-t-2 border-emerald-200 animate-pulse"></div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700">Voyage dans le temps en cours...</p>
              <p className="text-xs text-slate-400 mt-1">Reconstitution paléo-environnementale</p>
            </div>
          </div>
        )}

        {status === LoadingState.ERROR && (
          <div className="p-6">
            <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm border border-red-100">
              <div className="flex items-center gap-2 mb-2 font-semibold">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                Erreur
              </div>
              {error}
              <div className="mt-3 pt-3 border-t border-red-100">
                <p className="text-xs mb-2 text-slate-600">Le code n'a pas été reconnu ? Essayez de le saisir manuellement :</p>
                <form onSubmit={handleEditSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    placeholder="Ex: J9ad"
                    className="flex-1 text-sm border-slate-300 rounded px-2 py-1"
                  />
                  <button type="submit" className="bg-red-100 hover:bg-red-200 text-red-700 text-xs px-3 py-1 rounded font-medium transition-colors">Corriger</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {status === LoadingState.SUCCESS && data && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Top Summary Card */}
            <div className="bg-slate-50 p-4 border-b border-slate-100">
              <div className="flex justify-between items-start mb-2">
                <div className="text-xs font-mono text-slate-500 uppercase">{data.location_name}</div>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <form onSubmit={handleEditSubmit} className="flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        placeholder="Code"
                        className="w-16 h-6 text-[10px] px-1 border border-emerald-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white rounded p-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </button>
                      <button type="button" onClick={() => setIsEditing(false)} className="bg-slate-200 hover:bg-slate-300 text-slate-500 rounded p-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </form>
                  ) : (
                    <div className="group flex items-center gap-1 cursor-pointer" onClick={() => { setIsEditing(true); setEditCode(data.code); }} title="Corriger manuellement le code">
                      <div className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200 group-hover:bg-emerald-200 transition-colors">
                        {data.code}
                      </div>
                      <svg className="w-3 h-3 text-slate-300 group-hover:text-emerald-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </div>
                  )}
                </div>
              </div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight mb-1">{data.formation}</h1>
              <p className="text-sm font-medium text-emerald-600">
                {data.age}
                {data.age_ma && <span className="ml-2 text-slate-500 font-normal">({data.age_ma})</span>}
              </p>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-200 sticky top-0 bg-white z-10">
              <button
                onClick={() => setActiveTab('strati')}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'strati' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                Stratigraphie
              </button>
              <button
                onClick={() => setActiveTab('paleo')}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'paleo' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                Paléo
              </button>
              <button
                onClick={() => setActiveTab('fossils')}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'fossils' ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
              >
                Fossiles
              </button>
            </div>

            {/* Content Area */}
            <div className="p-5">

              {/* --- STRATIGRAPHIE TAB --- */}
              {activeTab === 'strati' && (
                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                      <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Lithologie</h3>
                    </div>
                    <div className="p-4">
                      <p className="text-sm leading-relaxed text-slate-700 text-justify">
                        <span className="font-semibold text-slate-900">{data.lithology}</span>. {data.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <span>Feuille : {data.map_sheet}</span>
                    <span>Lat: {data.coords.lat.toFixed(4)}, Lng: {data.coords.lng.toFixed(4)}</span>
                  </div>
                </div>
              )}

              {/* --- PALEOGEOGRAPHIE TAB --- */}
              {activeTab === 'paleo' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-4">
                    <div className="absolute top-0 right-0 p-3 opacity-10">
                      <svg className="w-24 h-24 text-blue-900" fill="currentColor" viewBox="0 0 24 24"><path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>

                    <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-3 relative z-10">Contexte Paléoenvironnemental</h3>

                    <p className="text-sm text-slate-700 italic mb-4 relative z-10 leading-relaxed">
                      "{data.paleogeography?.context || "Reconstitution en cours..."}"
                    </p>

                    {isLoadingMap ? (
                      <div className="flex justify-center my-4 relative z-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    ) : paleoMapImage ? (
                      <div className="mb-4 relative z-10 rounded-lg overflow-hidden border border-blue-200 shadow-sm bg-white">
                        <img src={paleoMapImage} alt="Carte paléogéographique" className="w-full h-auto object-cover max-h-48" />
                        <div className="absolute bottom-0 right-0 bg-white/80 backdrop-blur px-2 py-1 text-[9px] text-slate-600 rounded-tl-lg">Source: Wikimedia Commons</div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-3 relative z-10">
                      <div className="bg-white/60 backdrop-blur rounded-lg p-2.5 flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-md">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-400 font-bold">Environnement</div>
                          <div className="text-sm font-semibold text-slate-800">{data.paleogeography?.environment || "N/A"}</div>
                        </div>
                      </div>

                      <div className="bg-white/60 backdrop-blur rounded-lg p-2.5 flex items-center gap-3">
                        <div className="p-2 bg-amber-100 text-amber-600 rounded-md">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-400 font-bold">Climat</div>
                          <div className="text-sm font-semibold text-slate-800">
                            {data.paleogeography?.climate || "N/A"}
                            {data.paleogeography?.temperature && <span className="ml-1 text-amber-600 text-xs font-bold">({data.paleogeography.temperature})</span>}
                          </div>
                        </div>
                      </div>

                      <div className="bg-white/60 backdrop-blur rounded-lg p-2.5 flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-md">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-400 font-bold">Niveau Marin</div>
                          <div className="text-sm font-semibold text-slate-800">
                            {data.paleogeography?.sea_level || "N/A"}
                            {data.paleogeography?.sea_level_m && <span className="ml-1 text-indigo-600 text-xs font-bold">({data.paleogeography.sea_level_m})</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* --- FOSSILES TAB --- */}
              {activeTab === 'fossils' && (
                <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-4">
                      <svg className="w-5 h-5 text-amber-700" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9c.83 0 1.5.67 1.5 1.5S7.83 14 7 14s-1.5-.67-1.5-1.5S6.17 11 7 11zm3-4c.83 0 1.5.67 1.5 1.5S10.83 10 10 10s-1.5-.67-1.5-1.5S9.17 7 10 7zm5 4c.83 0 1.5.67 1.5 1.5S15.83 14 15 14s-1.5-.67-1.5-1.5S14.17 11 15 11z" opacity="0.3" /><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.2 13.9a1 1 0 1 1-1.4 1.4l-2.1-2.1a3.9 3.9 0 0 1-5.4-5.4l1.1 1.1a2.4 2.4 0 1 0 3.3 3.3l2.1 2.1a1 1 0 0 1 2.4-.4z" /></svg>
                      <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider">Fossiles Caractéristiques</h3>
                    </div>

                    {data.fossils && data.fossils.length > 0 ? (
                      <ul className="space-y-2">
                        {data.fossils.map((fossil, idx) => (
                          <li key={idx} className="flex flex-col gap-2 bg-white p-3 rounded-lg shadow-sm border border-amber-100 transition-all">
                            <div
                              className="flex items-center gap-3 cursor-pointer group"
                              onClick={() => handleFossilClick(fossil)}
                              title="Cliquez pour chercher une image"
                            >
                              <span className="w-6 h-6 flex items-center justify-center bg-amber-100 text-amber-600 rounded-full text-xs font-bold group-hover:bg-amber-200 transition-colors">
                                {isLoadingFossil[fossil] ? (
                                  <div className="animate-spin h-3 w-3 border-2 border-amber-600 rounded-full border-t-transparent"></div>
                                ) : (
                                  idx + 1
                                )}
                              </span>
                              <span className="text-sm text-slate-800 font-medium group-hover:text-amber-700 transition-colors">{fossil}</span>
                            </div>

                            {fossilImages[fossil] && (
                              <div className="mt-2 rounded-md overflow-hidden bg-slate-50 border border-slate-100 flex justify-center p-1">
                                <img src={fossilImages[fossil]!} alt={fossil} className="max-h-32 object-contain rounded" />
                              </div>
                            )}
                            {fossilImages[fossil] === null && !isLoadingFossil[fossil] && (
                              <div className="mt-1 text-[10px] text-slate-400 italic">Aucune image libre trouvée</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-sm text-slate-500 italic">Aucun fossile majeur spécifiquement répertorié pour cette formation géologique précise.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Footer Sources */}
            {data.sources && data.sources.length > 0 && (
              <div className="px-5 pb-5 pt-2">
                <h3 className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2">Sources</h3>
                <ul className="space-y-1">
                  {data.sources.slice(0, 2).map((source, index) => (
                    <li key={index}>
                      <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-blue-500 truncate block">
                        • {source.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisPanel;