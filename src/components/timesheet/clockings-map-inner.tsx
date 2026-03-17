"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapClocking } from "@/app/(dashboard)/timesheets/actions";

// ---- helpers -----------------------------------------------------------

function typeHex(c: MapClocking): string {
  const t = (c.inferredType ?? c.rawType ?? "").toUpperCase();
  if (t === "IN" || t === "BSTART") return "#16a34a";
  if (t === "OUT") return "#dc2626";
  if (t.includes("BRK_OUT") || t.includes("BREAKOUT")) return "#d97706";
  if (t.includes("BRK_IN")  || t.includes("BREAKIN"))  return "#2563eb";
  return "#6b7280";
}

function formatUtcTime(iso: string): string {
  return iso.slice(11, 16) + " UTC";
}

function typeLabel(c: MapClocking): string {
  return (c.inferredType ?? c.rawType ?? "?").toUpperCase();
}

function makeIcon(index: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      background:${color};color:#fff;border-radius:50%;
      width:28px;height:28px;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
      border:2px solid #fff;
    ">${index}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// ---- auto-fit ----------------------------------------------------------

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] });
    }
  }, [map, positions]);
  return null;
}

// ---- main component ----------------------------------------------------

export function ClockingsMapInner({ clockings }: { clockings: MapClocking[] }) {
  const withCoords = clockings.filter(
    (c) => c.latitude !== null && c.longitude !== null
  );
  const positions = withCoords.map((c) => [c.latitude!, c.longitude!] as [number, number]);
  const defaultCenter: [number, number] = positions[0] ?? [51.505, -0.09];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={14}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {positions.length > 0 && <FitBounds positions={positions} />}

      {withCoords.map((c) => {
        const legendNum = clockings.indexOf(c) + 1;
        return (
        <Marker
          key={c.id}
          position={[c.latitude!, c.longitude!]}
          icon={makeIcon(legendNum, typeHex(c))}
        >
          <Popup>
            <div style={{ fontSize: 12 }}>
              <strong>{legendNum}. {formatUtcTime(c.clockedAt)} — {typeLabel(c)}</strong>
              <br />
              <span style={{ color: "#6b7280" }}>
                {c.latitude!.toFixed(6)}, {c.longitude!.toFixed(6)}
              </span>
            </div>
          </Popup>
        </Marker>
        );
      })}
    </MapContainer>
  );
}
