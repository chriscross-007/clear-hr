import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  if (!memberId) return NextResponse.redirect(`${origin}/employees`);

  // Verify caller is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: callerMembership } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!callerMembership) return NextResponse.redirect(`${origin}/employees`);

  const admin = createAdminClient();

  // Target member must be in same org and have accepted their invite
  const { data: member } = await admin
    .from("members")
    .select("email")
    .eq("id", memberId)
    .eq("organisation_id", callerMembership.organisation_id)
    .not("user_id", "is", null)
    .single();

  if (!member) return NextResponse.redirect(`${origin}/employees`);

  // Generate a magic link — gives us a hashed_token we can verify server-side
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: member.email,
  });

  if (linkError || !linkData) return NextResponse.redirect(`${origin}/employees`);

  // Verify the OTP server-side using the hashed token.
  // This bypasses PKCE (no code_verifier needed) and sets the session
  // cookie for the target user via the SSR client's cookie handler.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyError) {
    console.error("Switch account verify error:", verifyError.message);
    return NextResponse.redirect(`${origin}/employees`);
  }

  return NextResponse.redirect(`${origin}/employees`);
}
