"use strict";

function storedTheme() {
  try {
    return localStorage.getItem("reachframe-theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

document.documentElement.dataset.theme = storedTheme();

const $ = (selector) => document.querySelector(selector);
const fields = [
  [
    "suggestions",
    "Account suggestions",
    "Search the exact handle while signed in as a separate viewer. Record the viewer context and time; repeat before treating an absence as a pattern.",
  ],
  [
    "search",
    "Post search visibility",
    "Choose a recent original public post and search a distinctive exact phrase from a separate viewer. If the post itself is unavailable, choose Untestable.",
  ],
  [
    "thread",
    "Reply presence",
    "Open a recent reply’s full parent conversation from a separate viewer. Mark it missing only when the complete thread and expanded replies are available.",
  ],
  [
    "placement",
    "Reply ranking",
    "Compare the default conversation with an alternate or expanded replies view. Ranking can vary by viewer and time.",
  ],
];
const choices = {
  visible: "Visible",
  missing: "Missing from view",
  untestable: "Untestable",
  unknown: "Unmeasured",
};
const isMeasuredStatus = (status) => status === "visible" || status === "missing";
function evidenceConfidence(entry) {
  const checks = [1, 2, 3].includes(Number(entry?.checks)) ? Number(entry.checks) : null;
  const viewers = [1, 2, 3].includes(Number(entry?.viewers)) ? Number(entry.viewers) : null;
  if (!isMeasuredStatus(entry?.status) || (checks === null && viewers === null)) return null;
  const level = checks !== null && checks >= 3 && viewers !== null && viewers >= 2
    ? "Corroborated"
    : (checks !== null && checks >= 2) || (viewers !== null && viewers >= 2)
      ? "Repeated"
      : checks !== null && viewers !== null
        ? "Single observation"
        : "Partial self-report";
  return {
    level,
    checks: checks === 3 ? "3+" : checks === null ? null : String(checks),
    viewers: viewers === 3 ? "3+" : viewers === null ? null : String(viewers),
  };
}
function confidenceLabel(entry) {
  const confidence = evidenceConfidence(entry);
  const labelCount = (value, singular) => value === null ? singular + " count not reported" :
    value === "3+" ? "3+ " + singular + "s" : countLabel(Number(value), singular);
  return confidence ? confidence.level + " · " +
    labelCount(confidence.checks, "check") + " · " +
    labelCount(confidence.viewers, "viewer") : null;
}
let activeHandle;
let state;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

function bringIntoView(element) {
  element.scrollIntoView({
    block: "start",
    behavior: reducedMotion.matches ? "instant" : "smooth",
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  for (const button of document.querySelectorAll("[data-theme-choice]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.themeChoice === theme),
    );
  }
  $('meta[name="theme-color"]').content =
    theme === "dark" ? "#141521" : "#f6f7fb";
}

function setNavigation() {
  const location = ["#monitor", "#history", "#mentions"].includes(window.location.hash)
    ? window.location.hash
    : "#check";
  for (const link of document.querySelectorAll("nav a")) {
    if (link.hash === location) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function observationLabel(key, status) {
  return key === "placement" && status === "missing"
    ? "Different placement"
    : choices[status];
}

function timestamp(value) {
  return new Date(value * 1000).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const STORAGE_KEY = "reachframe-local-workspace-v1";
const SUPABASE_CONFIG = window.REACHFRAME_SUPABASE || {};
const cloudClient = window.supabase?.createClient && SUPABASE_CONFIG.url && SUPABASE_CONFIG.publishableKey
  ? window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
let authMode = "signin";

async function migrateLocalWorkspace(user) {
  const marker = "reachframe-cloud-import-v1-" + user.id;
  if (localStorage.getItem(marker)) return;
  const local = readWorkspace();
  if (local.history.length) {
    const rows = local.history.map((scan) => ({
      user_id: user.id, handle: scan.handle, evidence_source: "guided",
      client_key: "browser:" + String(scan.id),
      checked_at: new Date(scan.checked * 1000).toISOString(), results: scan.results,
    }));
    const { error } = await cloudClient.from("reachframe_scans").upsert(rows, {
      onConflict: "user_id,client_key", ignoreDuplicates: true,
    });
    if (error) throw error;
  }
  if (local.watch.length) {
    const rows = local.watch.map((entry) => ({ user_id: user.id, handle: entry.handle }));
    const { error } = await cloudClient.from("reachframe_watchlist")
      .upsert(rows, { onConflict: "user_id,handle", ignoreDuplicates: true });
    if (error) throw error;
  }
  localStorage.setItem(marker, "done");
}

function updateAuthUI(user) {
  const signedIn = Boolean(user);
  $("#auth-status").textContent = signedIn ? user.email : "Guest workspace · saved on this device";
  $("#auth-submit").hidden = signedIn;
  $("#auth-mode").hidden = signedIn;
  $("#auth-email").hidden = signedIn;
  $("#auth-password").hidden = signedIn;
  $("#auth-signout").hidden = !signedIn;
  $("#auth-mode").textContent = authMode === "signin" ? "Create account" : "Have an account? Sign in";
  $("#auth-submit").textContent = authMode === "signin" ? "Sign in" : "Create account";
  $("#auth-form").setAttribute("aria-label", signedIn ? "Signed in account" : "Sign in or create an account");
}

async function getCurrentUser() {
  if (!cloudClient) return null;
  const { data, error } = await cloudClient.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  return data?.user || null;
}

let currentOwnerId = null;
let displayedReportIsShared = false;

async function migrateAndRefresh(user) {
  const nextOwnerId = user?.id || null;
  if (currentOwnerId !== nextOwnerId) {
    if (!displayedReportIsShared) {
      $("#report").replaceChildren();
      $("#report").hidden = true;
    }
    $("#auth-password").value = "";
    currentOwnerId = nextOwnerId;
  }
  updateAuthUI(user);
  if (user) {
    try {
      await migrateLocalWorkspace(user);
    } catch (error) {
      notice("Signed in, but guest data import needs another try: " + error.message);
    }
  }
  await refresh();
}


function readWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      history: Array.isArray(saved.history) ? saved.history : [],
      watch: Array.isArray(saved.watch) ? saved.watch : [],
      changes: Array.isArray(saved.changes) ? saved.changes : [],
    };
  } catch {
    throw new Error("This browser could not read saved workspace data.");
  }
}

function writeWorkspace(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    throw new Error("This browser could not save workspace data. Check available site storage.");
  }
}

async function api(route, data) {
  const { data: sessionData } = cloudClient
    ? await cloudClient.auth.getSession()
    : { data: { session: null } };
  const user = sessionData.session?.user;

  if (route === "workspace") {
    if (!user) return { live: false, cloud: false, ...readWorkspace() };
    const watchPromise = cloudClient.from("reachframe_watchlist")
      .select("handle,created_at").order("handle", { ascending: true });
    const scanRows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await cloudClient.from("reachframe_scans")
        .select("id,handle,evidence_source,checked_at,results")
        .order("checked_at", { ascending: false }).order("id", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      scanRows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const { data: watchRows, error: watchError } = await watchPromise;
    if (watchError) throw watchError;
    const history = scanRows.map((row) => ({
      id: row.id, handle: row.handle, source: row.evidence_source,
      checked: Math.floor(Date.parse(row.checked_at) / 1000), results: row.results,
    }));
    const changes = [];
    const previous = new Map();
    for (const scan of [...history].reverse()) {
      for (const [key] of fields) {
        const current = scan.results[key]?.status;
        if (!isMeasuredStatus(current)) continue;
        const mapKey = scan.handle + ":" + key;
        const before = previous.get(mapKey);
        if (before && before !== current) {
          changes.unshift({ handle: scan.handle, signal: key, before,
            after: current, checked: scan.checked, source: scan.source });
        }
        previous.set(mapKey, current);
      }
    }
    return { live: false, cloud: true, history, changes: changes.slice(0, 40),
      watch: (watchRows || []).map((row) => ({ handle: row.handle, next_scan: null })) };
  }

  const handle = String(data?.handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    throw new Error("Enter a valid X handle (1–15 letters, numbers or underscores).");
  }

  if (user && route === "watch") {
    const result = data.enabled === false
      ? await cloudClient.from("reachframe_watchlist").delete()
          .eq("user_id", user.id).eq("handle", handle)
      : data.enabled === true
        ? await cloudClient.from("reachframe_watchlist")
            .upsert({ user_id: user.id, handle },
              { onConflict: "user_id,handle", ignoreDuplicates: true })
        : { error: new Error("Provide a watch state.") };
    if (result.error) throw result.error;
    return { ok: true };
  }

  const workspace = user ? null : readWorkspace();
  if (route === "watch") {
    const exists = workspace.watch.some((item) => item.handle === handle);
    if (data.enabled === false) {
      workspace.watch = workspace.watch.filter((item) => item.handle !== handle);
    } else if (data.enabled === true && !exists) {
      if (workspace.watch.length >= 20) throw new Error("This browser can watch up to 20 handles.");
      workspace.watch.push({ handle, next_scan: null });
      workspace.watch.sort((a, b) => a.handle.localeCompare(b.handle));
    } else if (data.enabled !== true) {
      throw new Error("Provide a watch state.");
    }
    writeWorkspace(workspace);
    return { ok: true };
  }

  if (route !== "manual") throw new Error("This workspace action is unavailable.");
  const values = data.results;
  if (!values || typeof values !== "object" ||
      fields.some(([key]) => !["visible", "missing", "untestable", "unknown"].includes(values[key])) ||
      fields.every(([key]) => values[key] === "unknown")) {
    throw new Error("Record at least one observation before saving.");
  }
  const results = Object.fromEntries(fields.map(([key]) => [
    key,
    {
      status: values[key],
      ...(isMeasuredStatus(values[key]) && [ "1", "2", "3" ].includes(values[key + "_checks"])
        ? { checks: Number(values[key + "_checks"]) } : {}),
      ...(isMeasuredStatus(values[key]) && [ "1", "2", "3" ].includes(values[key + "_viewers"])
        ? { viewers: Number(values[key + "_viewers"]) } : {}),
      detail: String(values[key + "_detail"] || "").trim().slice(0, 280) ||
        (values[key] === "untestable"
          ? "The relevant view could not be assessed during this check."
          : "Recorded by you using the guided check."),
    },
  ]));

  if (user) {
    const { data: saved, error } = await cloudClient.from("reachframe_scans")
      .insert({ user_id: user.id, handle, evidence_source: "guided", results })
      .select("id,handle,evidence_source,checked_at,results").single();
    if (error) throw error;
    return { id: saved.id, handle: saved.handle, source: saved.evidence_source,
      checked: Math.floor(Date.parse(saved.checked_at) / 1000), results: saved.results };
  }

  const scan = { id: Date.now(), handle, source: "guided", checked: Math.floor(Date.now() / 1000), results };
  for (const [key] of fields) {
    const current = results[key].status;
    if (!isMeasuredStatus(current)) continue;
    const previous = workspace.history.find((entry) =>
      entry.handle === handle && entry.source === "guided" &&
      isMeasuredStatus(entry.results[key].status));
    if (previous && previous.results[key].status !== current) {
      workspace.changes.unshift({ handle, signal: key, before: previous.results[key].status,
        after: current, checked: scan.checked, source: "guided" });
    }
  }
  workspace.history.unshift(scan);
  workspace.history = workspace.history.slice(0, 250);
  workspace.changes = workspace.changes.slice(0, 40);
  writeWorkspace(workspace);
  return scan;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

const followUpInstructions = {
  suggestions: "Search the exact public handle from a separate viewer account. Record the query, viewer context, and time, then repeat once before treating the result as a pattern.",
  search: "Choose a recent original public post and search a distinctive exact phrase from a separate viewer account. Record the phrase and time; repeat with another recent post if the first is absent.",
  thread: "Open the reply’s parent conversation from a separate viewer account. Check the full thread and any expanded replies after the conversation has loaded, then repeat with another reply.",
  placement: "Compare the reply in the default conversation and in the available expanded or alternate reply view. Record both views and repeat with another conversation.",
};

function buildActionPlan(scan) {
  const items = [];
  const measured = fields.filter(([key]) => isMeasuredStatus(scan.results[key]?.status)).length;
  const untestable = fields.filter(([key]) => scan.results[key]?.status === "untestable").length;
  for (const [key, label] of fields) {
    const status = scan.results[key]?.status || "unknown";
    if (status === "missing") {
      items.push({
        priority: "Repeat observation",
        surface: label,
        instruction: followUpInstructions[key],
      });
    } else if (status === "untestable") {
      items.push({
        priority: "Retry when available",
        surface: label,
        instruction: "This view could not be assessed, so it is not evidence of a visibility problem. Retry when the complete surface is available. " + followUpInstructions[key],
      });
    } else if (status === "unknown") {
      items.push({
        priority: "Complete coverage",
        surface: label,
        instruction: "Leave this surface unmeasured until you can verify it directly. " + followUpInstructions[key],
      });
    }
  }
  if (items.some((item) => item.priority === "Repeat observation")) {
    items.push({
      priority: "Check official notices",
      surface: "X account status",
      instruction: "Review notices and Account Status in X for official information. These observations cannot identify an internal cause or confirm an enforcement decision.",
    });
  }
  const summary = !items.length
    ? "All four surfaces were marked visible in this snapshot. Save a later check if you want to compare changes."
    : items.some((item) => item.priority === "Repeat observation")
      ? "Repeat each missing observation with the same method before drawing conclusions. Differences can depend on viewer, query, and time."
      : measured === 0 && untestable > 0
        ? "No surface was measured. Untestable and unmeasured checks are excluded from the visibility percentage."
        : measured === 0
          ? "No surface was measured in this report. Record observations only when you can verify them directly."
          : "Complete the remaining checks when you can verify them. Untestable and unmeasured surfaces are excluded from the visibility percentage.";
  return { summary, items };
}

function downloadFile(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportData(scan) {
  const measured = fields.filter(([key]) => isMeasuredStatus(scan.results[key].status)).length;
  const visible = fields.filter(([key]) => scan.results[key].status === "visible").length;
  const untestable = fields.filter(([key]) => scan.results[key].status === "untestable").length;
  return {
    schema_version: 3,
    report_id: scan.id,
    platform: "X",
    handle: scan.handle,
    captured_at_utc: new Date(scan.checked * 1000).toISOString(),
    evidence_source: { id: scan.source, label: scan.source === "api" ? "X API" : scan.source === "shared" ? "Shared report · not independently verified" : "Guided observation" },
    coverage: {
      total_surfaces: fields.length,
      measured_surfaces: measured,
      visible_surfaces: visible,
      unmeasured_surfaces: fields.filter(([key]) => scan.results[key].status === "unknown").length,
      untestable_surfaces: untestable,
      visibility_percent: measured ? Math.round(100 * visible / measured) : null,
    },
    action_plan: buildActionPlan(scan),
    observations: fields.map(([key, label]) => ({
      surface: key,
      label,
      outcome: scan.results[key].status,
      outcome_label: observationLabel(key, scan.results[key].status),
      evidence: scan.results[key].detail,
      evidence_confidence: evidenceConfidence(scan.results[key]),
    })),
    limitations: [
      "These observations do not establish an official X moderation decision.",
      "Visibility can vary by viewer and time. Untestable and unmeasured surfaces are excluded from the visibility score.",
      "Guided results and any repeat-check or viewer counts reflect user-entered, self-reported information. Reachframe does not independently verify them.",
      "Confidence labels are a transparent summary of reported counts: repeated means 2+ checks or viewers; corroborated means 3+ checks across at least 2 viewers; a partial self-report means one count dimension was omitted. They are not probabilities or X enforcement signals.",
    ],
  };
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\t\r\n]/.test(text) || /^[\s]*[=+@\-＝＋＠－]/.test(text)
    ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function downloadHistoryCsv() {
  const headers = ["report_id", "handle", "captured_at_utc", "evidence_source",
    "total_surfaces", "measured_surfaces", "visible_surfaces", "unmeasured_surfaces", "visibility_percent",
    ...fields.flatMap(([key]) => [key + "_outcome", key + "_evidence", key + "_checks_self_reported", key + "_viewers_self_reported", key + "_confidence_label"]), "limitations"];
  const rows = (state?.history || readWorkspace().history).map((scan) => {
    const report = reportData(scan);
    const c = report.coverage;
    return [
      scan.id, scan.handle, report.captured_at_utc, scan.source,
      c.total_surfaces, c.measured_surfaces, c.visible_surfaces, c.unmeasured_surfaces, c.visibility_percent,
      ...report.observations.flatMap((item) => [item.outcome_label, item.evidence,
        item.evidence_confidence?.checks || "", item.evidence_confidence?.viewers || "",
        item.evidence_confidence?.level || ""]),
      report.limitations.join(" "),
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function openPrintReport(scan) {
  const data = reportData(scan);
  const rows = data.observations.map((item) =>
    `<article><h2>${escapeHtml(item.label)}</h2><strong>${escapeHtml(item.outcome_label)}</strong>${item.evidence_confidence ? `<p class="confidence">${escapeHtml(item.evidence_confidence.level)} · ${escapeHtml(item.evidence_confidence.checks)} checks · ${escapeHtml(item.evidence_confidence.viewers)} viewers (self-reported)</p>` : ""}<p>${escapeHtml(item.evidence)}</p></article>`
  ).join("");
  const limits = data.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const actionSteps = data.action_plan.items.map((item) =>
    `<li><strong>${escapeHtml(item.priority)} · ${escapeHtml(item.surface)}:</strong> ${escapeHtml(item.instruction)}</li>`
  ).join("");
  const measured = data.coverage.measured_surfaces;
  const score = data.coverage.visibility_percent === null ? "Unmeasured" :
    data.coverage.visibility_percent + "% · " + data.coverage.visible_surfaces + " of " + measured + " measured surfaces visible";
  const popup = window.open("", "_blank");
  if (!popup) {
    notice("Allow pop-ups to open the print report.");
    return;
  }
  popup.document.write(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reachframe report · @${escapeHtml(data.handle)}</title><style>
    body{font:16px/1.55 system-ui,sans-serif;max-width:820px;margin:40px auto;padding:0 22px;color:#202333;background:#fff}.confidence{color:#59614f;font-size:.88rem}
    h1{font-size:2rem;margin-bottom:4px}header p{color:#5e6272;margin-top:0}.score{font-size:1.5rem;font-weight:700;padding:14px 0}
    article{border:1px solid #dfe2eb;border-radius:12px;padding:16px;margin:12px 0;break-inside:avoid}
    article h2{font-size:1.1rem;margin:0 0 6px}article p{margin:8px 0 0}.limits,.plan{color:#545969;font-size:.9rem}.plan li{margin:8px 0}
    button{padding:10px 14px;border:0;border-radius:8px;background:#29314d;color:white;font:inherit;cursor:pointer}
    @media print{body{margin:0 auto}.no-print{display:none}}
  </style><body><button class="no-print" onclick="window.print()">Print / Save PDF</button><header><h1>Visibility report · @${escapeHtml(data.handle)}</h1><p>${escapeHtml(data.evidence_source.label)} · ${escapeHtml(new Date(scan.checked*1000).toLocaleString())}</p></header><div class="score">${escapeHtml(score)}</div><p>${measured} of 4 surfaces measured. Confidence summaries use self-reported repeat-check and viewer counts; Reachframe does not verify those counts.</p>${rows}<h2>Recommended next steps</h2><p>${escapeHtml(data.action_plan.summary)}</p><ol class="plan">${actionSteps}</ol><h2>Limitations</h2><ul class="limits">${limits}</ul></body></html>`);
  popup.document.close();
}

function notice(message) {
  $("#notice").textContent = message;
}

function makeShareToken(scan) {
  const payload = {
    v: 1,
    h: scan.handle,
    t: scan.checked,
    r: Object.fromEntries(fields.map(([key]) => [key, scan.results[key].status])),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readSharedReport() {
  const token = new URLSearchParams(window.location.search).get("share");
  if (!token) return null;
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const now = Math.floor(Date.now() / 1000);
    if (payload?.v !== 1 || !/^[a-z0-9_]{1,15}$/.test(payload.h) ||
        !Number.isInteger(payload.t) || payload.t < 1262304000 || payload.t > now + 86400 ||
        !payload.r || fields.some(([key]) =>
          !["visible", "missing", "untestable", "unknown"].includes(payload.r[key])) ||
        fields.every(([key]) => payload.r[key] === "unknown")) {
      throw new Error("The shared report is incomplete or invalid.");
    }
    return {
      id: "shared-" + payload.t,
      handle: payload.h,
      source: "shared",
      checked: payload.t,
      results: Object.fromEntries(fields.map(([key]) => [
        key,
        { status: payload.r[key], detail: "Included in this shared link. Reachframe has not independently verified this observation." },
      ])),
    };
  } catch {
    notice("This share link is invalid or incomplete. Open a fresh link from its owner.");
    return null;
  }
}

function makeShareUrl(scan) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("share", makeShareToken(scan));
  url.hash = "report";
  return url.toString();
}

function report(scan, { focus = true } = {}) {
  displayedReportIsShared = scan.source === "shared";
  const panel = $("#report");
  const statuses = Object.values(scan.results);
  const measured = statuses.filter((entry) => isMeasuredStatus(entry.status)).length;
  const visible = statuses.filter((entry) => entry.status === "visible").length;
  const untestable = statuses.filter((entry) => entry.status === "untestable").length;
  const score = measured ? Math.round((100 * visible) / measured) + "%" : "—";
  const title = !measured && untestable
    ? "Checks could not be completed"
    : !measured
      ? "Visibility unmeasured"
    : visible === measured
      ? "Visible in measured views"
      : "Visibility differences observed";
  const source = {
    guided: "Guided observation",
    api: "X API",
    sample: "Fictional sample",
    shared: "Shared report · not independently verified",
  }[scan.source];

  const head = node("div", null, "summary");
  const meta = node("div");
  meta.append(
    node("h2", title),
    node(
      "p",
      "@" +
        scan.handle +
        " · " +
        source +
        " · " +
        (scan.source === "sample"
          ? "Illustrative only"
          : timestamp(scan.checked)),
    ),
  );
  head.append(node("div", score, "score"), meta);
  const coverage = node(
    "p",
    measured +
      " of 4 surfaces measured. " +
      (untestable ? untestable + " could not be assessed; " : "") +
      (measured
        ? score + " of measured surfaces showed the expected visibility."
        : "No visibility score is available until a surface can be measured."),
  );
  const grid = node("div", null, "grid report-grid");
  for (const [key, label] of fields) {
    const result = scan.results[key];
    const card = node("article", null, "card");
    card.append(
      node("h3", label),
      node(
        "span",
        observationLabel(key, result.status),
        "badge " + result.status,
      ),
      node("p", result.detail),
    );
    const confidence = confidenceLabel(result);
    if (confidence && scan.source === "guided") card.append(node("small", "Self-reported confidence · " + confidence, "evidence-confidence"));
    grid.append(card);
  }
  const planData = buildActionPlan(scan);
  const plan = node("section", null, "action-plan");
  plan.setAttribute("aria-labelledby", "action-plan-heading");
  const planHeading = node("h3", "Recommended next steps");
  planHeading.id = "action-plan-heading";
  plan.append(planHeading, node("p", planData.summary, "action-plan-intro"));
  const planList = node("ol", null, "action-plan-list");
  for (const item of planData.items) {
    const entry = node("li", null, "action-plan-step");
    const priority = node("span", item.priority, "action-priority");
    const detail = node("div", null, "action-plan-detail");
    detail.append(node("strong", item.surface), node("p", item.instruction));
    entry.append(priority, detail);
    planList.append(entry);
  }
  plan.append(planList);

  const advice = node("div", null, "advice");
  advice.append(
    node("h3", "Next step"),
    node(
      "p",
      !measured
        ? "Retry checks marked untestable when the relevant X views are available. Do not treat unavailable evidence as a negative result."
        : visible < measured
          ? "Repeat the affected checks from another viewer account and review any notices in X."
          : "Save another check if visibility changes. Search and conversation results can differ by viewer.",
    ),
  );
  const confidenceNote = scan.source === "guided" && statuses.some((entry) => evidenceConfidence(entry))
    ? node("small", "Confidence uses only the repeat-check and viewer counts you entered. Reachframe does not independently verify these counts; labels are not probabilities or X enforcement signals.", "confidence-disclosure")
    : null;
  panel.replaceChildren(head, coverage, ...(confidenceNote ? [confidenceNote] : []), grid, plan, advice);
  if (scan.source === "sample") {
    const samples = node("div", null, "actions");
    samples.setAttribute("role", "group");
    samples.setAttribute("aria-label", "Sample scenarios");
    for (const [scenario, label] of Object.entries(sampleLabels)) {
      const button = node("button", label, "secondary");
      button.dataset.scenario = scenario;
      button.setAttribute("aria-pressed", String(scan.scenario === scenario));
      button.addEventListener("click", () => {
        showSample(scenario, false);
        panel.querySelector('[data-scenario="' + scenario + '"]').focus();
      });
      samples.append(button);
    }
    panel.prepend(samples);
  } else {
    const actions = node("div", null, "actions");
    const recheck = node("button", "Repeat guided check", "secondary");
    recheck.addEventListener("click", () => start(scan.handle));
    const isWatching = () =>
      state?.watch.some((entry) => entry.handle === scan.handle);
    const watch = node(
      "button",
      isWatching() ? "View watchlist" : "Add to watchlist",
      "secondary",
    );
    watch.addEventListener("click", () =>
      work(watch, async () => {
        if (isWatching()) {
          bringIntoView($("#monitor"));
          return;
        }
        await addToWatchlist(scan.handle);
        watch.textContent = "View watchlist";
      }),
    );
    actions.append(recheck, watch);
    const exports = node("div", null, "report-exports");
    const json = node("a", "Download JSON", "secondary action-link");
    json.href = "#";
    json.addEventListener("click", (event) => {
      event.preventDefault();
      downloadFile(
        "reachframe-report-" + scan.id + ".json",
        "application/json;charset=utf-8",
        JSON.stringify(reportData(scan), null, 2) + "\n",
      );
    });
    const print = node("a", "Print report", "secondary action-link");
    print.href = "#";
    print.addEventListener("click", (event) => {
      event.preventDefault();
      openPrintReport(scan);
    });
    const share = node("button", "Copy share link", "secondary");
    const shareWrap = node("div", null, "share-export");
    const shareDisclosure = node(
      "small",
      "Anyone with the link can view @" + scan.handle + ", the check date, and the recorded outcomes.",
    );
    const shareInput = document.createElement("input");
    shareInput.type = "text";
    shareInput.readOnly = true;
    shareInput.hidden = true;
    shareInput.className = "share-link-input";
    shareInput.setAttribute("aria-label", "Share link");
    share.addEventListener("click", async () => {
      const url = makeShareUrl(scan);
      shareInput.value = url;
      shareInput.hidden = false;
      try {
        await navigator.clipboard.writeText(url);
        notice("Share link copied. It contains only the public handle, check time, and recorded outcomes.");
      } catch {
        shareInput.focus();
        shareInput.select();
        notice("Copy the selected share link. It contains only the public handle, check time, and recorded outcomes.");
      }
    });
    shareWrap.append(shareDisclosure, share, shareInput);
    exports.append(json, print, shareWrap);
    panel.append(actions, exports);
    const comparison = priorComparison(scan);
    if (comparison) panel.insertBefore(comparison, advice);
  }
  panel.hidden = false;
  if (focus) {
    panel.focus({ preventScroll: true });
    bringIntoView(panel);
  }
}

function priorComparison(scan) {
  const history = state?.history || [];
  const scanIndex = history.findIndex((entry) => entry.id === scan.id);
  const older = scanIndex >= 0
    ? history.slice(scanIndex + 1)
    : history.filter((entry) => entry.checked < scan.checked)
        .sort((a, b) => b.checked - a.checked);
  const prior = older.find((entry) =>
    entry.handle === scan.handle && entry.source === scan.source,
  );
  if (!prior) return null;

  const comparison = node("details", null, "comparison");
  comparison.append(node("summary", "Compare with " + timestamp(prior.checked)));
  const list = node("ul", null, "activity");
  for (const [key, label] of fields) {
    const beforeStatus = prior.results[key].status;
    const afterStatus = scan.results[key].status;
    if (!isMeasuredStatus(beforeStatus) || !isMeasuredStatus(afterStatus)) continue;
    const before = observationLabel(key, beforeStatus);
    const after = observationLabel(key, afterStatus);
    list.append(node("li", label + " · " +
      (before === after ? after + " (unchanged)" : before + " → " + after)));
  }
  if (!list.children.length) {
    list.append(node("li", "No comparable measured surfaces across these reports."));
  }
  comparison.append(list);
  return comparison;
}
function countLabel(count, singular, plural = singular + "s") {
  return count + " " + (count === 1 ? singular : plural);
}

const REMINDER_STORAGE_KEY = "reachframe-manual-reminders-v1";

function reminderSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function storeReminderSettings(settings) {
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    notice("This browser could not save reminder settings.");
    return false;
  }
}

function lastSavedCheck(handle) {
  return Math.max(0, ...(state?.history || [])
    .filter((scan) => scan.handle === handle && scan.source !== "sample")
    .map((scan) => Number(scan.checked) || 0));
}

function reminderTiming(handle, setting) {
  const lastCheck = lastSavedCheck(handle) * 1000;
  const base = Math.max(Number(setting?.since) || 0, lastCheck);
  const days = Number(setting?.days) || 0;
  return { base, dueAt: base + days * 86400000, lastCheck };
}

function updateReminderLabels() {
  if (!state) return;
  const settings = reminderSettings();
  for (const entry of state.watch) {
    const row = [...$("#watch-list").children].find((item) => item.dataset.watchHandle === entry.handle);
    const status = row?.querySelector(".watch-reminder-status");
    const setting = settings[entry.handle];
    if (!status) continue;
    if (!setting?.days) {
      status.textContent = "Manual reminders are off. No automatic checks run.";
      status.removeAttribute("data-due");
      continue;
    }
    const { base, dueAt, lastCheck } = reminderTiming(entry.handle, setting);
    if (Date.now() >= dueAt) {
      const since = Number(setting.since) || 0;
      const lastLabel = lastCheck && lastCheck >= since
        ? timestamp(Math.floor(lastCheck / 1000))
        : "no check recorded since this reminder was set";
      status.textContent = "Manual check due · " + lastLabel;
      status.dataset.due = "true";
    } else {
      status.textContent = "Next manual reminder " + timestamp(Math.floor(dueAt / 1000)) +
        " · this device only";
      status.removeAttribute("data-due");
    }
  }
}

function checkDueReminders() {
  if (!state || document.visibilityState !== "visible") return;
  const settings = reminderSettings();
  let changed = false;
  for (const entry of state.watch) {
    const setting = settings[entry.handle];
    if (!setting?.days) continue;
    const { base, dueAt } = reminderTiming(entry.handle, setting);
    const key = String(base);
    if (Date.now() < dueAt || setting.notifiedFor === key) continue;
    if (localStorage.getItem("reachframe-browser-alerts") !== "on" ||
        !("Notification" in window) || Notification.permission !== "granted") continue;
    try {
      new Notification("Manual Reachframe check due", {
        body: "Open Reachframe to repeat or start a manual visibility check for @" + entry.handle + ".",
        tag: "reachframe-reminder-" + entry.handle,
      });
      setting.notifiedFor = key;
      changed = true;
    } catch {
      // Keep the reminder due so it can be retried after browser alerts are available.
    }
  }
  if (changed) storeReminderSettings(settings);
  updateReminderLabels();
}

function setReminder(handle, days) {
  const settings = reminderSettings();
  if (!days) {
    delete settings[handle];
  } else {
    settings[handle] = { days, since: Date.now(), notifiedFor: null };
  }
  storeReminderSettings(settings);
  updateReminderLabels();
}

function emptyList(selector, text) {
  $(selector).replaceChildren(node("li", text, "empty"));
}

function start(handle, focus = true) {
  activeHandle = handle;
  $("#handle").value = handle;
  const questions = $("#questions");
  questions.replaceChildren();
  for (const [key, label, guide] of fields) {
    const card = node("div", null, "card");
    const heading = node("label", label);
    heading.htmlFor = key;
    const description = node("p", guide);
    description.id = key + "-guide";
    const link = node(
      "a",
      key === "suggestions" ? "Open X search →" : "Open profile →",
    );
    link.href =
      key === "suggestions"
        ? "https://x.com/search?q=" + encodeURIComponent("@" + handle)
        : "https://x.com/" + handle;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const select = node("select");
    select.id = key;
    select.name = key;
    select.setAttribute("aria-describedby", description.id);
    for (const value of ["unknown", "visible", "missing", "untestable"]) {
      const option = node("option", observationLabel(key, value));
      option.value = value;
      select.append(option);
    }
    const countGroup = node("div", null, "replication-fields");
    for (const [suffix, caption, noun] of [
      ["checks", "Repeat checks", "check"], ["viewers", "Separate viewers", "viewer"],
    ]) {
      const fieldLabel = node("label", caption + " · self-reported");
      const countSelect = node("select");
      countSelect.name = key + "_" + suffix;
      countSelect.setAttribute("aria-label", label + " " + caption.toLowerCase() + " (self-reported)");
      countSelect.append(new Option("Not recorded", ""));
      countSelect.append(new Option("1 " + noun, "1"));
      countSelect.append(new Option("2 " + noun + "s", "2"));
      countSelect.append(new Option("3+ " + noun + "s", "3"));
      fieldLabel.append(countSelect);
      countGroup.append(fieldLabel);
    }
    const evidenceLabel = node("label", "Evidence note (optional)", "evidence-label");
    evidenceLabel.htmlFor = key + "_detail";
    const evidence = node("textarea");
    evidence.id = key + "_detail";
    evidence.name = key + "_detail";
    evidence.maxLength = 280;
    evidence.rows = 2;
    evidence.placeholder = "Viewer, search phrase, time, or why this could not be checked";
    evidence.setAttribute("aria-label", label + " evidence note");
    card.append(heading, description, link, select, countGroup, evidenceLabel, evidence);
    questions.append(card);
  }
  $("#guided").hidden = false;
  $("#guide-title").textContent = "Guided observations for @" + handle;
  notice("");
  updateProgress();
  if (focus) {
    $("#suggestions").focus({ preventScroll: true });
    bringIntoView($("#guided"));
  }
}

function updateProgress() {
  const recorded = [...$("#questions").querySelectorAll("select[id]")].filter(
    (select) => select.value !== "unknown",
  ).length;
  $("#progress").textContent = recorded + " of 4 recorded";
}

async function addToWatchlist(handle) {
  await api("watch", { handle, enabled: true });
  notice("Watching @" + handle + ".");
  await refresh();
}

async function refresh() {
  state = await api("workspace");
  $("#csv-export").hidden = false;
  $("#csv-export").onclick = (event) => {
    event.preventDefault();
    downloadFile("reachframe-history.csv", "text/csv;charset=utf-8", downloadHistoryCsv());
  };
  $("#monitor-mode").textContent = state.cloud
    ? "Signed-in workspace. Guided reports and watchlist sync to your account across devices."
    : "Guest workspace. Saved checks and watchlist stay in this browser on this device. Sign in to sync them across devices.";
  emptyList("#watch-list", "No accounts watched yet.");
  emptyList("#changes", "No measured changes yet.");
  $("#watch-count").textContent = countLabel(state.watch.length, "account");
  $("#change-count").textContent = countLabel(state.changes.length, "change");
  $("#scan-count").textContent = countLabel(state.history.length, "scan");
  if (state.watch.length) $("#watch-list").replaceChildren();
  for (const entry of state.watch) {
    const item = node("li");
    const recheck = node("button", "Check @" + entry.handle, "secondary");
    recheck.addEventListener("click", () => {
      start(entry.handle);
    });
    const remove = node("button", "Remove", "secondary");
    remove.setAttribute(
      "aria-label",
      "Remove @" + entry.handle + " from watchlist",
    );
    remove.addEventListener("click", () =>
      work(remove, async () => {
        await api("watch", { handle: entry.handle, enabled: false });
        const settings = reminderSettings();
        delete settings[entry.handle];
        storeReminderSettings(settings);
        await refresh();
      }),
    );
    const mentions = node("a", "Live mentions on X ↗", "action-link");
    mentions.href = "https://x.com/search?q=" + encodeURIComponent("@" + entry.handle);
    mentions.target = "_blank";
    mentions.rel = "noopener noreferrer";
    mentions.setAttribute("aria-label", "Open live X search for mentions of @" + entry.handle);
    item.dataset.watchHandle = entry.handle;
    const reminderLabel = node("label", null, "watch-reminder");
    const reminderCaption = node("span", "Manual reminder · this device");
    const reminderSelect = node("select");
    reminderSelect.setAttribute("aria-label", "Manual reminder cadence for @" + entry.handle);
    for (const [value, text] of [["", "Off"], ["1", "Daily"], ["3", "Every 3 days"], ["7", "Weekly"], ["14", "Every 2 weeks"]])
      reminderSelect.append(new Option(text, value));
    const savedReminder = reminderSettings()[entry.handle];
    reminderSelect.value = savedReminder?.days ? String(savedReminder.days) : "";
    reminderSelect.addEventListener("change", () => {
      setReminder(entry.handle, Number(reminderSelect.value) || 0);
    });
    reminderLabel.append(reminderCaption, reminderSelect);
    const reminderStatus = node("small", "", "watch-reminder-status");
    item.append(recheck, remove, mentions, reminderLabel, reminderStatus);
    if (state.live)
      item.append(
        node(
          "small",
          "Eligible for next check after " + timestamp(entry.next_scan),
        ),
      );
    $("#watch-list").append(item);
  }
  updateReminderLabels();
  if (state.changes.length) $("#changes").replaceChildren();
  for (const entry of state.changes) {
    const item = node("li");
    const label = fields.find(([key]) => key === entry.signal)[1];
    item.append(
      node("strong", "@" + entry.handle + " · " + label),
      node(
        "small",
        observationLabel(entry.signal, entry.before) +
          " → " +
          observationLabel(entry.signal, entry.after),
      ),
      node(
        "small",
        timestamp(entry.checked) +
          (entry.source === "api" ? " · X API" : " · Guided"),
      ),
    );
    $("#changes").append(item);
  }
  const filter = $("#history-filter");
  const previous = filter.value;
  const trendFilter = $("#trend-account");
  const previousTrend = trendFilter.value;
  const handles = [
    ...new Set(state.history.map((entry) => entry.handle)),
  ].sort();
  filter.replaceChildren(
    new Option("All accounts", ""),
    ...handles.map((handle) => new Option("@" + handle, handle)),
  );
  filter.value = handles.includes(previous) ? previous : "";
  filter.closest("label").hidden = handles.length < 2;
  const latestHandle = state.history[0]?.handle || "";
  trendFilter.replaceChildren(
    ...handles.map((handle) => new Option("@" + handle, handle)),
  );
  trendFilter.value = handles.includes(previousTrend) ? previousTrend : latestHandle;
  trendFilter.disabled = handles.length === 0;
  renderHistory();
}

function renderTrend() {
  const chart = $("#trend-chart");
  const summary = $("#trend-summary");
  chart.replaceChildren();
  const handle = $("#trend-account").value;
  const reports = (state?.history || [])
    .filter((scan) => scan.handle === handle && scan.source !== "sample")
    .map((scan) => {
      const statuses = fields.map(([key]) => scan.results[key]?.status);
      const measured = statuses.filter(isMeasuredStatus).length;
      const visible = statuses.filter((status) => status === "visible").length;
      const untestable = statuses.filter((status) => status === "untestable").length;
      return { scan, measured, visible, untestable, score: measured ? Math.round(100 * visible / measured) : null };
    })
    .filter((point) => point.score !== null)
    .sort((a, b) => a.scan.checked - b.scan.checked)
    .slice(-12);

  if (!handle || !reports.length) {
    chart.append(node("p", handle
      ? "No measured reports yet. Save observations that you can verify to create a trend."
      : "Save a guided report to build a private trend.", "trend-empty"));
    summary.textContent = "Untestable and unmeasured checks do not create score points.";
    return;
  }

  const width = 720, height = 240, left = 54, right = 18, top = 18, bottom = 42;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (index) => reports.length === 1
    ? left + plotWidth / 2
    : left + (index * plotWidth) / (reports.length - 1);
  const y = (score) => top + ((100 - score) / 100) * plotHeight;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "trend-svg-title trend-svg-desc");
  const title = document.createElementNS(svg.namespaceURI, "title");
  title.id = "trend-svg-title";
  title.textContent = "Visibility in measured views for @" + handle;
  const desc = document.createElementNS(svg.namespaceURI, "desc");
  desc.id = "trend-svg-desc";
  desc.textContent = reports.length + " saved reports. The latest shows " +
    reports[reports.length - 1].visible + " visible of " +
    reports[reports.length - 1].measured + " measured surfaces.";
  svg.append(title, desc);
  for (const tick of [0, 50, 100]) {
    const yy = y(tick);
    const grid = document.createElementNS(svg.namespaceURI, "line");
    grid.setAttribute("x1", left); grid.setAttribute("x2", width - right);
    grid.setAttribute("y1", yy); grid.setAttribute("y2", yy);
    grid.setAttribute("class", "trend-gridline");
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", left - 12); label.setAttribute("y", yy + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("class", "trend-axis-label");
    label.textContent = tick + "%";
    svg.append(grid, label);
  }
  const line = document.createElementNS(svg.namespaceURI, "polyline");
  line.setAttribute("points", reports.map((point, index) => x(index) + "," + y(point.score)).join(" "));
  line.setAttribute("class", "trend-line");
  svg.append(line);
  reports.forEach((point, index) => {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", x(index)); circle.setAttribute("cy", y(point.score));
    circle.setAttribute("r", "5"); circle.setAttribute("class", "trend-point");
    const tip = document.createElementNS(svg.namespaceURI, "title");
    tip.textContent = timestamp(point.scan.checked) + " · " + point.score + "% · " +
      point.visible + "/" + point.measured + " measured visible" +
      (point.untestable ? " · " + point.untestable + " untestable" : "");
    circle.append(tip);
    svg.append(circle);
  });
  const firstDate = document.createElementNS(svg.namespaceURI, "text");
  firstDate.setAttribute("x", left); firstDate.setAttribute("y", height - 12);
  firstDate.setAttribute("class", "trend-axis-label");
  firstDate.textContent = new Date(reports[0].scan.checked * 1000).toLocaleDateString();
  const lastDate = document.createElementNS(svg.namespaceURI, "text");
  lastDate.setAttribute("x", width - right); lastDate.setAttribute("y", height - 12);
  lastDate.setAttribute("text-anchor", "end"); lastDate.setAttribute("class", "trend-axis-label");
  lastDate.textContent = new Date(reports[reports.length - 1].scan.checked * 1000).toLocaleDateString();
  svg.append(firstDate, lastDate);
  chart.append(svg);
  const latest = reports[reports.length - 1];
  summary.textContent = "Latest: " + latest.score + "% (" + latest.visible + "/" +
    latest.measured + " measured surfaces visible) · " + reports.length +
    " measured reports shown" + (latest.untestable ? " · " + latest.untestable + " untestable" : "") + ".";
}

function renderHistory() {
  renderTrend();
  const handle = $("#history-filter").value;
  const entries = state.history.filter(
    (entry) => !handle || entry.handle === handle,
  );
  emptyList("#history-list", "No scans saved yet.");
  if (entries.length) $("#history-list").replaceChildren();
  for (const entry of entries) {
    const item = node("li");
    const button = node("button", "@" + entry.handle, "secondary");
    button.addEventListener("click", () => report(entry));
    item.append(
      button,
      node(
        "small",
        timestamp(entry.checked) +
          (entry.source === "api" ? " · X API" : " · Guided"),
      ),
    );
    $("#history-list").append(item);
  }
}

async function work(button, callback) {
  if (button) button.disabled = true;
  try {
    if (!state) await refresh();
    await callback();
  } catch (error) {
    notice(error.message);
    $("#notice").scrollIntoView({ block: "nearest" });
  } finally {
    if (button) button.disabled = false;
  }
}

const sampleLabels = {
  mixed: "Mixed visibility",
  visible: "Visible",
  unknown: "Unmeasured",
};

function showSample(scenario, focus = true) {
  const example = {
    suggestions: "The account appeared when the viewer entered its handle.",
    search: "A recent post appeared in search.",
    thread: "The viewer found the reply in the parent conversation.",
    placement: "The reply appeared in the default conversation view.",
  };
  const results = Object.fromEntries(
    fields.map(([key]) => [
      key,
      scenario === "unknown"
        ? {
            status: "unknown",
            detail: "This example has no usable observation for this surface.",
          }
        : { status: "visible", detail: example[key] },
    ]),
  );
  if (scenario === "mixed") {
    results.placement = {
      status: "missing",
      detail: "The viewer found the reply after expanding the conversation.",
    };
  }
  report(
    { handle: "maple_studio", source: "sample", scenario, results },
    { focus },
  );
}

document.addEventListener("DOMContentLoaded", () => {
  setTheme(storedTheme());
  const print = $("#print-report");
  if (print) {
    print.addEventListener("click", () => window.print());
    return;
  }
  setNavigation();
  window.addEventListener("hashchange", setNavigation);
  window.setInterval(checkDueReminders, 60000);
  for (const button of document.querySelectorAll("[data-theme-choice]")) {
    button.addEventListener("click", () => {
      const theme = button.dataset.themeChoice;
      setTheme(theme);
      try {
        localStorage.setItem("reachframe-theme", theme);
      } catch {
        // The current page can still use the selected theme.
      }
    });
  }
  $("#questions").addEventListener("change", updateProgress);
  $("#history-filter").addEventListener("change", renderHistory);
  $("#trend-account").addEventListener("change", renderTrend);
  $("#handle-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const handle = $("#handle").value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle))
      return notice("Use 1–15 letters, numbers or underscores.");
    start(handle);
  });
  $("#mention-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const handle = $("#mention-handle").value.trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
      $("#mention-result").hidden = true;
      return notice("Use 1–15 letters, numbers or underscores.");
    }
    const kind = $("#mention-kind").value;
    const query = kind === "mentions"
      ? "@" + handle + " -from:" + handle + " -filter:retweets"
      : kind === "replies"
        ? "to:" + handle + " -filter:retweets"
        : "from:" + handle + " -filter:replies -filter:retweets";
    const url = new URL("https://x.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("f", $("#mention-sort").value);
    const link = $("#mention-result");
    link.replaceChildren();
    const anchor = node("a", "Open results on X ↗", "primary-button");
    anchor.href = url.toString();
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    const queryText = node("code", query);
    link.append(anchor, queryText);
    link.hidden = false;
    notice("X search is ready for @" + handle + ".");
  });
  $("#guided-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const handle = activeHandle;
    const results = Object.fromEntries(new FormData(event.currentTarget));
    void work(event.submitter, async () => {
      const scan = await api("manual", { handle, results });
      notice("Saved observations for @" + handle + ".");
      await refresh();
      report(scan);
    });
  });
  $("#watch-add").addEventListener("click", (event) => {
    const handle = activeHandle;
    void work(event.currentTarget, () => addToWatchlist(handle));
  });
  $("#demo").addEventListener("click", () => showSample("mixed"));
  const sharedReport = readSharedReport();
  if (sharedReport) report(sharedReport, { focus: false });

  if (!cloudClient) {
    $("#auth-status").textContent = "Cloud sync unavailable";
    $("#auth-submit").disabled = true;
    $("#auth-mode").disabled = true;
    notice("Cloud sign-in is not configured. Guest workspace remains available.");
    void refresh().then(checkDueReminders).catch((error) => notice(error.message));
  } else {
    let authSync = Promise.resolve();
    const scheduleAuthRefresh = (user) => {
      authSync = authSync.then(() => migrateAndRefresh(user))
        .catch((error) => notice("Cloud sync: " + error.message));
    };
    void getCurrentUser().then(scheduleAuthRefresh)
      .catch((error) => notice("Cloud connection: " + error.message));
    cloudClient.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => scheduleAuthRefresh(session?.user || null));
    });
    $("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;
      const submit = $("#auth-submit");
      submit.disabled = true;
      try {
        const result = authMode === "signin"
          ? await cloudClient.auth.signInWithPassword({ email, password })
          : await cloudClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
        if (result.error) throw result.error;
        $("#auth-password").value = "";
        if (authMode === "signup" && !result.data.session) {
          notice("Check your email to confirm your account, then sign in.");
        } else {
          notice(authMode === "signin"
            ? "Signed in. Your workspace is syncing."
            : "Account created. Your workspace is syncing.");
          $("#auth-panel").open = false;
        }
      } catch (error) {
        notice(error.message || "Could not complete sign-in.");
      } finally {
        submit.disabled = false;
      }
    });
    $("#auth-mode").addEventListener("click", () => {
      authMode = authMode === "signin" ? "signup" : "signin";
      updateAuthUI(null);
    });
    $("#auth-signout").addEventListener("click", async () => {
      const { error } = await cloudClient.auth.signOut();
      if (error) notice(error.message);
      else notice("Signed out. Your local guest workspace is still available.");
    });
  }
});
