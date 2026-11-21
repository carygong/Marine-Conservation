import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AnalysisResult,
  ClusterAlert,
  QueuedOfflineSighting,
  Sighting,
  SpeciesSafetyRule,
} from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';
import { compressImageToJpeg, saveOfflineSighting } from '../utils/offlineQueue';
import { useOnlineStatus } from '../utils/pwa';
import { SpotPickerMap } from './ConservationMap';

interface ReportSightingModalProps {
  open: boolean;
  onClose: () => void;
  contributorId: string;
  contributorName: string;
  onContributorChange: (name: string) => void;
  simulatedOffline: boolean;
  onSightingSubmitted: (payload: {
    sighting: Sighting;
    safetyRule: SpeciesSafetyRule;
    merged: boolean;
    alertedOrgName?: string;
    dispatchDistanceKm?: number;
    clusterAlerts?: ClusterAlert[];
  }) => void;
  onQueuedOffline: (item: QueuedOfflineSighting) => void;
  locale: Locale;
}

export const ReportSightingModal: React.FC<ReportSightingModalProps> = ({
  open,
  onClose,
  contributorId,
  contributorName,
  onContributorChange,
  simulatedOffline,
  onSightingSubmitted,
  onQueuedOffline,
  locale,
}) => {
  const realOnline = useOnlineStatus();
  const isOffline = !realOnline || simulatedOffline;
  const t = TRANSLATIONS[locale];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string>('');
  const [lat, setLat] = useState<number>(36.6805);
  const [lng, setLng] = useState<number>(-121.922);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'locating' | 'locked' | 'missing'>('idle');
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [timestamp, setTimestamp] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState<string>('');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setTimestamp(new Date().toISOString().slice(0, 16));

    if ('geolocation' in navigator && gpsStatus === 'idle') {
      setGpsStatus('locating');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(Number(pos.coords.latitude.toFixed(5)));
          setLng(Number(pos.coords.longitude.toFixed(5)));
          setGpsStatus('locked');
        },
        () => {
          setGpsStatus('missing');
          setShowMapPicker(true);
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  }, [open, gpsStatus]);

  if (!open) return null;

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setAnalysis(null);
    try {
      const compressed = await compressImageToJpeg(file, 1280);
      setPhotoDataUrl(compressed);
      if (file.lastModified) {
        setTimestamp(new Date(file.lastModified).toISOString().slice(0, 16));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to read image.');
    }
  };

  const handleRequestGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('missing');
      setShowMapPicker(true);
      return;
    }
    setGpsStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(Number(pos.coords.latitude.toFixed(5)));
        setLng(Number(pos.coords.longitude.toFixed(5)));
        setGpsStatus('locked');
        setShowMapPicker(false);
      },
      () => {
        setGpsStatus('missing');
        setShowMapPicker(true);
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handleAnalyzeAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoDataUrl) {
      setErrorMsg('Please upload or capture a marine wildlife photo first.');
      return;
    }
    setErrorMsg(null);

    const isoTimestamp = new Date(timestamp).toISOString();

    // Offline Capture Flow (Phase 4)
    if (isOffline) {
      const item: QueuedOfflineSighting = {
        localId: `offline-${Date.now().toString(36)}`,
        photoDataUrl,
        lat,
        lng,
        timestamp: isoTimestamp,
        notes,
        contributorId,
        contributorName,
        createdAt: new Date().toISOString(),
      };
      await saveOfflineSighting(item);
      onQueuedOffline(item);
      resetAndClose();
      return;
    }

    // Online AI Triage + Submission Flow (Phase 1 & 2)
    try {
      setAnalyzing(true);
      const analyzeRes = await fetch('/api/analyze-sighting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photoDataUrl,
          mimeType: 'image/jpeg',
          notes,
        }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok) {
        throw new Error(analyzeData.error || 'AI analysis failed');
      }
      setAnalysis(analyzeData.analysis);
      setAnalyzing(false);

      setSubmitting(true);
      const submitRes = await fetch('/api/sightings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photoDataUrl,
          mimeType: 'image/jpeg',
          lat,
          lng,
          timestamp: isoTimestamp,
          contributorId,
          contributorName,
          notes,
          analysis: analyzeData.analysis,
        }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(submitData.error || 'Failed to save sighting');
      }

      onSightingSubmitted({
        sighting: submitData.sighting,
        safetyRule: submitData.safetyRule,
        merged: Boolean(submitData.merged),
        alertedOrgName: submitData.alertedOrgName,
        dispatchDistanceKm: submitData.rescueDispatchDistanceKm,
        clusterAlerts: submitData.clusterAlerts,
      });
      resetAndClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setAnalyzing(false);
      setSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setPhotoDataUrl('');
    setNotes('');
    setAnalysis(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-cyan-700" />
            <h2 className="text-base font-semibold text-slate-900">{t.reportSighting}</h2>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleAnalyzeAndSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Photo Drop / Camera Capture */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              {t.uploadPhoto}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFileSelected(e.target.files?.[0])}
            />
            {photoDataUrl ? (
              <div className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
                <img
                  src={photoDataUrl}
                  alt="Uploaded wildlife preview"
                  className="w-full max-h-64 object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-3 right-3 rounded-md bg-slate-900/85 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
                >
                  Change Photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileSelected(e.dataTransfer.files?.[0]);
                }}
                className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100/80 hover:border-cyan-600 transition-colors p-8 text-center"
              >
                <Upload className="w-7 h-7 text-cyan-700 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-800">{t.dragDropPhoto}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Supports seals, whales, dolphins, sea turtles, and seabirds (JPEG, PNG, WebP)
                </p>
              </button>
            )}
          </div>

          {/* GPS & Time Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Location Coordinates (GPS or Map Spot)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRequestGps}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <MapPin className="w-3.5 h-3.5 text-cyan-700" />
                  {gpsStatus === 'locating' ? 'Locating...' : t.gpsAuto}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMapPicker((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    showMapPicker
                      ? 'border-cyan-700 bg-cyan-50 text-cyan-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {t.pickOnMap}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs font-mono text-slate-600 tabular-nums">
                {gpsStatus === 'locked' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                <span>
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </span>
                {gpsStatus === 'missing' && (
                  <span className="font-sans text-amber-700">(GPS missing — click map below)</span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Observation Timestamp
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="datetime-local"
                  value={timestamp}
                  onChange={(e) => setTimestamp(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                />
              </div>
            </div>
          </div>

          {/* Interactive Map Spot Picker when GPS missing or toggled */}
          {showMapPicker && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Click anywhere along the coastline to set exact sighting coordinates:</span>
                <span className="font-mono text-cyan-800 tabular-nums">
                  {lat.toFixed(4)}, {lng.toFixed(4)}
                </span>
              </div>
              <SpotPickerMap
                lat={lat}
                lng={lng}
                onChange={(newLat, newLng) => {
                  setLat(newLat);
                  setLng(newLng);
                  setGpsStatus('locked');
                }}
              />
            </div>
          )}

          {/* Observer Name & Field Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Observer Name (for Logbook & Badges)
              </label>
              <input
                type="text"
                value={contributorName}
                onChange={(e) => onContributorChange(e.target.value)}
                placeholder="Your name or handle"
                maxLength={60}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Field Notes (optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Trailing yellow line, resting on rocks..."
                maxLength={300}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
              />
            </div>
          </div>

          {analysis && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              AI detected <strong>{analysis.commonName}</strong> ({analysis.classification}, {analysis.confidence}% confidence).
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              Sensitive rookeries & nesting beaches are automatically masked on public maps.
            </p>
            <button
              type="submit"
              disabled={analyzing || submitting || !photoDataUrl}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {isOffline ? (
                <>
                  <WifiOff className="w-4 h-4" />
                  {t.saveOffline}
                </>
              ) : analyzing || submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {analyzing ? t.analyzing : 'Submitting...'}
                </>
              ) : (
                t.analyzeAndSubmit
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
