"use client";

// CLE-236 — Draw-your-signature pad. Mouse, pen and finger (pointer
// events). `onChange` receives a trimmed PNG data URL, or null when the
// pad is empty. Ink is always dark on a transparent background so the
// stamped signature page reads the same in every theme.

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

const INK = "#1a2466";

export function SignaturePad({ onChange, disabled }: { onChange: (png: string | null) => void; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the element (and device pixel ratio).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = INK;
    }
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** Crop to the drawn area (+ padding) and export. */
  const exportPng = useCallback((): string | null => {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const pad = 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement("canvas");
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext("2d")?.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  }, []);

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const p = point(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    setEmpty(false);
    onChange(exportPng());
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-md border bg-white">
        <canvas
          ref={canvasRef}
          className="block h-40 w-full touch-none cursor-crosshair"
          aria-label="Signature pad — draw your signature"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            Draw your signature here
          </span>
        )}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-dashed border-zinc-300" />
      </div>
      <Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled || empty}>
        <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear
      </Button>
    </div>
  );
}
