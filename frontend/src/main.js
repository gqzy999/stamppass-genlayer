import { readClient, connectInjected, ensureStudionet, createEphemeral, hasInjected, shortAddress } from "./wallet.js";
import { getLang, setLang, t } from "./i18n.js";

const DEFAULT_CONTRACT =
  import.meta.env.VITE_CONTRACT_ADDRESS || "STAMPPASS_ADDRESS_PLACEHOLDER";
const EXPLORER = "https://explorer-studio.genlayer.com/address/";
const MILESTONE_KEYS = {
  "First Stamp": "msFirst",
  Collector: "msCollector",
  Globetrotter: "msGlobe",
  "World Traveler": "msTraveler",
};

let lang = getLang();
let contractAddress = DEFAULT_CONTRACT;
let holder = "";
let wallet = null;
let pages = [];
let pageIndex = 0;
let counts = null;

const reader = readClient();
const $ = (id) => document.getElementById(id);

function tr(key, vars) {
  return t(lang, key, vars);
}

function explorerLink(addr) {
  return EXPLORER + addr;
}

function toast(message, hash, ok) {
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = "toast" + (ok === false ? " bad" : "");
  el.textContent = message;
  if (hash) {
    const a = document.createElement("a");
    a.href = "https://explorer-studio.genlayer.com/tx/" + hash;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = " " + hash.slice(0, 10) + "…";
    el.appendChild(a);
  }
  box.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

function errMessage(e) {
  const raw = String((e && e.message) || e || "");
  if (raw.includes("NO_WALLET")) return tr("errNoWallet");
  const code = ["DUPLICATE_CLAIM", "CAP_REACHED", "INVALID_INPUT", "NOT_FOUND", "INVALID_STATUS"].find((c) => raw.includes(c));
  if (code) return tr(errKeyFor(code));
  if (/network|fetch|failed to fetch|timeout/i.test(raw)) return tr("errNetwork");
  return tr("errGeneric");
}

function errKeyFor(code) {
  const map = {
    DUPLICATE_CLAIM: "errDuplicate",
    CAP_REACHED: "errCap",
    INVALID_INPUT: "errInvalid",
    NOT_FOUND: "errNotFound",
    INVALID_STATUS: "errStatus",
  };
  return map[code] || "errGeneric";
}

function milestoneName(name) {
  const key = MILESTONE_KEYS[name];
  return key ? tr(key) : name;
}

function statusLabel(status) {
  return tr("status" + status);
}

async function readView(fn, args) {
  return reader.readContract({ address: contractAddress, functionName: fn, args });
}

async function readJson(fn, args) {
  const raw = await readView(fn, args);
  return raw === "" ? null : JSON.parse(raw);
}

function renderStatic() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = tr(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = tr(el.dataset.i18nPh);
  });
  $("lang-en").classList.toggle("active", lang === "en");
  $("lang-zh").classList.toggle("active", lang === "zh");
  $("contract-input").value = contractAddress;
  $("contract-explorer").href = explorerLink(contractAddress);
  $("contract-display").textContent = contractAddress;
  $("holder-input").value = holder;
  renderWalletBox();
}

function renderWalletBox() {
  const status = $("wallet-status");
  const kind = $("wallet-kind");
  if (!wallet) {
    status.textContent = hasInjected() ? tr("holderLabel") + ": —" : tr("noWalletNote");
    kind.textContent = "";
    $("wallet-connect").style.display = "";
    $("wallet-ephemeral").style.display = "";
    $("wallet-disconnect").style.display = "none";
    $("chain-warning").style.display = "none";
    return;
  }
  status.textContent = shortAddress(wallet.address);
  kind.textContent = wallet.kind === "ephemeral" ? tr("ephemeralNote") : "";
  $("wallet-connect").style.display = "none";
  $("wallet-ephemeral").style.display = "none";
  $("wallet-disconnect").style.display = "";
  $("chain-warning").style.display = wallet.kind === "injected" ? "" : "none";
}

function renderCounts() {
  if (!counts) return;
  $("counts-claims").textContent = counts.claims;
  $("counts-stamps").textContent = counts.stamps;
  $("counts-pending").textContent = counts.pending;
  $("counts-stamped").textContent = counts.stamped;
  $("counts-unverified").textContent = counts.unverified;
}

function buildPages(passport, claims) {
  const byClaim = new Map();
  for (const s of passport.stamps || []) byClaim.set(s.claim_id, s);
  const list = [{ type: "cover", passport }];
  for (const claim of claims) {
    if (claim.status === "STAMPED") {
      list.push({ type: "stamp", claim, stamp: byClaim.get(claim.claim_id) || null });
    } else if (claim.status === "UNVERIFIED") {
      list.push({ type: "refused", claim });
    } else {
      list.push({ type: "pending", claim });
    }
  }
  return list;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBook() {
  const page = $("book-page");
  const nav = $("book-nav");
  if (!holder) {
    page.innerHTML = `<p class="muted">${esc(tr("coverHint"))}</p>`;
    nav.style.display = "none";
    return;
  }
  nav.style.display = "";
  if (pages.length === 0) {
    page.innerHTML = `<p class="muted">${esc(tr("loading"))}</p>`;
    return;
  }
  const item = pages[pageIndex] || pages[0];
  $("book-page-indicator").textContent = tr("pageOf", { a: pageIndex + 1, b: pages.length });
  $("book-nav-prev").disabled = pageIndex <= 0;
  $("book-nav-next").disabled = pageIndex >= pages.length - 1;
  if (item.type === "cover") {
    const p = item.passport;
    const ms = (p.milestones || []).map((m) => `<span class="ms">${esc(milestoneName(m))}</span>`).join("");
    page.innerHTML = `
      <div class="cover">
        <div class="cover-kicker">${esc(tr("coverSub"))}</div>
        <h2 class="cover-title">${esc(tr("coverTitle"))}</h2>
        <p class="cover-holder">${esc(tr("holderLabel"))}: ${esc(holder)}</p>
        <div class="cover-stats">
          <div><b>${p.total_stamps}</b><span>${esc(tr("statsStamps"))}</span></div>
          <div><b>${p.distinct_events}</b><span>${esc(tr("statsDistinct"))}</span></div>
          <div><b>${p.stamps_last_30d}</b><span>${esc(tr("statsRecent"))}</span></div>
        </div>
        <div class="cover-ms">${ms || `<span class="muted">${esc(tr("emptyBook"))}</span>`}</div>
        <button class="btn primary" id="cover-open-btn">${esc(tr("coverOpen"))}</button>
      </div>`;
    const btn = document.getElementById("cover-open-btn");
    if (btn) btn.onclick = () => { if (pages.length > 1) turnTo(1); };
    return;
  }
  const claim = item.claim;
  const head = `<p class="page-kicker">${esc(tr("stampFor"))} · ${esc(claim.claim_id)}</p>
    <h3 class="page-event">${esc(claim.event_name)}</h3>
    <p class="page-date">${esc(claim.event_date)}</p>`;
  const meta = `<p><span class="lbl">${esc(tr("claimerLabel"))}</span> ${esc(claim.claimer)}</p>
    <p><span class="lbl">${esc(tr("statusLabel"))}</span> ${esc(statusLabel(claim.status))}</p>
    <p><a href="${esc(claim.evidence_url)}" target="_blank" rel="noreferrer">${esc(tr("evidenceLink"))} ↗</a></p>
    ${claim.note ? `<p><span class="lbl">${esc(tr("noteLabel"))}</span> ${esc(claim.note)}</p>` : ""}`;
  if (item.type === "stamp") {
    page.innerHTML = `<div class="visa stamp-on">${head}
      <div class="ink-stamp">${esc(tr("statusSTAMPED"))}</div>
      ${meta}</div>`;
  } else if (item.type === "refused") {
    page.innerHTML = `<div class="visa refused">${head}
      <div class="ink-stamp bad">${esc(tr("statusUNVERIFIED"))}</div>
      <p class="muted">${esc(tr("refusedTitle"))}</p>
      ${meta}</div>`;
  } else {
    const canVerify = !!wallet;
    page.innerHTML = `<div class="visa pending">${head}
      <div class="ink-stamp dashed">${esc(tr("statusPENDING"))}</div>
      <p class="muted">${esc(tr("pendingSlotTitle"))}</p>
      ${meta}
      ${canVerify ? `<button class="btn primary verify-btn" data-claim="${esc(claim.claim_id)}">${esc(tr("verifyBtn"))}</button>` : `<p class="muted">${esc(tr("errConnectFirst"))}</p>`}</div>`;
    page.querySelectorAll(".verify-btn").forEach((b) => {
      b.onclick = () => doVerify(b.dataset.claim);
    });
  }
}

function turnTo(index) {
  if (index < 0 || index >= pages.length) return;
  const book = $("book");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    pageIndex = index;
    renderBook();
    return;
  }
  book.classList.add("turning");
  setTimeout(() => {
    pageIndex = index;
    renderBook();
    book.classList.remove("turning");
  }, 180);
}

async function loadPassport() {
  if (!holder) {
    pages = [];
    renderBook();
    return;
  }
  try {
    const [passport, claims, c] = await Promise.all([
      readJson("get_passport", [holder]),
      readJson("get_claims_by_claimer", [holder]),
      readJson("get_counts", []),
    ]);
    counts = c;
    pages = buildPages(passport || { stamps: [], total_stamps: 0, distinct_events: 0, stamps_last_30d: 0, milestones: [] }, claims || []);
    pageIndex = 0;
    renderCounts();
    renderBook();
  } catch (e) {
    toast(tr("loadFail"), null, false);
    pages = [{ type: "cover", passport: { stamps: [], total_stamps: 0, distinct_events: 0, stamps_last_30d: 0, milestones: [] } }];
    pageIndex = 0;
    renderBook();
  }
}

async function send(fn, args) {
  if (!wallet) throw new Error("NO_WALLET");
  const hash = await wallet.client.writeContract({ address: contractAddress, functionName: fn, args });
  toast(tr("txPending"), hash, true);
  await wallet.client.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 3000, retries: 200 });
  const tx = await wallet.client.getTransaction({ hash });
  const lr = tx.consensus_data?.leader_receipt?.[0];
  const exec = lr?.execution_result ?? tx.txExecutionResultName ?? "UNKNOWN";
  const err = lr?.error ?? "";
  const payload = lr?.result?.payload ?? "";
  if (exec !== "SUCCESS") {
    const code = ["DUPLICATE_CLAIM", "CAP_REACHED", "INVALID_INPUT", "NOT_FOUND", "INVALID_STATUS"].find((c) => String(err).includes(c) || String(exec).includes(c) || String(payload).includes(c));
    const e = new Error(code || exec);
    e.txHash = hash;
    throw e;
  }
  return hash;
}

async function doClaim(ev) {
  ev.preventDefault();
  const eventName = $("claim-event").value.trim();
  const date = $("claim-date").value.trim();
  const url = $("claim-url").value.trim();
  const note = $("claim-note").value.trim();
  if (!wallet) {
    toast(tr("errConnectFirst"), null, false);
    return;
  }
  try {
    const hash = await send("claim_attendance", [eventName, date, url, note]);
    toast(tr("txDone"), hash, true);
    $("claim-event").value = "";
    $("claim-date").value = "";
    $("claim-url").value = "";
    $("claim-note").value = "";
    await loadPassport();
  } catch (e) {
    const code = e.message;
    toast(tr(errKeyFor(code)), e.txHash || null, false);
  }
}

async function doVerify(claimId) {
  if (!wallet) {
    toast(tr("errConnectFirst"), null, false);
    return;
  }
  try {
    const hash = await send("verify_attendance", [claimId]);
    toast(tr("txDone"), hash, true);
    await loadPassport();
  } catch (e) {
    toast(tr(errKeyFor(e.message)), e.txHash || null, false);
  }
}

function initReveal() {
  const els = document.querySelectorAll(".reveal");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("revealed"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (en.isIntersecting) {
        en.target.classList.add("revealed");
        io.unobserve(en.target);
      }
    }
  }, { threshold: 0.15 });
  els.forEach((el) => io.observe(el));
}

async function init() {
  $("lang-en").onclick = () => { lang = "en"; setLang("en"); renderStatic(); renderBook(); };
  $("lang-zh").onclick = () => { lang = "zh"; setLang("zh"); renderStatic(); renderBook(); };
  $("wallet-connect").onclick = async () => {
    try {
      if (!hasInjected()) {
        toast(tr("noWalletNote"), null, false);
        return;
      }
      wallet = await connectInjected();
      await ensureStudionet();
      holder = wallet.address;
      renderStatic();
      await loadPassport();
    } catch (e) {
      toast(errMessage(e), null, false);
    }
  };
  $("wallet-ephemeral").onclick = () => {
    wallet = createEphemeral();
    holder = wallet.address;
    renderStatic();
    loadPassport();
  };
  $("wallet-disconnect").onclick = () => {
    wallet = null;
    renderStatic();
  };
  $("chain-switch").onclick = async () => {
    try {
      await ensureStudionet();
      $("chain-warning").style.display = "none";
    } catch (e) {
      toast(errMessage(e), null, false);
    }
  };
  $("contract-use").onclick = () => {
    const v = $("contract-input").value.trim();
    if (!v) return;
    contractAddress = v;
    renderStatic();
    loadPassport();
  };
  $("holder-open").onclick = () => {
    const v = $("holder-input").value.trim();
    if (!v) return;
    holder = v;
    renderStatic();
    loadPassport();
  };
  $("book-nav-prev").onclick = () => turnTo(pageIndex - 1);
  $("book-nav-next").onclick = () => turnTo(pageIndex + 1);
  $("book-back-cover").onclick = () => turnTo(0);
  $("claim-form").addEventListener("submit", doClaim);
  $("verify-manual-btn").onclick = () => {
    const id = $("verify-id").value.trim();
    if (id) doVerify(id);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") turnTo(pageIndex + 1);
    if (e.key === "ArrowLeft") turnTo(pageIndex - 1);
  });
  renderStatic();
  try {
    counts = await readJson("get_counts", []);
    renderCounts();
  } catch {}
  renderBook();
  initReveal();
}

init();
