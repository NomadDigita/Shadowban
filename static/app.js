"use strict";

const $ = (selector) => document.querySelector(selector);
const fields = [
  ["suggestions", "Account suggestions", "Type the exact handle into X search and inspect the dropdown. Record whether the account appears."],
  ["search", "Post search", "Find a recent original post on the profile. Search its exact text from a separate viewer account. If a recent public post cannot be identified, leave this unmeasured."],
  ["thread", "Reply presence", "Find a reply on the profile, then open its parent conversation as a separate viewer. Record an absence only if you can check the whole thread."],
  ["placement", "Reply placement", "Compare the default conversation with another available sort or the expanded replies. Mark “Different placement” if the reply appears only in the alternate view."]
];
const choices = {visible: "Visible", missing: "Missing from view", unknown: "Unmeasured"};
let activeHandle;
let state;

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function observationLabel(key, status) {
  return key === "placement" && status === "missing" ? "Different placement" : choices[status];
}

function timestamp(value) {
  return new Date(value * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
}

async function api(route, data) {
  const options = data ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)
  } : {};
  const response = await fetch("/api/" + route, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The workspace could not be reached.");
  return result;
}

function notice(message) {
  $("#notice").textContent = message;
}

function report(scan) {
  const panel = $("#report");
  const statuses = Object.values(scan.results);
  const measured = statuses.filter((entry) => entry.status !== "unknown").length;
  const visible = statuses.filter((entry) => entry.status === "visible").length;
  const score = measured ? Math.round(100 * visible / measured) + "%" : "—";
  const title = !measured ? "Visibility unmeasured" : visible === measured ? "Visible in measured views" : "Visibility differences observed";
  const source = {guided: "Guided observation", api: "X API", sample: "Fictional sample"}[scan.source];

  const head = node("div", null, "summary");
  const meta = node("div");
  meta.append(node("h2", title), node("p", "@" + scan.handle + " · " + source + " · " +
    (scan.source === "sample" ? "Illustrative only" : timestamp(scan.checked))));
  head.append(node("div", score, "score"), meta);
  const coverage = node("p", measured + " of 4 surfaces measured. " +
    (measured ? score + " of measured surfaces showed the expected visibility." : "A score requires an observation."));
  const grid = node("div", null, "grid report-grid");
  for (const [key, label] of fields) {
    const result = scan.results[key];
    const card = node("article", null, "card");
    card.append(node("h3", label), node("span", observationLabel(key, result.status), "badge " + result.status),
      node("p", result.detail));
    grid.append(card);
  }
  const advice = node("div", null, "advice");
  advice.append(node("h3", "Next step"), node("p", !measured
    ? "Open the guided check and record any surfaces you can verify directly."
    : visible < measured
      ? "Repeat the affected checks from another viewer account and review any notices in X."
      : "Save another check if visibility changes. Search and conversation results can differ by viewer."));
  panel.replaceChildren(head, coverage, grid, advice);
  panel.hidden = false;
  panel.focus();
  panel.scrollIntoView({block: "start", behavior: "smooth"});
}

function emptyList(selector, text) {
  $(selector).replaceChildren(node("li", text));
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
    const link = node("a", key === "suggestions" ? "Open X search ↗" : "Open profile ↗");
    link.href = key === "suggestions" ? "https://x.com/search?q=" + encodeURIComponent("@" + handle) : "https://x.com/" + handle;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const select = node("select");
    select.id = key;
    select.name = key;
    select.setAttribute("aria-describedby", description.id);
    for (const value of ["unknown", "visible", "missing"]) {
      const option = node("option", observationLabel(key, value));
      option.value = value;
      select.append(option);
    }
    card.append(heading, description, link, select);
    questions.append(card);
  }
  $("#guided").hidden = false;
  notice("Recording observations for @" + handle);
  if (focus) $("#suggestions").focus();
}

async function refresh() {
  state = await api("workspace");
  $("#monitor-mode").textContent = state.live
    ? "Scheduled X API post-search checks are enabled. Guided checks cover all four surfaces."
    : "Save guided checks for watched handles to see changes here. Automatic post-search checks are off.";
  emptyList("#watch-list", "No accounts watched yet.");
  emptyList("#changes", "No measured changes yet.");
  emptyList("#history-list", "No scans saved yet.");
  if (state.watch.length) $("#watch-list").replaceChildren();
  for (const entry of state.watch) {
    const item = node("li");
    const recheck = node("button", "Check @" + entry.handle, "secondary");
    recheck.addEventListener("click", () => {
      start(entry.handle);
      $("#check").scrollIntoView({block: "start"});
    });
    const remove = node("button", "Remove", "secondary");
    remove.setAttribute("aria-label", "Remove @" + entry.handle + " from watchlist");
    remove.addEventListener("click", () => work(remove, async () => {
      await api("watch", {handle: entry.handle, enabled: false});
      await refresh();
    }));
    item.append(recheck, remove);
    if (state.live) item.append(node("small", "Eligible for next check after " + timestamp(entry.next_scan)));
    $("#watch-list").append(item);
  }
  if (state.changes.length) $("#changes").replaceChildren();
  for (const entry of state.changes) {
    const item = node("li");
    const label = fields.find(([key]) => key === entry.signal)[1];
    item.append(node("strong", "@" + entry.handle + " · " + label),
      node("small", observationLabel(entry.signal, entry.before) + " → " + observationLabel(entry.signal, entry.after)),
      node("small", timestamp(entry.checked) + (entry.source === "api" ? " · X API" : " · Guided")));
    $("#changes").append(item);
  }
  if (state.history.length) $("#history-list").replaceChildren();
  for (const entry of state.history) {
    const item = node("li");
    const button = node("button", "@" + entry.handle, "secondary");
    button.addEventListener("click", () => report(entry));
    item.append(button, node("small", timestamp(entry.checked) + (entry.source === "api" ? " · X API" : " · Guided")));
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
    $("#notice").scrollIntoView({block: "nearest"});
  } finally {
    if (button) button.disabled = false;
  }
}

$("#handle-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const handle = $("#handle").value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return notice("Use 1–15 letters, numbers or underscores.");
  start(handle);
});
$("#guided-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const handle = activeHandle;
  const results = Object.fromEntries(new FormData(event.currentTarget));
  void work(event.submitter, async () => {
    const scan = await api("manual", {handle, results});
    notice("Saved observations for @" + handle + ".");
    report(scan);
    await refresh();
  });
});
$("#watch-add").addEventListener("click", (event) => {
  const handle = activeHandle;
  void work(event.currentTarget, async () => {
    await api("watch", {handle, enabled: true});
    notice("Watching @" + handle + ".");
    await refresh();
  });
});
$("#demo").addEventListener("click", () => report({
  handle: "maple_studio", source: "sample",
  results: {
    suggestions: {status: "visible", detail: "The account appeared when the viewer entered its handle."},
    search: {status: "visible", detail: "A recent post appeared in search."},
    thread: {status: "visible", detail: "The viewer found the reply in the parent conversation."},
    placement: {status: "missing", detail: "The viewer found the reply after expanding the conversation."}
  }
}));
void refresh().catch((error) => notice(error.message));
