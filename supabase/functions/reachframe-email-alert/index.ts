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

function restHeaders(key: string) {
  return {
    apikey: key,
    ...(key.split(".").length === 3 ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
  };
}

const labels: Record<string, string> = {
  suggestions: "Account suggestions",
  search: "Post search visibility",
  thread: "Reply presence",
  placement: "Reply placement",
};

const measured = (value: unknown) => value === "visible" || value === "missing";

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || keyFromMap("SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") || keyFromMap("SUPABASE_SECRET_KEYS");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return json({ error: "Email alerts are not configured." }, 503, headers);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in to use email alerts." }, 401, headers);
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json({ error: "Your session could not be verified." }, 401, headers);
  const user = await userResponse.json();
  if (!user?.id || !user?.email) return json({ error: "Your account has no email address." }, 400, headers);

  let scanId: string;
  try {
    const body = await request.json();
    scanId = String(body?.scanId || "");
  } catch {
    return json({ error: "A saved report ID is required." }, 400, headers);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(scanId)) {
    return json({ error: "The saved report ID is invalid." }, 400, headers);
  }

  const adminHeaders = restHeaders(serviceKey);
  const query = async (table: string, params: Record<string, string>) => {
    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: adminHeaders });
    if (!response.ok) throw new Error(`Database read failed (${response.status}).`);
    return await response.json();
  };
  const updateDelivery = async (status: "pending" | "sent" | "failed") => {
    const url = new URL(`${supabaseUrl}/rest/v1/reachframe_notification_deliveries`);
    url.searchParams.set("scan_id", `eq.${scanId}`);
    url.searchParams.set("user_id", `eq.${user.id}`);
    const response = await fetch(url, {
      method: "PATCH",
      headers: { ...adminHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status, sent_at: status === "sent" ? new Date().toISOString() : null }),
    });
    if (!response.ok) throw new Error(`Delivery status update failed (${response.status}).`);
  };

  try {
    const scans = await query("reachframe_scans", {
      select: "id,user_id,handle,checked_at,results",
      id: `eq.${scanId}`,
      user_id: `eq.${user.id}`,
      limit: "1",
    });
    const scan = scans[0];
    if (!scan) return json({ error: "Saved report not found." }, 404, headers);

    const preferences = await query("reachframe_notification_preferences", {
      select: "email_observation_changes",
      user_id: `eq.${user.id}`,
      limit: "1",
    });
    if (!preferences[0]?.email_observation_changes) {
      return json({ sent: false, reason: "email_alerts_disabled" }, 200, headers);
    }

    const previousRows = await query("reachframe_scans", {
      select: "results",
      user_id: `eq.${user.id}`,
      handle: `eq.${scan.handle}`,
      evidence_source: "eq.guided",
      checked_at: `lt.${scan.checked_at}`,
      order: "checked_at.desc,id.desc",
      limit: "1",
    });
    const previous = previousRows[0]?.results || {};
    const changes = Object.keys(labels)
      .filter((key) => measured(previous[key]?.status) && measured(scan.results[key]?.status) &&
        previous[key].status !== scan.results[key].status)
      .map((key) => `${labels[key]}: ${previous[key].status === "visible" ? "Visible" : "Missing from view"} → ${scan.results[key].status === "visible" ? "Visible" : "Missing from view"}`);
    if (!changes.length) return json({ sent: false, reason: "no_measured_change" }, 200, headers);
    if (!resendKey) return json({ sent: false, reason: "email_provider_not_configured" }, 200, headers);

    const priorDelivery = await query("reachframe_notification_deliveries", {
      select: "status",
      scan_id: `eq.${scanId}`,
      user_id: `eq.${user.id}`,
      limit: "1",
    });
    if (priorDelivery[0]?.status === "sent" || priorDelivery[0]?.status === "pending") {
      return json({ sent: false, reason: "already_processed" }, 200, headers);
    }
    if (priorDelivery[0]?.status === "failed") {
      const retryUrl = new URL(`${supabaseUrl}/rest/v1/reachframe_notification_deliveries`);
      retryUrl.searchParams.set("scan_id", `eq.${scanId}`);
      retryUrl.searchParams.set("user_id", `eq.${user.id}`);
      retryUrl.searchParams.set("status", "eq.failed");
      const retryResponse = await fetch(retryUrl, {
        method: "PATCH",
        headers: { ...adminHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ status: "pending", sent_at: null }),
      });
      if (!retryResponse.ok) throw new Error(`Could not retry email delivery (${retryResponse.status}).`);
      if (!(await retryResponse.json()).length) return json({ sent: false, reason: "already_processed" }, 200, headers);
    } else {
      const deliveryUrl = new URL(`${supabaseUrl}/rest/v1/reachframe_notification_deliveries`);
      deliveryUrl.searchParams.set("on_conflict", "scan_id");
      const deliveryResponse = await fetch(deliveryUrl, {
        method: "POST",
        headers: { ...adminHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ scan_id: scanId, user_id: user.id, status: "pending" }),
      });
      if (!deliveryResponse.ok) throw new Error(`Could not record email delivery (${deliveryResponse.status}).`);
      if (!(await deliveryResponse.json()).length) return json({ sent: false, reason: "already_processed" }, 200, headers);
    }

    const from = Deno.env.get("REACHFRAME_FROM_EMAIL") || "Reachframe Alerts <alerts@tidelight.app>";
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: `Visibility observation changed for @${scan.handle}`,
        text: [
          `A new guided observation for @${scan.handle} changed a measured surface.`,
          "",
          ...changes,
          "",
          "This alert reflects observations entered by you; Reachframe did not run an automated X check or infer an X enforcement decision.",
          "",
          "Open your private Reachframe history: https://reachframe.vercel.app/#history",
        ].join("\n"),
        tags: [{ name: "product", value: "reachframe" }, { name: "type", value: "observation-change" }],
      }),
    });
    if (!sent.ok) {
      await updateDelivery("failed");
      return json({ sent: false, reason: "email_provider_rejected" }, 502, headers);
    }
    await updateDelivery("sent");
    return json({ sent: true, changes: changes.length }, 200, headers);
  } catch (error) {
    console.error("Reachframe email alert failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The email alert could not be processed." }, 500, headers);
  }
});
