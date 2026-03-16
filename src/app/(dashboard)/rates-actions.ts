"use server";

import { createClient } from "@/lib/supabase/server";

export interface Rate {
  id: string;
  name: string;
  rate_multiplier: number;
  sort_order: number;
}

async function getCallerMember(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .single();
  return member ?? null;
}

export async function getRates(): Promise<Rate[]> {
  const supabase = await createClient();
  const member = await getCallerMember(supabase);
  if (!member) return [];

  const { data } = await supabase
    .from("rates")
    .select("id, name, rate_multiplier, sort_order")
    .eq("organisation_id", member.organisation_id)
    .order("sort_order");

  return data ?? [];
}

export async function createRate(
  name: string,
  rateMultiplier: number
): Promise<{ success: boolean; error?: string; rate?: Rate }> {
  const supabase = await createClient();
  const member = await getCallerMember(supabase);
  if (!member) return { success: false, error: "Not authenticated" };
  if (member.role !== "owner") return { success: false, error: "Only the owner can manage rates" };

  const { data: existing } = await supabase
    .from("rates")
    .select("sort_order")
    .eq("organisation_id", member.organisation_id)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  const { data, error } = await supabase
    .from("rates")
    .insert({
      organisation_id: member.organisation_id,
      name: name.trim(),
      rate_multiplier: rateMultiplier,
      sort_order: nextOrder,
    })
    .select("id, name, rate_multiplier, sort_order")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, rate: data };
}

export async function updateRate(
  id: string,
  name: string,
  rateMultiplier: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const member = await getCallerMember(supabase);
  if (!member) return { success: false, error: "Not authenticated" };
  if (member.role !== "owner") return { success: false, error: "Only the owner can manage rates" };

  const { error } = await supabase
    .from("rates")
    .update({ name: name.trim(), rate_multiplier: rateMultiplier })
    .eq("id", id)
    .eq("organisation_id", member.organisation_id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteRate(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const member = await getCallerMember(supabase);
  if (!member) return { success: false, error: "Not authenticated" };
  if (member.role !== "owner") return { success: false, error: "Only the owner can manage rates" };

  const { error } = await supabase
    .from("rates")
    .delete()
    .eq("id", id)
    .eq("organisation_id", member.organisation_id);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function reorderRates(
  ids: string[]
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const member = await getCallerMember(supabase);
  if (!member) return { success: false, error: "Not authenticated" };
  if (member.role !== "owner") return { success: false, error: "Only the owner can manage rates" };

  await Promise.all(
    ids.map((id, i) =>
      supabase
        .from("rates")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("organisation_id", member.organisation_id)
    )
  );

  return { success: true };
}
