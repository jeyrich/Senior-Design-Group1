/* -------------------------------------------------------------------------- */
/* Senior Design TRIPS Annotation Software                                    */
/* Team Members: Theo Smith, Jack Eyrich, Anthony Roti                        */
/* Sponsors: Cara Hamann (TRIPS Lab), Tyler Bell (ECE Dept)                   */
/* Revision Date: 03/09/2026                                                  */
/* -------------------------------------------------------------------------- */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Play, Pause, AlertTriangle, Shield,
  X, History, ArrowLeftRight, Download,
  CornerDownRight, Trash2, RefreshCcw, Target, Save, Volume2, VolumeX,
  Split, Map as MapIcon, Droplets, HardHat, Plus
} from 'lucide-react';
import { Annotation, AnnotationType, GPSPoint } from './types';

// External Leaflet declaration for TypeScript
declare const L: any;

const App: React.FC = () => {
  /* -------------------------------------------------------------------------- */
  /* 1. STATE MANAGEMENT                                                        */
  /* -------------------------------------------------------------------------- */

  // Session & Media States
  const [userId, setUserId] = useState(''); // Add this line
  const [frontVideo, setFrontVideo] = useState<{ file: File; url: string } | null>(null);
  const [backVideo, setBackVideo] = useState<{ file: File; url: string } | null>(null);
  const [gpsData, setGpsData] = useState<GPSPoint[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  // Playback & UI Sync States
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Viewport & Layout States
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSetup, setShowSetup] = useState(true);
  const [isAutoCentering, setIsAutoCentering] = useState(true);
  const [isSwapped, setIsSwapped] = useState(false);

  // Annotation Workflow States
  const [pendingAnnotation, setPendingAnnotation] = useState<any>(null);
  const [pendingNote, setPendingNote] = useState('');

  // New Critical Point Workflow States
  const [showCriticalPointPicker, setShowCriticalPointPicker] = useState(false);
  const [criticalPointDraft, setCriticalPointDraft] = useState<any>(null);
  const [showJunctionModal, setShowJunctionModal] = useState(false);
  const [showLaneChangeModal, setShowLaneChangeModal] = useState(false);
  const [showHazardModal, setShowHazardModal] = useState(false);

  // Continuous Variables (States)
  const [activeStates, setActiveStates] = useState({
    weather: 'Clear',
    path: 'Road',
    surface: 'Paved',
    helmet: 'Properly'
  });

  /* -------------------------------------------------------------------------- */
  /* 2. REFS (DOM & MAP INSTANCES)                                              */
  /* -------------------------------------------------------------------------- */

  const frontVideoRef = useRef<HTMLVideoElement>(null);
  const backVideoRef = useRef<HTMLVideoElement>(null);
  const miniFrontRef = useRef<HTMLVideoElement>(null);
  const miniBackRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const annotationMarkersRef = useRef<Record<string, any>>({});
  const requestRef = useRef<number>();

  /* -------------------------------------------------------------------------- */
  /* 3. UTILITY FUNCTIONS                                                       */
  /* -------------------------------------------------------------------------- */

  const getColorStyles = (color: string) => {
    const styles: Record<string, string> = {
      red: 'border-red-500/50 bg-red-500/10 text-red-400',
      amber: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
      blue: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
      green: 'border-green-500/50 bg-green-500/10 text-green-400',
      purple: 'border-purple-500/50 bg-purple-500/10 text-purple-400',
      slate: 'border-slate-500/50 bg-slate-500/10 text-slate-400'
    };
    return styles[color] || styles.slate;
  };

  const getHexFromColor = (color: string) => {
    const hex: Record<string, string> = {
      red: '#ef4444',
      amber: '#f59e0b',
      blue: '#3b82f6',
      green: '#10b981',
      purple: '#a855f7',
      slate: '#64748b'
    };
    return hex[color] || hex.slate;
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getInterpolatedGPS = (time: number) => {
    if (gpsData.length === 0) return null;

    if (time <= gpsData[0].timestamp) return [gpsData[0].lat, gpsData[0].lng];
    if (time >= gpsData[gpsData.length - 1].timestamp) {
      const last = gpsData[gpsData.length - 1];
      return [last.lat, last.lng];
    }

    let nextIdx = gpsData.findIndex((p) => p.timestamp > time);
    if (nextIdx === -1) nextIdx = gpsData.length - 1;
    const prevIdx = Math.max(0, nextIdx - 1);
    const p1 = gpsData[prevIdx];
    const p2 = gpsData[nextIdx];

    if (p2.timestamp === p1.timestamp) return [p1.lat, p1.lng];

    const ratio = (time - p1.timestamp) / (p2.timestamp - p1.timestamp);
    return [
      p1.lat + (p2.lat - p1.lat) * ratio,
      p1.lng + (p2.lng - p1.lng) * ratio
    ];
  };

  const captureCurrentFrame = () => {
    const video = isSwapped ? backVideoRef.current : frontVideoRef.current;
    if (!video || !canvasRef.current) return null;

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    return {
      screenshot: canvas.toDataURL('image/jpeg'),
      timestamp: video.currentTime
    };
  };

  /* -------------------------------------------------------------------------- */
  /* 4. MAP & GPS INTERPOLATION ENGINE                                          */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    if (!showSetup && gpsData.length > 0 && !mapRef.current) {
      setTimeout(() => {
        const container = document.getElementById('map-container');
        if (container) {
          const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          });

          const satelliteLayer = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
              attribution:
                'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
            }
          );

          mapRef.current = L.map('map-container', {
            zoomControl: false,
            attributionControl: false,
            layers: [streetLayer]
          }).setView([gpsData[0].lat, gpsData[0].lng], 18);

          const baseMaps = {
            Streets: streetLayer,
            Satellite: satelliteLayer
          };
          L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(mapRef.current);

          const riderIcon = L.divIcon({
            className: 'custom-rider-marker',
            html: `<div class="w-3 h-3 bg-indigo-500 border-2 border-white rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          });

          markerRef.current = L.marker([gpsData[0].lat, gpsData[0].lng], { icon: riderIcon }).addTo(mapRef.current);

          const path = gpsData.map((p) => [p.lat, p.lng]);
          polylineRef.current = L.polyline(path, { color: '#6366f1', weight: 4, opacity: 0.5 }).addTo(mapRef.current);

          mapRef.current.on('dragstart', () => setIsAutoCentering(false));
          mapRef.current.on('zoomstart', () => setIsAutoCentering(false));
        }
      }, 200);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, [showSetup, gpsData]);

  const updateMapFrame = useCallback(() => {
    if (!isPlaying || gpsData.length === 0 || !mapRef.current || !markerRef.current) return;

    const time = frontVideoRef.current?.currentTime || 0;
    const pos = getInterpolatedGPS(time);

    if (pos) {
      markerRef.current.setLatLng(pos);
      if (isAutoCentering) mapRef.current.panTo(pos, { animate: false });
    }

    requestRef.current = requestAnimationFrame(updateMapFrame);
  }, [isPlaying, gpsData, isAutoCentering]);

  useEffect(() => {
    if (isPlaying) requestRef.current = requestAnimationFrame(updateMapFrame);
    else if (requestRef.current) cancelAnimationFrame(requestRef.current);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, updateMapFrame]);

  /* -------------------------------------------------------------------------- */
  /* 5. PLAYBACK CONTROLS & SYNC                                                */
  /* -------------------------------------------------------------------------- */

  const handleRecenter = () => {
    if (markerRef.current && mapRef.current) {
      const pos = markerRef.current.getLatLng();
      mapRef.current.setView(pos, 18, { animate: true });
      setIsAutoCentering(true);
    }
  };

  const togglePlay = () => {
    const playing = !isPlaying;
    setIsPlaying(playing);
    [frontVideoRef, backVideoRef, miniFrontRef, miniBackRef].forEach((ref) => {
      if (ref.current) playing ? ref.current.play() : ref.current.pause();
    });
  };

  const syncVideos = (time: number) => {
    setCurrentTime(time);
    [backVideoRef, miniFrontRef, miniBackRef].forEach((ref) => {
      if (ref.current && Math.abs(ref.current.currentTime - time) > 0.1) {
        ref.current.currentTime = time;
      }
    });
  };

  const seekToTime = (time: number) => {
    [frontVideoRef, backVideoRef, miniFrontRef, miniBackRef].forEach((ref) => {
      if (ref.current) ref.current.currentTime = time;
    });
    setCurrentTime(time);
  };

  /* -------------------------------------------------------------------------- */
  /* 6. ANNOTATION HANDLERS                                                     */
  /* -------------------------------------------------------------------------- */

  const addMapPoint = (id: string, time: number, color: string, label: string) => {
    if (!mapRef.current) return;
    const pos = getInterpolatedGPS(time);
    if (!pos) return;

    const pointIcon = L.divIcon({
      className: 'annotation-marker',
      html: `<div class="w-4 h-4 rounded-full border-2 border-white shadow-lg flex items-center justify-center transition-transform hover:scale-125 cursor-pointer" style="background-color: ${getHexFromColor(color)}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker(pos, { icon: pointIcon }).addTo(mapRef.current);
    marker.bindTooltip(label, { direction: 'top', offset: [0, -8] });
    marker.on('click', () => {
      seekToTime(time);
      setIsAutoCentering(false);
    });

    annotationMarkersRef.current[id] = marker;
  };

  const addSystemLog = (category: string, oldVal: string, newVal: string) => {
    const video = isSwapped ? backVideoRef.current : frontVideoRef.current;
    const time = video?.currentTime || 0;

    let type: AnnotationType = AnnotationType.GENERAL;
    if (category === 'WEATHER') type = AnnotationType.WEATHER;
    if (category === 'SURFACE' || category === 'PATH') type = AnnotationType.SURFACE;
    if (category === 'HELMET') type = AnnotationType.HELMET;

    const id = crypto.randomUUID();
    const log: Annotation = {
      id,
      timestamp: time,
      formattedTime: formatTime(time),
      type,
      value: 'State Change',
      note: `SYSTEM: ${category} changed from ${oldVal} to ${newVal}`,
      screenshot: ''
    };

    setAnnotations((prev) => [...prev, log].sort((a, b) => a.timestamp - b.timestamp));
    addMapPoint(id, time, 'slate', `${category}: ${newVal}`);
  };

  const updateState = (key: keyof typeof activeStates, value: string) => {
    const oldVal = activeStates[key];
    if (oldVal === value) return;
    setActiveStates((prev) => ({ ...prev, [key]: value }));
    addSystemLog(key.toUpperCase(), oldVal, value);
  };

  const pauseAll = () => {
    setIsPlaying(false);
    [frontVideoRef, backVideoRef, miniFrontRef, miniBackRef].forEach((ref) => {
      if (ref.current) ref.current.pause();
    });
  };

  const handleActionClick = (type: AnnotationType, value: string, color: string) => {
    pauseAll();
    const frame = captureCurrentFrame();
    if (!frame) return;

    setPendingAnnotation({
      type,
      value,
      color,
      screenshot: frame.screenshot,
      timestamp: frame.timestamp
    });
  };

  const saveAnnotation = () => {
    if (!pendingAnnotation) return;

    const stateContext = `[Context: Weather:${activeStates.weather}, Path:${activeStates.path}, Surface:${activeStates.surface}, Helmet:${activeStates.helmet}]`;

    const id = crypto.randomUUID();
    const ann: Annotation & { color?: string } = {
      id,
      timestamp: pendingAnnotation.timestamp,
      formattedTime: formatTime(pendingAnnotation.timestamp),
      type: pendingAnnotation.type,
      value: pendingAnnotation.value,
      note: pendingNote ? `${stateContext} ${pendingNote}` : stateContext,
      screenshot: pendingAnnotation.screenshot,
      color: pendingAnnotation.color
    };

    setAnnotations((prev) => {
      const updated = [...prev, ann];
      return updated.sort((a, b) => a.timestamp - b.timestamp);
    });

    addMapPoint(id, pendingAnnotation.timestamp, pendingAnnotation.color, pendingAnnotation.value);
    setPendingAnnotation(null);
    setPendingNote('');
  };

  const saveCriticalPointAnnotation = (label: string, details: Record<string, any>, color = 'purple') => {
    if (!criticalPointDraft) return;

    const stateContext = `[Context: Weather:${activeStates.weather}, Path:${activeStates.path}, Surface:${activeStates.surface}, Helmet:${activeStates.helmet}]`;
    const id = crypto.randomUUID();

    const detailString = Object.entries(details)
      .filter(([_, v]) => v !== '' && v !== false && v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : v}`)
      .join(' | ');

    const ann: Annotation & { color?: string } = {
      id,
      timestamp: criticalPointDraft.timestamp,
      formattedTime: formatTime(criticalPointDraft.timestamp),
      type: AnnotationType.GENERAL,
      value: label,
      note: `${stateContext}${detailString ? ' ' + detailString : ''}`,
      screenshot: criticalPointDraft.screenshot,
      color
    };

    setAnnotations((prev) => [...prev, ann].sort((a, b) => a.timestamp - b.timestamp));
    addMapPoint(id, criticalPointDraft.timestamp, color, label);

    setCriticalPointDraft(null);
    setShowCriticalPointPicker(false);
    setShowJunctionModal(false);
    setShowLaneChangeModal(false);
    setShowHazardModal(false);
  };

  const openCriticalPointPicker = () => {
    pauseAll();
    const frame = captureCurrentFrame();
    if (!frame) return;

    setCriticalPointDraft({
      screenshot: frame.screenshot,
      timestamp: frame.timestamp
    });
    setShowCriticalPointPicker(true);
  };

  const handleCriticalPointSelection = (value: string) => {
    setShowCriticalPointPicker(false);

    if (value === 'Junctions') setShowJunctionModal(true);
    if (value === 'Change Lanes') setShowLaneChangeModal(true);
    if (value === 'Hazard Anticipation') setShowHazardModal(true);
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((ann) => ann.id !== id));
    if (annotationMarkersRef.current[id]) {
      annotationMarkersRef.current[id].remove();
      delete annotationMarkersRef.current[id];
    }
  };

  /* -------------------------------------------------------------------------- */
  /* 7. DATA EXPORT & IMPORT                                                    */
  /* -------------------------------------------------------------------------- */

  const getFormattedFileName = (suffix: string) => {
  const date = new Date();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  const id = userId || 'anonymous';
  return `${id}_${mm}-${dd}-${yyyy}_${suffix}`; // Results in: UserID_03-23-2026_annotation.csv
};

const exportToCSV = () => {
  const headers = ['Timestamp', 'Type', 'Value', 'Note'];
  const rows = annotations.map((a) => [a.formattedTime, a.type, a.value, `"${a.note}"`]);
  const csvContent = [headers, ...rows].map((e) => e.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  // Dynamic Filename
  link.download = getFormattedFileName('annotation.csv');
  link.click();
};

const saveWorkspaceFile = () => {
  const projectData = {
    version: '1.0',
    userId, // Include userId in the saved data
    annotations,
    gpsData,
    exportDate: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  
  // Dynamic Filename
  link.download = getFormattedFileName('session.trips');
  link.click();
};

  const handleStartSession = (
  front: File | null,
  back: File | null,
  gps: GPSPoint[],
  importedAnnotations?: Annotation[],
  id?: string // <--- New parameter
) => {
  if (id) setUserId(id); // <--- Save the ID to state
  
  setAnnotations(importedAnnotations || []);
  setIsPlaying(false);
  setCurrentTime(0);

  if (front) setFrontVideo({ file: front, url: URL.createObjectURL(front) });
  if (back) setBackVideo({ file: back, url: URL.createObjectURL(back) });

  setGpsData(gps);
  setShowSetup(false);
};
  /* -------------------------------------------------------------------------- */
  /* 8. RENDER LOGIC                                                            */
  /* -------------------------------------------------------------------------- */

  if (showSetup) {
    return (
      <SessionSetupModal
        onStart={handleStartSession}
        onClose={() => setShowSetup(false)}
        isResuming={frontVideo !== null}
      />
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans text-left">
      <canvas ref={canvasRef} className="hidden" />

      {showCriticalPointPicker && (
        <CriticalPointPickerModal
          onClose={() => {
            setShowCriticalPointPicker(false);
            setCriticalPointDraft(null);
          }}
          onSelect={handleCriticalPointSelection}
        />
      )}

      {showJunctionModal && criticalPointDraft && (
        <JunctionModal
          onClose={() => {
            setShowJunctionModal(false);
            setCriticalPointDraft(null);
          }}
          onSave={(data) => saveCriticalPointAnnotation('Critical Point - Junctions', data, 'purple')}
        />
      )}

      {showLaneChangeModal && criticalPointDraft && (
        <LaneChangeModal
          onClose={() => {
            setShowLaneChangeModal(false);
            setCriticalPointDraft(null);
          }}
          onSave={(data) => saveCriticalPointAnnotation('Critical Point - Change Lanes', data, 'purple')}
        />
      )}

      {showHazardModal && criticalPointDraft && (
        <HazardModal
          onClose={() => {
            setShowHazardModal(false);
            setCriticalPointDraft(null);
          }}
          onSave={(data) => saveCriticalPointAnnotation('Critical Point - Hazard Anticipation', data, 'purple')}
        />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-72 border-r border-slate-800 bg-slate-900/50 flex flex-col backdrop-blur-xl shrink-0">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-400" /> Observations
            </h2>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 hover:bg-slate-800 rounded-lg">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
            {annotations.length === 0 && (
              <div className="text-center py-10 text-slate-500 text-xs uppercase tracking-widest font-bold">
                Empty
              </div>
            )}

            {annotations.map((ann: any) => (
              <div
                key={ann.id}
                onClick={() => seekToTime(ann.timestamp)}
                className={`group cursor-pointer p-3 bg-slate-900 border-l-4 border-y border-r border-slate-800 rounded-xl relative transition-all ${
                  ann.value === 'State Change'
                    ? 'bg-indigo-500/5 border-l-slate-400 opacity-80'
                    : ann.color === 'red'
                    ? 'border-l-red-500'
                    : ann.color === 'amber'
                    ? 'border-l-amber-500'
                    : ann.color === 'blue'
                    ? 'border-l-blue-500'
                    : ann.color === 'green'
                    ? 'border-l-green-500'
                    : ann.color === 'purple'
                    ? 'border-l-purple-500'
                    : 'border-l-slate-500'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAnnotation(ann.id);
                  }}
                  className="absolute top-2 right-2 p-1.5 bg-red-500/10 text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500 hover:text-white"
                >
                  <Trash2 className="w-3 h-3" />
                </button>

                <div className="flex justify-between items-start mb-1 pr-6">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none ${
                      ann.value === 'State Change'
                        ? 'bg-slate-800 text-slate-300'
                        : getColorStyles(ann.color || 'slate')
                    }`}
                  >
                    {ann.type}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">{ann.formattedTime}</span>
                </div>

                <h3 className="font-semibold text-xs mb-1 line-clamp-1">{ann.value}</h3>
                {ann.note && <p className="text-[10px] text-slate-400 line-clamp-3 mt-1 leading-relaxed">{ann.note}</p>}
                {ann.screenshot && (
                  <img src={ann.screenshot} className="w-full h-20 object-cover rounded-lg mt-2 border border-slate-800" alt="Observation" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-14 border-b border-slate-800 bg-slate-950 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-2 font-bold uppercase tracking-tight text-sm">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="mr-2 p-1.5 hover:bg-slate-800 rounded-lg">
                <History className="w-4 h-4" />
              </button>
            )}
            <Shield className="w-4 h-4 text-indigo-500" /> TRIPS Bike Annotation
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveWorkspaceFile}
              className="flex items-center gap-2 px-2.5 py-1 bg-green-600/20 text-green-400 border border-green-500/30 rounded-lg text-[10px] font-bold hover:bg-green-600 transition-all"
            >
              <Save className="w-3 h-3" /> Save .trips
            </button>

            <button
              onClick={() => setShowSetup(true)}
              className="flex items-center gap-2 px-2.5 py-1 bg-slate-800 text-slate-300 border border-slate-700 rounded-lg text-[10px] font-bold hover:bg-slate-700 transition-all"
            >
              <RefreshCcw className="w-3 h-3" /> New Session
            </button>

            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-2.5 py-1 bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 rounded-lg text-[10px] font-bold hover:bg-indigo-600 transition-all"
            >
              <Download className="w-3 h-3" /> Export CSV
            </button>

            <button
              onClick={() => setIsSwapped(!isSwapped)}
              className="flex items-center gap-2 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-bold transition-all"
            >
              <ArrowLeftRight className="w-3 h-3" /> Swap View
            </button>

            <div className="flex items-center gap-2 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-1 rounded transition-colors ${isMuted ? 'text-slate-500' : 'text-indigo-400'}`}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <div className="font-mono text-indigo-400 font-bold text-xs">{formatTime(currentTime)}</div>
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col p-4 space-y-4 overflow-hidden">
          <div className="flex-1 grid grid-cols-12 gap-4 min-h-0 text-left">
            <div
              className="col-span-8 relative bg-black rounded-2xl overflow-hidden border border-slate-800 group shadow-2xl cursor-pointer"
              onClick={togglePlay}
            >
              <video
                ref={frontVideoRef}
                src={frontVideo?.url}
                muted={isMuted}
                className={`absolute inset-0 w-full h-full object-contain transition-all duration-300 ${
                  isSwapped ? 'opacity-0 scale-95' : 'opacity-100 scale-100 z-10'
                }`}
                onTimeUpdate={(e) => syncVideos(e.currentTarget.currentTime)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                playsInline
              />
              <video
                ref={backVideoRef}
                src={backVideo?.url}
                muted={isMuted || !isSwapped}
                className={`absolute inset-0 w-full h-full object-contain transition-all duration-300 ${
                  !isSwapped ? 'opacity-0 scale-95' : 'opacity-100 scale-100 z-10'
                }`}
                playsInline
              />

              <div
                className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-4">
                  <button onClick={togglePlay} className="p-2 bg-white rounded-xl text-black">
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max={duration || 1}
                    step="0.1"
                    value={currentTime}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      seekToTime(t);
                    }}
                    className="flex-1 accent-indigo-500 h-1 rounded-lg appearance-none bg-slate-700 cursor-pointer"
                  />
                </div>
              </div>

              <div className="absolute top-4 left-4 z-20 flex gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-[9px] font-black uppercase flex items-center gap-2">
                  <Droplets className={`w-3 h-3 ${activeStates.weather !== 'Clear' ? 'text-blue-400' : 'text-slate-500'}`} />
                  {activeStates.weather}
                </div>
                <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-[9px] font-black uppercase flex items-center gap-2">
                  <MapIcon className="w-3 h-3 text-indigo-400" />
                  {activeStates.path} / {activeStates.surface}
                </div>
                <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-[9px] font-black uppercase flex items-center gap-2">
                  <HardHat
                    className={`w-3 h-3 ${
                      activeStates.helmet === 'Properly'
                        ? 'text-green-400'
                        : activeStates.helmet === 'None'
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  />
                  {activeStates.helmet}
                </div>
              </div>
            </div>

            <div className="col-span-4 flex flex-col gap-4">
              <div className="h-[180px] bg-black rounded-2xl overflow-hidden border border-slate-800 relative shadow-xl">
                <video
                  ref={miniFrontRef}
                  src={frontVideo?.url}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    !isSwapped ? 'opacity-0' : 'opacity-100'
                  }`}
                  muted
                  playsInline
                />
                <video
                  ref={miniBackRef}
                  src={backVideo?.url}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    isSwapped ? 'opacity-0' : 'opacity-100'
                  }`}
                  muted
                  playsInline
                />
                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded text-[8px] font-bold text-white uppercase border border-white/10 z-20">
                  {isSwapped ? 'Front' : 'Rear'}
                </div>
              </div>

              <div className="flex-1 relative">
                <div id="map-container" className="absolute inset-0 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl overflow-hidden" />
                <div className="absolute top-2 right-2 z-[400] flex flex-col gap-1.5 items-end">
                  <button
                    onClick={handleRecenter}
                    className={`p-1.5 rounded-lg border shadow-lg transition-all ${
                      isAutoCentering
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Target className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="h-32 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-2xl relative">
            {pendingAnnotation ? (
              <div className="flex-1 flex items-center gap-6 animate-in slide-in-from-bottom-2">
                <img src={pendingAnnotation.screenshot} className="w-16 h-16 rounded-lg object-cover border border-indigo-500/30" alt="Pending" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold uppercase w-fit px-2 py-0.5 rounded ${getColorStyles(pendingAnnotation.color)}`}>
                      {pendingAnnotation.type}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{pendingAnnotation.value}</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Detail the observation..."
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs w-full"
                    value={pendingNote}
                    onChange={(e) => setPendingNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveAnnotation()}
                  />
                </div>
                <button onClick={saveAnnotation} className="px-5 py-2.5 bg-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-500">
                  Save
                </button>
                <button onClick={() => setPendingAnnotation(null)} className="p-2.5 bg-slate-800 rounded-lg text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-3">
                <div className="flex items-center gap-4 border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 border-r border-slate-800 pr-4">
                    <span className="text-[8px] font-black text-slate-500 uppercase">Weather:</span>
                    <select
                      className="bg-transparent text-[9px] font-bold text-blue-400 outline-none cursor-pointer"
                      value={activeStates.weather}
                      onChange={(e) => updateState('weather', e.target.value)}
                    >
                      <option value="Clear">Clear</option>
                      <option value="Rain">Rain</option>
                      <option value="Fog">Fog</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 border-r border-slate-800 pr-4">
                    <span className="text-[8px] font-black text-slate-500 uppercase">Path:</span>
                    <select
                      className="bg-transparent text-[9px] font-bold text-indigo-400 outline-none cursor-pointer"
                      value={activeStates.path}
                      onChange={(e) => updateState('path', e.target.value)}
                    >
                      <option value="Road">Road</option>
                      <option value="Bike Lane">Bike Lane</option>
                      <option value="Shoulder">Shoulder</option>
                      <option value="Sidewalk">Sidewalk</option>
                      <option value="Parking">Parking</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 border-r border-slate-800 pr-4">
                    <span className="text-[8px] font-black text-slate-500 uppercase">Surface:</span>
                    <select
                      className="bg-transparent text-[9px] font-bold text-amber-400 outline-none cursor-pointer"
                      value={activeStates.surface}
                      onChange={(e) => updateState('surface', e.target.value)}
                    >
                      <option value="Paved">Paved</option>
                      <option value="Dirt">Dirt</option>
                      <option value="Gravel">Gravel</option>
                      <option value="Grass">Grass</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black text-slate-500 uppercase">Helmet:</span>
                    <select
                      className="bg-transparent text-[9px] font-bold text-green-400 outline-none cursor-pointer"
                      value={activeStates.helmet}
                      onChange={(e) => updateState('helmet', e.target.value)}
                    >
                      <option value="Properly">Wearing (Properly)</option>
                      <option value="Improperly">Wearing (Improperly)</option>
                      <option value="None">Not Wearing</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 justify-between items-center">
                  <div className="flex gap-3">
                    <QuickActionBtn
                      onClick={() => handleActionClick(AnnotationType.CRASH, 'Hazard', 'red')}
                      icon={<AlertTriangle className="w-4 h-4" />}
                      color="red"
                      label="Hazard"
                    />
                    <QuickActionBtn
                      onClick={openCriticalPointPicker}
                      icon={<Split className="w-4 h-4" />}
                      color="purple"
                      label="Critical Point"
                    />
                    <QuickActionBtn
                      onClick={() => handleActionClick(AnnotationType.GENERAL, 'Manual Log', 'slate')}
                      icon={<Plus className="w-4 h-4" />}
                      color="slate"
                      label="Log"
                    />
                  </div>

                  <div className="text-slate-500 text-[10px] italic flex items-center gap-2 bg-black/20 p-2 rounded-xl border border-white/5">
                    <CornerDownRight className="w-3 h-3 text-indigo-500" />
                    Tag frame. Click map points to jump to timestamps.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* REUSABLE UI COMPONENTS                                                     */
/* -------------------------------------------------------------------------- */

const QuickActionBtn: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: string;
}> = ({ onClick, icon, label, color }) => {
  const colors: Record<string, string> = {
    red: 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-400',
    amber: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-400',
    blue: 'bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/20 text-blue-400',
    green: 'bg-green-500/10 hover:bg-green-500/20 border-green-500/20 text-green-400',
    purple: 'bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/20 text-purple-400',
    slate: 'bg-slate-700/50 hover:bg-slate-700 border-slate-600 text-slate-300'
  };

  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all active:scale-95 ${colors[color]}`}>
      {icon}
      <span className="text-[8px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
};

const ModalShell: React.FC<{
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}> = ({ title, children, onClose }) => (
  <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-slate-100 text-slate-900 w-full max-w-5xl rounded-xl shadow-2xl border border-slate-300 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-white">
        <h2 className="font-semibold text-sm">{title}</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-200">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  </div>
);

const FormRadio: React.FC<{
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  label: string;
}> = ({ name, value, checked, onChange, label }) => (
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input type="radio" name={name} checked={checked} onChange={() => onChange(value)} />
    <span>{label}</span>
  </label>
);

const FieldBlock: React.FC<{
  title: string;
  children: React.ReactNode;
  pink?: boolean;
}> = ({ title, children, pink = false }) => (
  <div className={`border ${pink ? 'bg-rose-100' : 'bg-white'} border-slate-300`}>
    <div className="px-3 py-2 font-semibold text-sm border-b border-slate-300">{title}</div>
    <div className="p-3 space-y-2">{children}</div>
  </div>
);

/* -------------------------------------------------------------------------- */
/* CRITICAL POINT SELECTOR                                                    */
/* -------------------------------------------------------------------------- */

const CriticalPointPickerModal: React.FC<{
  onClose: () => void;
  onSelect: (value: string) => void;
}> = ({ onClose, onSelect }) => {
  const [selection, setSelection] = useState('Junctions');

  return (
    <ModalShell title="Critical Point Selection" onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-slate-700">Choose the critical point type for this timestamp.</div>

        <select
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white"
        >
          <option value="Junctions">Junctions</option>
          <option value="Change Lanes">Change Lanes</option>
          <option value="Hazard Anticipation">Hazard Anticipation</option>
        </select>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm">
            Cancel
          </button>
          <button onClick={() => onSelect(selection)} className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-semibold">
            Continue
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

/* -------------------------------------------------------------------------- */
/* JUNCTION MODAL                                                             */
/* -------------------------------------------------------------------------- */

const JunctionModal: React.FC<{
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
}> = ({ onClose, onSave }) => {
  const [contactingType, setContactingType] = useState('Street');
  const [junctionControlType, setJunctionControlType] = useState('Some-Stop');
  const [riderControlType, setRiderControlType] = useState('No Control');
  const [conditions, setConditions] = useState('Clear Visibility');
  const [why, setWhy] = useState('');
  const [trafficEntities, setTrafficEntities] = useState<string[]>(['No Traffic']);
  const [movementType, setMovementType] = useState('Combo movement');
  const [turnDirection, setTurnDirection] = useState('Go Straight');
  const [scanFront, setScanFront] = useState('Yes');
  const [scanRear, setScanRear] = useState('No');
  const [handSignal, setHandSignal] = useState('No');
  const [stopBehavior, setStopBehavior] = useState('Appropriate Stop/Yield');
  const [riskyBehavior, setRiskyBehavior] = useState('No');
  const [riskyExplain, setRiskyExplain] = useState('');
  const [ridingSurface, setRidingSurface] = useState('Not changed');

  const toggleEntity = (entity: string) => {
    setTrafficEntities((prev) =>
      prev.includes(entity) ? prev.filter((e) => e !== entity) : [...prev.filter((e) => e !== 'No Traffic'), entity]
    );
  };

  return (
    <ModalShell title="Conflict Point - Junctions" onClose={onClose}>
      {/* Reduced scale and tighter spacing to ensure it fits 1080p screens */}
      <div className="space-y-3 transform scale-[0.92] origin-top">
        <div className="grid grid-cols-4 gap-2">
          <FieldBlock title="Contacting Type">
            {['Street', 'Driveway with signals'].map((v) => (
              <FormRadio key={v} name="contactingType" value={v} checked={contactingType === v} onChange={setContactingType} label={v} />
            ))}
          </FieldBlock>

          <FieldBlock title="Junction Control">
            <div className="space-y-0.5">
              {['Traffic Light', 'All-Stop', 'Some-Stop', 'Yield', 'Roundabout', 'Other', 'No Control'].map((v) => (
                <FormRadio key={v} name="junctionControlType" value={v} checked={junctionControlType === v} onChange={setJunctionControlType} label={v} />
              ))}
            </div>
          </FieldBlock>

          <FieldBlock title="Rider Control">
            <div className="space-y-0.5">
              {['Red Light', 'Red Ped Light', 'Stop Sign', 'Green Light', 'Green Ped Light', 'Yield', 'Roundabout', 'Other', 'No Control'].map((v) => (
                <FormRadio key={v} name="riderControlType" value={v} checked={riderControlType === v} onChange={setRiderControlType} label={v} />
              ))}
            </div>
          </FieldBlock>

          <FieldBlock title="Conditions & Traffic">
            <FormRadio name="conditions" value="Clear Visibility" checked={conditions === 'Clear Visibility'} onChange={setConditions} label="Clear" />
            <FormRadio name="conditions" value="Low visibility (blind corner)" checked={conditions === 'Low visibility (blind corner)'} onChange={setConditions} label="Low Vis" />
            
            <input
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-0.5 text-[10px] mt-1"
              placeholder="Why?"
            />

            <div className="grid grid-cols-2 gap-1 pt-2 text-[10px]">
              {['Vehicles', 'Pedestrians', 'Other Bicyclist', 'No Traffic'].map((item) => (
                <label key={item} className="flex items-center gap-1">
                  <input type="checkbox" checked={trafficEntities.includes(item)} 
                    onChange={() => item === 'No Traffic' ? setTrafficEntities(['No Traffic']) : toggleEntity(item)} 
                  />
                  {item}
                </label>
              ))}
            </div>

            <div className="pt-2 space-y-0.5 border-t border-slate-100 mt-2">
              {['Vehicle movement', 'Ped movement (cross)', 'Combo movement'].map((v) => (
                <FormRadio key={v} name="movementType" value={v} checked={movementType === v} onChange={setMovementType} label={v} />
              ))}
            </div>
          </FieldBlock>
        </div>

        {/* Rider Behavior Section - Tightened Grid */}
        <div className="border-t border-slate-200 pt-3">
          <div className="grid grid-cols-6 gap-2">
            <FieldBlock title="Scan (F)" pink>
              {['Yes', 'Partial', 'No', 'N/R'].map((v) => (
                <FormRadio key={v} name="scanFront" value={v} checked={scanFront === v} onChange={setScanFront} label={v} />
              ))}
            </FieldBlock>

            <FieldBlock title="Scan (R)" pink>
              {['Yes', 'No', 'N/R'].map((v) => (
                <FormRadio key={v} name="scanRear" value={v} checked={scanRear === v} onChange={setScanRear} label={v} />
              ))}
            </FieldBlock>

            <FieldBlock title="Signal" pink>
              <div className="text-[9px] space-y-0">
                {['Correct', 'Alt Right', 'Stop', 'Audible', 'No'].map((v) => (
                  <FormRadio key={v} name="handSignal" value={v} checked={handSignal === v} onChange={setHandSignal} label={v} />
                ))}
              </div>
            </FieldBlock>

            <FieldBlock title="Stop" pink>
              {['Appropriate', 'Incomplete', 'No'].map((v) => (
                <FormRadio key={v} name="stopBehavior" value={v} checked={stopBehavior.includes(v)} onChange={setStopBehavior} label={v} />
              ))}
            </FieldBlock>

            <FieldBlock title="Risky" pink>
              <FormRadio name="risky" value="Yes" checked={riskyBehavior === 'Yes'} onChange={setRiskyBehavior} label="Yes" />
              <FormRadio name="risky" value="No" checked={riskyBehavior === 'No'} onChange={setRiskyBehavior} label="No" />
              {riskyBehavior === 'Yes' && (
                <input value={riskyExplain} onChange={(e) => setRiskyExplain(e.target.value)} className="w-full border border-slate-300 rounded px-1 text-[9px]" placeholder="Explain" />
              )}
            </FieldBlock>

            <FieldBlock title="Surface" pink>
              {['Changed', 'Not changed'].map((v) => (
                <FormRadio key={v} name="surface" value={v} checked={ridingSurface === v} onChange={setRidingSurface} label={v} />
              ))}
            </FieldBlock>
          </div>
        </div>

        {/* Final Action Row */}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-1.5 rounded border border-slate-300 bg-white text-xs font-bold hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onSave({ contactingType, junctionControlType, riderControlType, conditions, why, trafficEntities, movementType, turnDirection, scanFront, scanRear, handSignal, stopBehavior, riskyBehavior, riskyExplain, ridingSurface })}
            className="px-6 py-1.5 rounded bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-sm transition-all"
          >
            Ok
          </button>
        </div>
      </div>
    </ModalShell>
  );
};

/* -------------------------------------------------------------------------- */
/* LANE CHANGE MODAL                                                          */
/* -------------------------------------------------------------------------- */

const LaneChangeModal: React.FC<{
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
}> = ({ onClose, onSave }) => {
  const [situation, setSituation] = useState('Simple lane/path change');
  const [scanFront, setScanFront] = useState('Partial');
  const [scanRear, setScanRear] = useState('No');
  const [handSignal, setHandSignal] = useState('No');
  const [midblock, setMidblock] = useState('No');
  const [riskyBehavior, setRiskyBehavior] = useState('No');
  const [riskyExplain, setRiskyExplain] = useState('');
  const [ridingSurfacePath, setRidingSurfacePath] = useState('Changed');

  return (
    <ModalShell title="Conflict Points - Change Lanes" onClose={onClose}>
      <div className="grid grid-cols-5 gap-3">
        <FieldBlock title="Situation">
          <FormRadio
            name="situation"
            value="Simple lane/path change"
            checked={situation === 'Simple lane/path change'}
            onChange={setSituation}
            label="Simple lane/path change"
          />
        </FieldBlock>

        <div className="col-span-4 space-y-3">
          <FieldBlock title="Behavior">
            <div className="grid grid-cols-1 gap-3">
              <FieldBlock title="Scan Traffic (Front)" pink>
                <div className="flex flex-wrap gap-4">
                  {['Yes', 'Partial', 'No', 'N/R', 'N/O'].map((v) => (
                    <FormRadio key={v} name="lcScanFront" value={v} checked={scanFront === v} onChange={setScanFront} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Scan Traffic (Rear)" pink>
                <div className="flex flex-wrap gap-4">
                  {['Yes', 'No', 'N/O', 'N/R'].map((v) => (
                    <FormRadio key={v} name="lcScanRear" value={v} checked={scanRear === v} onChange={setScanRear} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Hand Signal" pink>
                <div className="flex flex-wrap gap-4">
                  {['Correct Turn', 'Alternative Turn', 'Correct Stop', 'Other Incorrect', 'No', 'N/R', 'N/O'].map((v) => (
                    <FormRadio key={v} name="lcHandSignal" value={v} checked={handSignal === v} onChange={setHandSignal} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Midblock" pink>
                <div className="flex flex-wrap gap-4">
                  {['Midblock dart out', 'Midblock cross', 'No'].map((v) => (
                    <FormRadio key={v} name="lcMidblock" value={v} checked={midblock === v} onChange={setMidblock} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Risky Behavior" pink>
                <div className="flex items-center gap-4 flex-wrap">
                  {['Yes', 'No'].map((v) => (
                    <FormRadio key={v} name="lcRisky" value={v} checked={riskyBehavior === v} onChange={setRiskyBehavior} label={v} />
                  ))}
                  {riskyBehavior === 'Yes' && (
                    <input
                      value={riskyExplain}
                      onChange={(e) => setRiskyExplain(e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-sm"
                      placeholder="Explain"
                    />
                  )}
                </div>
              </FieldBlock>

              <FieldBlock title="Riding Surface/Path" pink>
                <div className="flex flex-wrap gap-4">
                  {['Changed', 'Not Changed'].map((v) => (
                    <FormRadio
                      key={v}
                      name="lcRidingSurfacePath"
                      value={v}
                      checked={ridingSurfacePath === v}
                      onChange={setRidingSurfacePath}
                      label={v}
                    />
                  ))}
                </div>
              </FieldBlock>
            </div>
          </FieldBlock>

          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm">
              Cancel
            </button>
            <button
              onClick={() =>
                onSave({
                  situation,
                  scanFront,
                  scanRear,
                  handSignal,
                  midblock,
                  riskyBehavior,
                  riskyExplain,
                  ridingSurfacePath
                })
              }
              className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-semibold"
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};

/* -------------------------------------------------------------------------- */
/* HAZARD MODAL                                                               */
/* -------------------------------------------------------------------------- */

const HazardModal: React.FC<{
  onClose: () => void;
  onSave: (data: Record<string, any>) => void;
}> = ({ onClose, onSave }) => {
  const [hazardType, setHazardType] = useState('Other');
  const [hazardTypeOther, setHazardTypeOther] = useState('');
  const [action, setAction] = useState('Passing');
  const [scanFront, setScanFront] = useState('No');
  const [scanRear, setScanRear] = useState('No');
  const [handSignal, setHandSignal] = useState('No');
  const [audibleSignal, setAudibleSignal] = useState('No');
  const [stopYield, setStopYield] = useState('Appropriate Stop/Yield');
  const [riskyBehavior, setRiskyBehavior] = useState('No');
  const [riskyExplain, setRiskyExplain] = useState('');
  const [ridingSurface, setRidingSurface] = useState('Not Changed');

  return (
    <ModalShell title="Conflict Points - Hazard Anticipation" onClose={onClose}>
      <div className="grid grid-cols-5 gap-3">
        <FieldBlock title="Types" pink>
          {['Moving Vehicles', 'Pedestrians', 'Other Riders', 'Group Riders', 'Parked Vehicles', 'Debris/Potholes', 'Other'].map((v) => (
            <FormRadio key={v} name="hazardType" value={v} checked={hazardType === v} onChange={setHazardType} label={v} />
          ))}
          {hazardType === 'Other' && (
            <input
              value={hazardTypeOther}
              onChange={(e) => setHazardTypeOther(e.target.value)}
              className="w-full border border-slate-300 rounded px-2 py-1 text-sm mt-2"
              placeholder="Description"
            />
          )}
        </FieldBlock>

        <FieldBlock title="Actions" pink>
          {['Passing', 'Avoiding', 'Yielding'].map((v) => (
            <FormRadio key={v} name="hazardAction" value={v} checked={action === v} onChange={setAction} label={v} />
          ))}
        </FieldBlock>

        <div className="col-span-3">
          <FieldBlock title="Behavior">
            <div className="space-y-3">
              <FieldBlock title="Scan Traffic (Front)" pink>
                <div className="flex flex-wrap gap-4">
                  {['Yes', 'Partial', 'No', 'N/R', 'N/O'].map((v) => (
                    <FormRadio key={v} name="hzFront" value={v} checked={scanFront === v} onChange={setScanFront} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Scan Traffic (Rear)" pink>
                <div className="flex flex-wrap gap-4">
                  {['Yes', 'No', 'N/R', 'N/O'].map((v) => (
                    <FormRadio key={v} name="hzRear" value={v} checked={scanRear === v} onChange={setScanRear} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Hand Signal" pink>
                <div className="flex flex-wrap gap-4">
                  {['Correct Turn', 'Alternative Turn', 'Correct Stop', 'Other Incorrect', 'No', 'N/R', 'N/O'].map((v) => (
                    <FormRadio key={v} name="hzHand" value={v} checked={handSignal === v} onChange={setHandSignal} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Audible Signal" pink>
                <div className="flex flex-wrap gap-4">
                  {['Yes', 'No', 'N/R', 'No audio (N/O)'].map((v) => (
                    <FormRadio key={v} name="hzAudible" value={v} checked={audibleSignal === v} onChange={setAudibleSignal} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Stop/Yield" pink>
                <div className="flex flex-wrap gap-4">
                  {['Appropriate Stop/Yield', 'Incomplete Stop', 'No', 'N/R'].map((v) => (
                    <FormRadio key={v} name="hzStopYield" value={v} checked={stopYield === v} onChange={setStopYield} label={v} />
                  ))}
                </div>
              </FieldBlock>

              <FieldBlock title="Risky Behavior" pink>
                <div className="flex items-center gap-4 flex-wrap">
                  {['Yes', 'No'].map((v) => (
                    <FormRadio key={v} name="hzRisky" value={v} checked={riskyBehavior === v} onChange={setRiskyBehavior} label={v} />
                  ))}
                  {riskyBehavior === 'Yes' && (
                    <input
                      value={riskyExplain}
                      onChange={(e) => setRiskyExplain(e.target.value)}
                      className="border border-slate-300 rounded px-2 py-1 text-sm"
                      placeholder="Explain"
                    />
                  )}
                </div>
              </FieldBlock>

              <FieldBlock title="Riding Surface" pink>
                <div className="flex flex-wrap gap-4">
                  {['Changed', 'Not Changed'].map((v) => (
                    <FormRadio key={v} name="hzSurface" value={v} checked={ridingSurface === v} onChange={setRidingSurface} label={v} />
                  ))}
                </div>
              </FieldBlock>
            </div>
          </FieldBlock>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded border border-slate-300 bg-white text-sm">
          Cancel
        </button>
        <button
          onClick={() =>
            onSave({
              hazardType,
              hazardTypeOther,
              action,
              scanFront,
              scanRear,
              handSignal,
              audibleSignal,
              stopYield,
              riskyBehavior,
              riskyExplain,
              ridingSurface
            })
          }
          className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-semibold"
        >
          Ok
        </button>
      </div>
    </ModalShell>
  );
};

/* -------------------------------------------------------------------------- */
/* SESSION SETUP MODAL - Updated for Front, Rear, and GPX                     */
/* -------------------------------------------------------------------------- */

const SessionSetupModal: React.FC<{
  onStart: (front: File | null, back: File | null, gps: GPSPoint[], annotations?: Annotation[], id?: string) => void;
  onClose: () => void;
  isResuming: boolean;
}> = ({ onStart, onClose, isResuming }) => {
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [gpxFile, setGpxFile] = useState<File | null>(null);
  const [userId, setUserId] = useState('');

  const parseGPX = async (file: File): Promise<GPSPoint[]> => {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const trackPoints = Array.from(xmlDoc.querySelectorAll("trkpt"));

    if (trackPoints.length === 0) return [];

    // Get start time to normalize timestamps to video seconds
    const startTimeStr = trackPoints[0].querySelector("time")?.textContent;
    const startTime = startTimeStr ? new Date(startTimeStr).getTime() : 0;

    return trackPoints.map((pt) => {
      const timeStr = pt.querySelector("time")?.textContent;
      const pointTime = timeStr ? new Date(timeStr).getTime() : 0;
      
      return {
        lat: parseFloat(pt.getAttribute("lat") || "0"),
        lng: parseFloat(pt.getAttribute("lon") || "0"),
        timestamp: (pointTime - startTime) / 1000 // Convert to seconds relative to start
      };
    });
  };

  const handleBegin = async () => {
    let gpsPoints: GPSPoint[] = [];
    if (gpxFile) {
      gpsPoints = await parseGPX(gpxFile);
    }
    onStart(frontFile, backFile, gpsPoints, [], userId);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-6">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-indigo-500/20 rounded-2xl">
            <Shield className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">New Annotation Session</h2>
            <p className="text-slate-400 text-sm">Upload media and GPS data to begin</p>
          </div>
        </div>

        <div className="space-y-6">
          {/* User ID Input */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Annotator Name / ID</label>
            <input 
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. UserID"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Front Video */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Front Video</label>
              <div className="relative group">
                <input 
                  type="file" 
                  accept="video/*" 
                  onChange={(e) => setFrontFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                />
                <div className={`p-4 border-2 border-dashed rounded-2xl text-center transition-all ${frontFile ? 'border-green-500/50 bg-green-500/5' : 'border-slate-800 hover:border-slate-700'}`}>
                  <Plus className={`w-5 h-5 mx-auto mb-2 ${frontFile ? 'text-green-400' : 'text-slate-500'}`} />
                  <span className="text-[10px] font-bold block truncate">
                    {frontFile ? frontFile.name : 'Select Video'}
                  </span>
                </div>
              </div>
            </div>

            {/* Rear Video */}
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">Rear Video</label>
              <div className="relative group">
                <input 
                  type="file" 
                  accept="video/*" 
                  onChange={(e) => setBackFile(e.target.files?.[0] || null)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                />
                <div className={`p-4 border-2 border-dashed rounded-2xl text-center transition-all ${backFile ? 'border-green-500/50 bg-green-500/5' : 'border-slate-800 hover:border-slate-700'}`}>
                  <Plus className={`w-5 h-5 mx-auto mb-2 ${backFile ? 'text-green-400' : 'text-slate-500'}`} />
                  <span className="text-[10px] font-bold block truncate">
                    {backFile ? backFile.name : 'Select Video'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* GPS Upload */}
          <div className="space-y-2">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">GPS Data (.gpx)</label>
            <div className="relative group">
              <input 
                type="file" 
                accept=".gpx" 
                onChange={(e) => setGpxFile(e.target.files?.[0] || null)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
              />
              <div className={`p-6 border-2 border-dashed rounded-2xl text-center transition-all ${gpxFile ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-slate-800 hover:border-slate-700'}`}>
                <MapIcon className={`w-6 h-6 mx-auto mb-2 ${gpxFile ? 'text-indigo-400' : 'text-slate-500'}`} />
                <span className="text-xs font-bold block">
                  {gpxFile ? gpxFile.name : 'Drag and drop your .gpx file here'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 px-6 py-3 rounded-xl border border-slate-800 text-slate-400 text-sm font-bold hover:bg-slate-800 transition-all"
          >
            Cancel
          </button>
          <button 
            disabled={!frontFile || !gpxFile}
            onClick={handleBegin}
            className="flex-[2] px-6 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 transition-all"
          >
            Begin Session
          </button>
        </div>
      </div>
    </div>
  );
};


export default App;