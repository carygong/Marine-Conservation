import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useApiLoadingStatus,
  APILoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Lock,
  MapPin,
  Navigation,
  ShieldAlert,
} from 'lucide-react';
import type { ClusterAlert, HazardZone, IndividualAnimal, Sighting } from '../types';
import { TRANSLATIONS, type Locale } from '../i18n';

interface ConservationMapProps {
  sightings: Sighting[];
  hazards: HazardZone[];
  clusterAlerts: ClusterAlert[];
  individuals: IndividualAnimal[];
  selectedSightingId: string | null;
  onSelectSighting: (sighting: Sighting | null) => void;
  showHeatmap: boolean;
  heatmapWindow: 'all' | '90d' | '30d' | '7d';
  showHazards: boolean;
  activeIndividualId: string | null;
  onSelectIndividual: (id: string | null) => void;
  onOpenSafety: (sighting: Sighting) => void;
  locale: Locale;
  focusCoords?: { lat: number; lng: number } | null;
}

const SightingMarkerItem: React.FC<{
  sighting: Sighting;
  isSelected: boolean;
  onSelect: (sighting: Sighting) => void;
}> = ({ sighting, isSelected, onSelect }) => {
  const isRescue = sighting.classification === 'Possible rescue case';
  return (
    <AdvancedMarker
      position={{ lat: sighting.lat, lng: sighting.lng }}
      onClick={() => onSelect(sighting)}
      title={`${sighting.commonName} — ${sighting.classification}`}
      zIndex={isSelected ? 50 : isRescue ? 30 : 10}
    >
      <Pin
        background={isRescue ? '#DC2626' : '#059669'}
        borderColor={isRescue ? '#7F1D1D' : '#065F46'}
        glyphColor="#FFFFFF"
        scale={isSelected ? 1.25 : 1.0}
      />
    </AdvancedMarker>
  );
};

// Imperative Google Maps overlays: sensitive buffers, hazard zones, cluster rings, migration tracks, and Canvas heatmap
const MapVectorOverlays: React.FC<{
  sightings: Sighting[];
  hazards: HazardZone[];
  clusterAlerts: ClusterAlert[];
  showHeatmap: boolean;
  heatmapWindow: 'all' | '90d' | '30d' | '7d';
  showHazards: boolean;
  activeIndividualId: string | null;
  onHazardClick: (hazard: HazardZone) => void;
  focusCoords?: { lat: number; lng: number } | null;
}> = ({
  sightings,
  hazards,
  clusterAlerts,
  showHeatmap,
  heatmapWindow,
  showHazards,
  activeIndividualId,
  onHazardClick,
  focusCoords,
}) => {
  const map = useMap();

  useEffect(() => {
    if (!map || !focusCoords) return;
    map.panTo(focusCoords);
    if ((map.getZoom() ?? 6) < 10) {
      map.setZoom(10);
    }
  }, [map, focusCoords]);

  // Sensitive buffer circles + cluster alert rings
  useEffect(() => {
    if (!map || typeof google === 'undefined') return;
    const shapes: google.maps.Circle[] = [];

    for (const s of sightings) {
      if (!s.isSensitiveSite) continue;
      const circle = new google.maps.Circle({
        map,
        center: { lat: s.lat, lng: s.lng },
        radius: 2200,
        strokeColor: '#D97706',
        strokeOpacity: 0.75,
        strokeWeight: 1.5,
        fillColor: '#F59E0B',
        fillOpacity: 0.14,
        clickable: false,
      });
      shapes.push(circle);
    }

    for (const alert of clusterAlerts) {
      const ring = new google.maps.Circle({
        map,
        center: { lat: alert.centerLat, lng: alert.centerLng },
        radius: alert.radiusKm * 1000,
        strokeColor: '#DC2626',
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: '#EF4444',
        fillOpacity: 0.08,
        clickable: false,
      });
      shapes.push(ring);
    }

    return () => {
      shapes.forEach((c) => c.setMap(null));
    };
  }, [map, sightings, clusterAlerts]);

  // Hazard layer (Boat Traffic, Fishing Zones, Pollution Areas)
  useEffect(() => {
    if (!map || !showHazards || typeof google === 'undefined') return;
    const overlays: Array<google.maps.Polygon | google.maps.Polyline> = [];

    const colorByType: Record<HazardZone['type'], { stroke: string; fill: string }> = {
      boat_traffic: { stroke: '#D97706', fill: '#F59E0B' },
      fishing_zone: { stroke: '#EA580C', fill: '#FB923C' },
      pollution_area: { stroke: '#7C3AED', fill: '#8B5CF6' },
    };

    for (const haz of hazards) {
      const colors = colorByType[haz.type];
      if (haz.geometryType === 'polyline') {
        const line = new google.maps.Polyline({
          map,
          path: haz.coordinates,
          strokeColor: colors.stroke,
          strokeOpacity: 0.9,
          strokeWeight: 4,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                scale: 3,
                strokeColor: colors.stroke,
              },
              offset: '50%',
              repeat: '120px',
            },
          ],
        });
        line.addListener('click', () => onHazardClick(haz));
        overlays.push(line);
      } else {
        const poly = new google.maps.Polygon({
          map,
          paths: haz.coordinates,
          strokeColor: colors.stroke,
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: colors.fill,
          fillOpacity: 0.22,
        });
        poly.addListener('click', () => onHazardClick(haz));
        overlays.push(poly);
      }
    }

    return () => {
      overlays.forEach((o) => o.setMap(null));
    };
  }, [map, hazards, showHazards, onHazardClick]);

  // Individual migration track polyline
  useEffect(() => {
    if (!map || !activeIndividualId || typeof google === 'undefined') return;
    const trackSightings = sightings
      .filter((s) => s.individualId === activeIndividualId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (trackSightings.length < 2) return;

    const path = trackSightings.map((s) => ({ lat: s.lat, lng: s.lng }));
    const line = new google.maps.Polyline({
      map,
      path,
      strokeColor: '#0891B2',
      strokeOpacity: 0,
      strokeWeight: 3,
      icons: [
        {
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            strokeColor: '#0891B2',
            scale: 3,
          },
          offset: '0',
          repeat: '14px',
        },
      ],
    });

    return () => {
      line.setMap(null);
    };
  }, [map, sightings, activeIndividualId]);

  // Custom Canvas OverlayView Heatmap for injuries & entanglements (no WebGL dependency, no legacy HeatmapLayer)
  useEffect(() => {
    if (!map || !showHeatmap || typeof google === 'undefined') return;

    const now = Date.now();
    const windowDays =
      heatmapWindow === '7d' ? 7 : heatmapWindow === '30d' ? 30 : heatmapWindow === '90d' ? 90 : 9999;

    const rescuePoints = sightings.filter((s) => {
      if (s.classification !== 'Possible rescue case') return false;
      const ageDays = (now - new Date(s.timestamp).getTime()) / 86400000;
      return ageDays <= windowDays;
    });

    class InjuryHeatOverlay extends google.maps.OverlayView {
      private canvas: HTMLCanvasElement | null = null;

      onAdd() {
        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        this.canvas = canvas;
        const panes = this.getPanes();
        panes?.overlayLayer.appendChild(canvas);
      }

      draw() {
        const canvas = this.canvas;
        const projection = this.getProjection();
        const div = map?.getDiv();
        if (!canvas || !projection || !div) return;

        const w = div.clientWidth || 800;
        const h = div.clientHeight || 600;
        const bounds = map?.getBounds();
        if (!bounds) return;

        const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
        const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
        if (!ne || !sw) return;

        const left = sw.x;
        const top = ne.y;
        const width = Math.max(1, ne.x - sw.x);
        const height = Math.max(1, sw.y - ne.y);

        canvas.style.left = `${left}px`;
        canvas.style.top = `${top}px`;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        const zoom = map?.getZoom() ?? 7;
        const radiusPx = Math.max(28, Math.min(85, zoom * 6.5));

        for (const pt of rescuePoints) {
          const px = projection.fromLatLngToDivPixel(new google.maps.LatLng(pt.lat, pt.lng));
          if (!px) continue;
          const x = px.x - left;
          const y = px.y - top;
          if (x < -radiusPx || x > width + radiusPx || y < -radiusPx || y > height + radiusPx) {
            continue;
          }
          const grad = ctx.createRadialGradient(x, y, 2, x, y, radiusPx);
          grad.addColorStop(0, 'rgba(220, 38, 38, 0.58)');
          grad.addColorStop(0.45, 'rgba(249, 115, 22, 0.34)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      onRemove() {
        if (this.canvas && this.canvas.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
        this.canvas = null;
      }
    }

    const overlay = new InjuryHeatOverlay();
    overlay.setMap(map);

    const idleListener = map.addListener('bounds_changed', () => {
      overlay.draw();
    });

    return () => {
      google.maps.event.removeListener(idleListener);
      overlay.setMap(null);
    };
  }, [map, sightings, showHeatmap, heatmapWindow]);

  return null;
};

export const ConservationMap: React.FC<ConservationMapProps> = ({
  sightings,
  hazards,
  clusterAlerts,
  selectedSightingId,
  onSelectSighting,
  showHeatmap,
  heatmapWindow,
  showHazards,
  activeIndividualId,
  onSelectIndividual,
  onOpenSafety,
  locale,
  focusCoords,
}) => {
  const loadingStatus = useApiLoadingStatus();
  const [selectedHazard, setSelectedHazard] = useState<HazardZone | null>(null);
  const t = TRANSLATIONS[locale];

  const selectedSighting = useMemo(
    () => sightings.find((s) => s.id === selectedSightingId) || null,
    [sightings, selectedSightingId]
  );

  const handleHazardClick = useCallback((h: HazardZone) => {
    setSelectedHazard(h);
  }, []);

  if (loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="h-[580px] w-full rounded-xl border border-slate-200 bg-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <MapPin className="w-8 h-8 text-slate-400 mb-2" />
        <h3 className="text-base font-semibold text-slate-800">Interactive Map Unavailable</h3>
        <p className="mt-1 text-sm text-slate-600 max-w-md">
          Google Maps Platform failed to initialize. Sighting records remain accessible in the side feed and rescue console.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-[580px] w-full rounded-xl border border-slate-200 overflow-hidden bg-slate-100">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat: 36.68, lng: -121.95 }}
        defaultZoom={7}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={true}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
        onClick={() => {
          onSelectSighting(null);
          setSelectedHazard(null);
        }}
      >
        {sightings.map((s) => (
          <SightingMarkerItem
            key={s.id}
            sighting={s}
            isSelected={s.id === selectedSightingId}
            onSelect={(item) => {
              setSelectedHazard(null);
              onSelectSighting(item);
            }}
          />
        ))}

        {selectedSighting && (
          <InfoWindow
            position={{ lat: selectedSighting.lat, lng: selectedSighting.lng }}
            onCloseClick={() => onSelectSighting(null)}
            maxWidth={310}
          >
            <div className="p-1 space-y-2 text-slate-900">
              <div className="aspect-[4/3] w-full rounded-md overflow-hidden bg-slate-100">
                <img
                  src={selectedSighting.photoUrl}
                  alt={selectedSighting.commonName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{selectedSighting.commonName}</span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {selectedSighting.confidence}%
                  </span>
                </div>
                <div className="text-xs italic text-slate-500">{selectedSighting.scientificName}</div>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-medium">
                {selectedSighting.classification === 'Possible rescue case' ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span className="text-red-700">{t.possibleRescue}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">{t.healthySighting}</span>
                  </>
                )}
                {selectedSighting.reportCount > 1 && (
                  <span className="text-slate-500 font-mono">· {selectedSighting.reportCount} reports</span>
                )}
              </div>

              {selectedSighting.isSensitiveSite && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>{t.sensitiveZoneNote}</span>
                </div>
              )}

              <p className="text-xs text-slate-600 leading-snug">{selectedSighting.aiNotes}</p>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => onOpenSafety(selectedSighting)}
                  className="flex-1 inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <ShieldAlert className="w-3 h-3" />
                  Safety Rule
                </button>
                {selectedSighting.individualId && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectIndividual(
                        activeIndividualId === selectedSighting.individualId
                          ? null
                          : selectedSighting.individualId || null
                      )
                    }
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium border ${
                      activeIndividualId === selectedSighting.individualId
                        ? 'bg-cyan-700 text-white border-cyan-700'
                        : 'bg-white text-cyan-800 border-cyan-300 hover:bg-cyan-50'
                    }`}
                  >
                    <Fingerprint className="w-3 h-3" />
                    Track
                  </button>
                )}
              </div>
            </div>
          </InfoWindow>
        )}

        <MapVectorOverlays
          sightings={sightings}
          hazards={hazards}
          clusterAlerts={clusterAlerts}
          showHeatmap={showHeatmap}
          heatmapWindow={heatmapWindow}
          showHazards={showHazards}
          activeIndividualId={activeIndividualId}
          onHazardClick={handleHazardClick}
          focusCoords={focusCoords}
        />
      </GoogleMap>

      {/* Selected Hazard Floating Detail Bar */}
      {selectedHazard && (
        <div className="absolute bottom-4 left-4 right-4 md:right-auto md:max-w-md rounded-lg border border-slate-200 bg-white/95 backdrop-blur-sm p-3.5 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-mono uppercase tracking-wide text-slate-500">
                {selectedHazard.type.replace('_', ' ')} · {selectedHazard.severity} risk
              </div>
              <div className="text-sm font-semibold text-slate-900 mt-0.5">{selectedHazard.name}</div>
              <p className="text-xs text-slate-600 mt-1">{selectedHazard.description}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedHazard(null)}
              className="text-xs text-slate-500 hover:text-slate-900 font-medium px-1.5 py-0.5"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Map Legend Strip */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          {t.healthySighting}
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
          {t.possibleRescue}
        </span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1.5 text-amber-800">
          <Lock className="w-3.5 h-3.5 text-amber-600" />
          Protected Buffer
        </span>
        {activeIndividualId && (
          <>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={() => onSelectIndividual(null)}
              className="inline-flex items-center gap-1 text-cyan-800 font-medium underline"
            >
              <Navigation className="w-3 h-3" />
              Clear Track ({activeIndividualId})
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// Interactive Spot Picker Google Map used inside the Sighting Report Modal when GPS is missing or edited
export const SpotPickerMap: React.FC<{
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}> = ({ lat, lng, onChange }) => {
  const mapRef = useRef<{ lat: number; lng: number }>({ lat, lng });
  mapRef.current = { lat, lng };

  return (
    <div className="h-56 w-full rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        defaultCenter={{ lat, lng }}
        defaultZoom={8}
        gestureHandling="greedy"
        disableDefaultUI={true}
        zoomControl={true}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        style={{ width: '100%', height: '100%' }}
        onClick={(ev) => {
          const ll = ev.detail.latLng;
          if (ll) {
            onChange(Number(ll.lat.toFixed(5)), Number(ll.lng.toFixed(5)));
          }
        }}
      >
        <AdvancedMarker position={{ lat, lng }} title="Selected sighting spot">
          <Pin background="#0E7490" borderColor="#164E63" glyphColor="#FFFFFF" />
        </AdvancedMarker>
      </GoogleMap>
    </div>
  );
};
