"use client";

import { useState } from "react";
import { RatesManager } from "@/app/(dashboard)/organisation-edit-dialog-rates";
import type { Rate } from "@/app/(dashboard)/rates-actions";

// CLE-191 — Thin client wrapper around the existing RatesManager so it
// can live as a full-page route. The manager owns its own CRUD via
// server actions; we just hold the list in state so its
// `onRatesChange` callback has somewhere to land.

export function RatesPageClient({ initialRates }: { initialRates: Rate[] }) {
  const [rates, setRates] = useState<Rate[]>(initialRates);
  return <RatesManager rates={rates} onRatesChange={setRates} />;
}
