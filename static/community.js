(() => {
  const config = window.REACHFRAME_SUPABASE;
  const root = document.querySelector("#community");
  if (!root || !window.supabase?.createClient || !config?.url || !config?.publishableKey) return;

  const client = window.supabase.createClient(config.url, config.publishableKey);
  const $ = (selector) => root.querySelector(selector);
  const status = $("#community-status");
  const optIn = $("#community-share");
  const boardOptIn = $("#community-board-optin");
  const alias = $("#community-alias");
  const saveButton = $("#community-save");
  let currentUser = null;
  let latestChanges = new Set();
  let saveInFlight = false;

  function message(text, kind = "") {
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function addListMessage(selector, text) {
    const list = $(selector);
    list.replaceChildren();
    const item = document.createElement("li");
    item.className = "community-empty";
    item.textContent = text;
    list.append(item);
  }

  function addStat(selector, value) {
    $(selector).textContent = String(value);
  }

  function renderSnapshot(snapshot) {
    if (!snapshot?.ready) {
      addStat("#community-contributors", snapshot?.contributors || 0);
      addStat("#community-reports", snapshot?.reports || 0);
      addListMessage("#community-surfaces", "Community benchmarks unlock when five people have shared observations in the last 30 days.");
      addListMessage("#community-board", "No contributor board is available yet.");
      return;
    }

    addStat("#community-contributors", snapshot.contributors);
    addStat("#community-reports", snapshot.reports);
    addListMessage("#community-surfaces", "No measured community surfaces yet.");
    const surfaceNames = {
      suggestions: "Account suggestions",
      search: "Post search",
      thread: "Reply presence",
      placement: "Reply placement",
    };
    const surfaces = $("#community-surfaces");
    const values = Object.entries(snapshot.surfaces || {});
    if (values.length) surfaces.replaceChildren();
    for (const [key, counts] of values) {
      const row = document.createElement("li");
      row.className = "community-stat-row";
      const title = document.createElement("strong");
      title.textContent = surfaceNames[key] || key;
      const detail = document.createElement("span");
      detail.textContent = counts.visible + " visible · " + counts.missing + " not found · " + counts.measured + " measured";
      row.append(title, detail);
      surfaces.append(row);
    }

    addListMessage("#community-board", "No public contributors have opted into the board yet.");
    const board = $("#community-board");
    const people = Array.isArray(snapshot.leaderboard) ? snapshot.leaderboard : [];
    if (people.length) board.replaceChildren();
    people.forEach((person, index) => {
      const row = document.createElement("li");
      row.className = "community-board-row";
      const rank = document.createElement("span");
      rank.className = "community-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("strong");
      name.textContent = person.alias;
      const total = document.createElement("span");
      total.textContent = person.reports + (person.reports === 1 ? " report" : " reports");
      row.append(rank, name, total);
      board.append(row);
    });
  }

  async function loadSnapshot() {
    const { data, error } = await client.rpc("reachframe_community_snapshot");
    if (error) {
      addStat("#community-contributors", "—");
      addStat("#community-reports", "—");
      addListMessage("#community-surfaces", "Community data will appear after the database migration is applied.");
      addListMessage("#community-board", "Contributor board is not connected yet.");
      return;
    }
    renderSnapshot(data);
  }

  async function loadSettings(user) {
    currentUser = user;
    if (!user) {
      root.dataset.signedIn = "false";
      optIn.checked = false;
      boardOptIn.checked = false;
      alias.value = "";
      optIn.disabled = true;
      boardOptIn.disabled = true;
      alias.disabled = true;
      saveButton.disabled = true;
      message("Sign in to choose whether your observations appear in the community benchmark.", "muted");
      return;
    }
    root.dataset.signedIn = "true";
    optIn.disabled = false;
    boardOptIn.disabled = false;
    alias.disabled = false;
    saveButton.disabled = false;
    const { data, error } = await client.from("reachframe_community_members")
      .select("share_observations,show_on_leaderboard,public_alias")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      message("Could not load your sharing settings. Apply the latest Supabase migration first.", "error");
      return;
    }
    optIn.checked = Boolean(data?.share_observations);
    boardOptIn.checked = Boolean(data?.show_on_leaderboard);
    alias.value = data?.public_alias || "";
    message(data?.share_observations
      ? "Sharing is on. You can turn it off at any time."
      : "Your reports stay private unless you turn sharing on.", "muted");
  }

  async function saveSettings() {
    if (!currentUser || saveInFlight) return;
    if (boardOptIn.checked && !optIn.checked) {
      boardOptIn.checked = false;
      message("Turn on anonymous benchmark sharing before joining the contributor board.", "error");
      return;
    }
    if (boardOptIn.checked && alias.value.trim().length < 2) {
      message("Choose a public alias of at least two characters for the contributor board.", "error");
      alias.focus();
      return;
    }
    saveInFlight = true;
    saveButton.disabled = true;
    const record = {
      user_id: currentUser.id,
      share_observations: optIn.checked,
      show_on_leaderboard: boardOptIn.checked,
      public_alias: boardOptIn.checked ? alias.value.trim() : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await client.from("reachframe_community_members").upsert(record, { onConflict: "user_id" });
    saveInFlight = false;
    saveButton.disabled = false;
    if (error) {
      message("Settings were not saved. Apply the latest Supabase migration and try again.", "error");
      return;
    }
    message(optIn.checked
      ? "Saved. Only your guided observations are shared; your tracked handles remain private."
      : "Sharing is off. Your past observations are no longer included in community totals.");
    await loadSnapshot();
  }

  async function enableAlerts() {
    if (!("Notification" in window)) {
      message("This browser does not support desktop notifications. Your change log stays available in the workspace.", "muted");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      localStorage.setItem("reachframe-browser-alerts", "on");
      message("Browser alerts are on while Reachframe is open.");
      return;
    }
    localStorage.removeItem("reachframe-browser-alerts");
    message("Browser notifications were not enabled. The change log remains available in your workspace.", "muted");
  }

  function watchChanges() {
    if (localStorage.getItem("reachframe-browser-alerts") !== "on") return;
    const changes = [...document.querySelectorAll("#changes li")];
    const current = new Set(changes.map((item) => item.textContent.trim()).filter(Boolean));
    for (const change of current) {
      if (!latestChanges.has(change) && latestChanges.size > 0 && document.visibilityState === "visible" && Notification.permission === "granted") {
        new Notification("Reachframe observation changed", {
          body: change,
          tag: "reachframe-" + change.slice(0, 80),
        });
      }
    }
    latestChanges = current;
  }

  saveButton.addEventListener("click", () => void saveSettings());
  $("#community-alerts").addEventListener("click", () => void enableAlerts());
  optIn.addEventListener("change", () => {
    if (!optIn.checked) boardOptIn.checked = false;
  });

  const observer = new MutationObserver(watchChanges);
  observer.observe(document.querySelector("#changes"), { childList: true, subtree: true });
  watchChanges();

  client.auth.getUser().then(({ data }) => loadSettings(data?.user || null));
  client.auth.onAuthStateChange((_event, session) => void loadSettings(session?.user || null));
  void loadSnapshot();
  window.setInterval(() => void loadSnapshot(), 60000);
})();
