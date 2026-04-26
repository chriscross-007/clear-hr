"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConversationMessage = {
  id: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  author: {
    memberId: string;
    firstName: string;
    lastName: string;
    /** 'admin' | 'owner' | 'employee' */
    role: string;
  };
  documents: {
    id: string;
    fileName: string;
    contentType: string;
    fileSize: number;
  }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function getCallerMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("No membership found");

  return { supabase, member };
}

// ---------------------------------------------------------------------------
// uploadDocumentToMessage — attaches a file to a conversation message and
// records it in member_documents. The member-documents storage bucket is
// fully private; everything goes via the service-role admin client so we
// can enforce org-scoping in code rather than relying on storage RLS.
// ---------------------------------------------------------------------------

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

export async function uploadDocumentToMessage(
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const { member: caller } = await getCallerMember();

    const file = formData.get("file") as File | null;
    const conversationMessageId = formData.get("conversationMessageId") as string | null;
    const memberId = formData.get("memberId") as string | null;

    if (!file || file.size === 0) return { success: false, error: "No file provided" };
    if (!conversationMessageId) return { success: false, error: "conversationMessageId required" };
    if (!memberId) return { success: false, error: "memberId required" };

    if (file.size > MAX_DOCUMENT_SIZE) {
      return { success: false, error: "File must be 10MB or smaller" };
    }
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return { success: false, error: "Unsupported file type" };
    }

    const admin = getAdminClient();

    // 1. Verify the message exists in the caller's org. Joining to
    //    conversations gives us the org_id check in a single query.
    const { data: messageRow } = await admin
      .from("conversation_messages")
      .select("id, conversations!inner(organisation_id)")
      .eq("id", conversationMessageId)
      .eq("conversations.organisation_id", caller.organisation_id)
      .single();
    if (!messageRow) return { success: false, error: "Message not found" };

    // 2. Target member must be in the same org.
    const { data: targetMember } = await admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!targetMember) return { success: false, error: "Member not found" };

    // 3. Employees can only upload documents for themselves.
    if (caller.role === "employee" && memberId !== caller.id) {
      return { success: false, error: "Not authorised" };
    }

    // 4. Upload the file. Path is org-scoped so admin bucket browsing in
    //    the Supabase dashboard stays organised by tenant.
    const path = `${caller.organisation_id}/${memberId}/absence_attachment/${Date.now()}_${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("member-documents")
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    // 5. Record the document in the registry.
    const { data: inserted, error: insertError } = await admin
      .from("member_documents")
      .insert({
        organisation_id: caller.organisation_id,
        member_id: memberId,
        document_type: "absence_attachment",
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
        storage_path: path,
        uploaded_by_member_id: caller.id,
        conversation_message_id: conversationMessageId,
      })
      .select("id")
      .single();
    if (insertError) return { success: false, error: insertError.message };

    return { success: true, documentId: inserted.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// getDocumentDownloadUrl — issues a 60-second signed URL for a document.
// Access is gated by the caller's RLS on member_documents (employees see
// only their own; admins/owners see all in their org). If the row isn't
// returned, the caller doesn't have access and we error.
// ---------------------------------------------------------------------------

export async function getDocumentDownloadUrl(
  documentId: string,
): Promise<{ success: boolean; error?: string; url?: string; fileName?: string }> {
  try {
    const { supabase } = await getCallerMember();

    const { data: doc } = await supabase
      .from("member_documents")
      .select("id, storage_path, file_name")
      .eq("id", documentId)
      .single();
    if (!doc) return { success: false, error: "Document not found" };

    const admin = getAdminClient();
    const { data, error } = await admin.storage
      .from("member-documents")
      .createSignedUrl(doc.storage_path as string, 60);
    if (error || !data) {
      return { success: false, error: error?.message ?? "Could not create download link" };
    }

    return { success: true, url: data.signedUrl, fileName: doc.file_name as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// getOrCreateBookingConversation — admin/owner only. Returns the existing
// conversation for an absence_booking, creating one on first call.
// ---------------------------------------------------------------------------

export async function getOrCreateBookingConversation(
  bookingId: string,
): Promise<{ success: boolean; error?: string; conversationId?: string }> {
  try {
    const { member: caller } = await getCallerMember();
    if (caller.role !== "owner" && caller.role !== "admin") {
      return { success: false, error: "Not authorised" };
    }

    const admin = getAdminClient();

    // Already exists?
    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("entity_type", "absence_booking")
      .eq("entity_id", bookingId)
      .maybeSingle();
    if (existing) return { success: true, conversationId: existing.id as string };

    // Otherwise create one. Verify the booking is in the caller's org first.
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id, organisation_id")
      .eq("id", bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!booking) return { success: false, error: "Booking not found" };

    const { data: created, error: insertError } = await admin
      .from("conversations")
      .insert({
        organisation_id: booking.organisation_id,
        entity_type: "absence_booking",
        entity_id: bookingId,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return { success: false, error: insertError?.message ?? "Could not create conversation" };
    }
    return { success: true, conversationId: created.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// getConversationMessages — uses the caller's RLS-scoped client to fetch
// the message thread, joining authors and any attached documents.
// ---------------------------------------------------------------------------

export async function getConversationMessages(
  conversationId: string,
): Promise<{ success: boolean; error?: string; messages?: ConversationMessage[] }> {
  try {
    const { supabase } = await getCallerMember();

    // Pull messages + author info via the RLS-scoped client.
    const { data: rows, error: messagesError } = await supabase
      .from("conversation_messages")
      .select("id, body, created_at, author_member_id, members:author_member_id(first_name, last_name, role)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (messagesError) return { success: false, error: messagesError.message };

    const messageIds = (rows ?? []).map((r) => r.id as string);

    // Documents attached to any of those messages — same RLS client.
    const { data: docs } = messageIds.length > 0
      ? await supabase
          .from("member_documents")
          .select("id, conversation_message_id, file_name, content_type, file_size")
          .in("conversation_message_id", messageIds)
      : { data: [] as Array<{ id: string; conversation_message_id: string; file_name: string; content_type: string; file_size: number }> };

    const docsByMessage = new Map<string, ConversationMessage["documents"]>();
    for (const d of docs ?? []) {
      const list = docsByMessage.get(d.conversation_message_id as string) ?? [];
      list.push({
        id: d.id as string,
        fileName: d.file_name as string,
        contentType: d.content_type as string,
        fileSize: d.file_size as number,
      });
      docsByMessage.set(d.conversation_message_id as string, list);
    }

    const messages: ConversationMessage[] = (rows ?? []).map((r) => {
      const author = r.members as unknown as { first_name: string; last_name: string; role: string } | null;
      return {
        id: r.id as string,
        body: r.body as string,
        createdAt: r.created_at as string,
        author: {
          memberId: r.author_member_id as string,
          firstName: author?.first_name ?? "",
          lastName: author?.last_name ?? "",
          role: author?.role ?? "employee",
        },
        documents: docsByMessage.get(r.id as string) ?? [],
      };
    });

    return { success: true, messages };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// sendConversationMessage — inserts via the admin client (RLS doesn't gate
// because the caller is already verified org-side via getCallerMember).
// Returns the full message shape so the client can append it directly.
// ---------------------------------------------------------------------------

export async function sendConversationMessage(
  conversationId: string,
  body: string,
): Promise<{ success: boolean; error?: string; message?: ConversationMessage }> {
  try {
    const { member: caller } = await getCallerMember();
    if (!body || !body.trim()) return { success: false, error: "Message cannot be empty" };

    const admin = getAdminClient();

    // Verify the conversation is in the caller's org.
    const { data: conv } = await admin
      .from("conversations")
      .select("id, organisation_id")
      .eq("id", conversationId)
      .single();
    if (!conv || conv.organisation_id !== caller.organisation_id) {
      return { success: false, error: "Conversation not found" };
    }

    const { data: inserted, error: insertError } = await admin
      .from("conversation_messages")
      .insert({
        conversation_id: conversationId,
        author_member_id: caller.id,
        body: body.trim(),
      })
      .select("id, body, created_at")
      .single();
    if (insertError || !inserted) {
      return { success: false, error: insertError?.message ?? "Could not send message" };
    }

    // Pull the author's name/role for the returned shape.
    const { data: authorRow } = await admin
      .from("members")
      .select("first_name, last_name, role")
      .eq("id", caller.id)
      .single();

    const message: ConversationMessage = {
      id: inserted.id as string,
      body: inserted.body as string,
      createdAt: inserted.created_at as string,
      author: {
        memberId: caller.id,
        firstName: (authorRow?.first_name as string) ?? "",
        lastName: (authorRow?.last_name as string) ?? "",
        role: (authorRow?.role as string) ?? caller.role,
      },
      documents: [],
    };
    return { success: true, message };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
