import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set([
  "https://reachframe.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(origin: string | null) {
  const allowOrigin = origin && (allowedOrigins.has(origin) ||
    /^https:\/\/reachframe-git-[a-z0-9-]+-just-building1\.vercel\.app$/.test(origin))
    ? origin
    : "https://reachframe.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

function keyFromMap(name: string): string | null {
  try {
    const value = JSON.parse(Deno.env.get(name) || "{}");
    const key = value.default || Object.values(value)[0];
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || keyFromMap("SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") || keyFromMap("SUPABASE_SECRET_KEYS");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return json({ error: "Account deletion is not configured." }, 503, headers);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Sign in before deleting your account." }, 401, headers);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "A deletion confirmation is required." }, 400, headers);
  }
  if (body.confirmation !== "DELETE") {
    return json({ error: "Type DELETE to confirm account removal." }, 400, headers);
  }

  const verifiedUser = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
  });
  if (!verifiedUser.ok) return json({ error: "Your session could not be verified." }, 401, headers);
  const user = await verifiedUser.json();
  if (!user?.id) return json({ error: "Your account could not be verified." }, 401, headers);

  const adminHeaders: Record<string, string> = {
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  if (serviceKey.split(".").length === 3) adminHeaders.Authorization = `Bearer ${serviceKey}`;

  const deletion = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
    { method: "DELETE", headers: adminHeaders },
  );
  if (!deletion.ok) {
    console.error("Reachframe account deletion failed", deletion.status);
    return json({ error: "The account could not be deleted. Try again later." }, 502, headers);
  }

  return json({ deleted: true }, 200, headers);
});
