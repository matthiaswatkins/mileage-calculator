// ======================================================
// CONFIG & IMPORTS
// ======================================================
import { LOCATION_ALIAS } from './locationAlias.js';
import { MILEAGE_TABLE } from './mileageTable.js';
import { APP_VERSION, BUILD_DATE } from './version.js';

const MAPBOX_TOKEN = "pk.eyJ1IjoibWF0dGhpYXN3IiwiYSI6ImNtaWc2anViaDAwZDkzY3ExZ20waml0ZnQifQ.ncDM-q4piCtrnbVIw4uexw";

// ------------------------------------------------------
// DOM Elements
// ------------------------------------------------------
const inputBox = document.getElementById("locations");
const calculateBtn = document.getElementById("calculateBtn");
const rateInput = document.getElementById("rateInput");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");
const breakdownTitle = document.getElementById("breakdownTitle");
const legsTableBody = document.querySelector("#legsTable tbody");
const totalMilesEl = document.getElementById("totalMiles");
const versionEl = document.getElementById("versionInfo");
const aliasChipsDiv = document.getElementById("aliasChips");

const summaryCard = document.getElementById("summaryCard");
const metricDays = document.getElementById("metricDays");
const metricMiles = document.getElementById("metricMiles");
const metricPayout = document.getElementById("metricPayout");

versionEl.textContent = `Version ${APP_VERSION} • ${BUILD_DATE}`;

let dailyResultsDiv;
let calculatedDailyTotals = [];

// ------------------------------------------------------
// Initialize Alias Chips
// ------------------------------------------------------
function renderAliasChips() {
  aliasChipsDiv.innerHTML = "";
  Object.keys(LOCATION_ALIAS).forEach(alias => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = alias;
    chip.title = LOCATION_ALIAS[alias];
    chip.addEventListener("click", () => insertAlias(alias));
    aliasChipsDiv.appendChild(chip);
  });
}

function insertAlias(alias) {
  const start = inputBox.selectionStart;
  const end = inputBox.selectionEnd;
  const text = inputBox.value;

  // Determine prefix: if cursor is not at start of line/after newline, add separator
  const before = text.substring(0, start);
  const after = text.substring(end);
  const needsSeparator = before.length > 0 && !before.endsWith("\n") && !before.endsWith(" ") && !before.endsWith(":");
  const insertion = (needsSeparator ? " : " : "") + alias;

  inputBox.value = before + insertion + after;
  inputBox.selectionStart = inputBox.selectionEnd = start + insertion.length;
  inputBox.focus();
}

renderAliasChips();

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
function setStatus(msg, isErr = false) {
  statusDiv.textContent = msg;
  statusDiv.classList.toggle("error", isErr);
}

function normalize(token) {
  return token.trim().toUpperCase().replace(/\s+/g, "");
}

function aliasToAddress(token) {
  const key = normalize(token);
  return LOCATION_ALIAS[key] || null;
}

function tableLookup(a, b) {
  const key = `${a}|${b}`;
  const rev = `${b}|${a}`;
  if (MILEAGE_TABLE[key] != null) return MILEAGE_TABLE[key];
  if (MILEAGE_TABLE[rev] != null) return MILEAGE_TABLE[rev];
  return null;
}

function metersToMiles(m) {
  return m / 1609.344;
}

function formatMiles(m) {
  return m.toFixed(2);
}

// ------------------------------------------------------
// Fallback Persistent API Lookup
// ------------------------------------------------------
let fallbackCache = JSON.parse(localStorage.getItem("fallbackCache") || "{}");

function saveFallbackCache() {
  localStorage.setItem("fallbackCache", JSON.stringify(fallbackCache));
}

async function geocode(address) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
    `${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=5`;

  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error("Geocode failed");
  const data = await rsp.json();

  if (!data.features?.length) throw new Error(`No geocode match for ${address}`);

  if (data.features.length === 1) {
    const [lon, lat] = data.features[0].center;
    return { lat, lon };
  }

  return await showGeocodeModal(address, data.features);
}

async function routeMeters(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}` +
    `?access_token=${MAPBOX_TOKEN}&overview=false`;

  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error("Directions failed");
  const data = await rsp.json();
  if (!data.routes?.length) throw new Error("No route returned");
  return data.routes[0].distance;
}

async function fallbackLookup(a, b) {
  const key = `${a}|${b}`;
  if (fallbackCache[key] != null) return fallbackCache[key];

  let addrA = aliasToAddress(a);
  let addrB = aliasToAddress(b);

  if (!addrA) addrA = prompt(`Missing address for '${a}'. Enter full address:`).trim();
  if (!addrB) addrB = prompt(`Missing address for '${b}'. Enter full address:`).trim();

  const ga = await geocode(addrA);
  const gb = await geocode(addrB);
  const meters = await routeMeters(ga, gb);
  const miles = parseFloat(formatMiles(metersToMiles(meters)));

  fallbackCache[key] = miles;
  fallbackCache[`${b}|${a}`] = miles;
  saveFallbackCache();
  return miles;
}

// ------------------------------------------------------
// Processing Routes
// ------------------------------------------------------
async function processDailyRow(tokens) {
  let total = 0;
  let legs = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const a = normalize(tokens[i]);
    const b = normalize(tokens[i + 1]);

    let miles = tableLookup(a, b);
    if (miles == null) {
      miles = await fallbackLookup(a, b);
    }

    total += miles;
    legs.push({ from: a, to: b, miles });
  }

  return { total, legs };
}

function updateSummaryMetrics(dailyTotals) {
  const validMiles = dailyTotals
    .map(t => parseFloat(t))
    .filter(n => !isNaN(n));

  const totalSum = validMiles.reduce((acc, curr) => acc + curr, 0);
  const rate = parseFloat(rateInput.value) || 0;
  const payout = totalSum * rate;

  metricDays.textContent = validMiles.length;
  metricMiles.textContent = totalSum.toFixed(2);
  metricPayout.textContent = `$${payout.toFixed(2)}`;
  summaryCard.classList.remove("hidden");
}

rateInput.addEventListener("input", () => {
  if (calculatedDailyTotals.length > 0) {
    updateSummaryMetrics(calculatedDailyTotals);
  }
});

// ------------------------------------------------------
// UI Event Handlers
// ------------------------------------------------------
calculateBtn.addEventListener("click", async () => {
  setStatus("Working...");
  resultsDiv.classList.add("hidden");
  legsTableBody.innerHTML = "";
  totalMilesEl.textContent = "";

  if (dailyResultsDiv) dailyResultsDiv.remove();

  const rows = inputBox.value
    .split("\n")
    .map(r => r.trim())
    .filter(r => r.length > 0);

  if (!rows.length) {
    setStatus("Paste at least one row.", true);
    summaryCard.classList.add("hidden");
    return;
  }

  const allBreakdowns = [];
  calculatedDailyTotals = [];

  for (const row of rows) {
    // Flexible parsing: colons (:), arrows (->), dashes (-), commas (,), or brackets (>)
    const tokens = row
      .split(/[:\->,]+/)
      .map(t => t.trim())
      .filter(t => t.length > 0);

    if (tokens.length < 2) {
      calculatedDailyTotals.push("0.00");
      allBreakdowns.push([]);
      continue;
    }

    try {
      const { total, legs } = await processDailyRow(tokens);
      calculatedDailyTotals.push(formatMiles(total));
      allBreakdowns.push(legs);
    } catch (err) {
      console.error(err);
      calculatedDailyTotals.push("ERROR");
      allBreakdowns.push([]);
    }
  }

  updateSummaryMetrics(calculatedDailyTotals);

  dailyResultsDiv = document.createElement("div");
  dailyResultsDiv.className = "daily-output";

  let html = `
    <div class="output-header">
      <h2>Daily Mileage Output</h2>
      <button id="copyExcelBtn" class="copy-btn">📋 Copy for Excel</button>
    </div>
    <textarea id="dailyOutputText" readonly rows="${Math.max(calculatedDailyTotals.length, 3)}"
      class="output-textarea">${calculatedDailyTotals.join("\n")}</textarea>
    <p class="copy-note">Paste directly into your reimbursement spreadsheet.</p>

    <h3>Day-by-Day Breakdowns</h3>
    <ul class="day-list">
  `;

  calculatedDailyTotals.forEach((miles, idx) => {
    html += `
      <li class="day-item">
        <span><strong>Day ${idx + 1}:</strong> ${miles} miles</span>
        <button class="showBreakdownBtn" data-index="${idx}">
          Show Legs
        </button>
      </li>
    `;
  });

  html += `</ul>`;
  dailyResultsDiv.innerHTML = html;

  const container = document.getElementById("dailyResultsContainer");
  container.innerHTML = "";
  container.appendChild(dailyResultsDiv);

  // Wire up Copy Button
  const copyBtn = document.getElementById("copyExcelBtn");
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(calculatedDailyTotals.join("\n"));
    copyBtn.textContent = "✅ Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "📋 Copy for Excel";
      copyBtn.classList.remove("copied");
    }, 2000);
  });

  // Wire up breakdown buttons
  dailyResultsDiv.querySelectorAll(".showBreakdownBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      dailyResultsDiv.querySelectorAll(".showBreakdownBtn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const idx = parseInt(btn.dataset.index, 10);
      showBreakdownForDay(idx, allBreakdowns);
    });
  });

  setStatus("Done.");
});

function showBreakdownForDay(dayIndex, allBreakdowns) {
  const legs = allBreakdowns[dayIndex];

  if (!legs || !legs.length) {
    setStatus("No breakdown available for that day.", true);
    return;
  }

  legsTableBody.innerHTML = "";
  breakdownTitle.textContent = `Route Breakdown — Day ${dayIndex + 1}`;

  let total = 0;
  legs.forEach((leg, i) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${i + 1}</td>
      <td><strong>${leg.from}</strong></td>
      <td><strong>${leg.to}</strong></td>
      <td style="text-align: right;">${leg.miles.toFixed(2)}</td>
    `;
    legsTableBody.appendChild(row);
    total += leg.miles;
  });

  totalMilesEl.innerHTML = `Day Total: <strong>${total.toFixed(2)} miles</strong>`;
  resultsDiv.classList.remove("hidden");
  resultsDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showGeocodeModal(address, features) {
  return new Promise((resolve, reject) => {
    const backdrop = document.getElementById("modalBackdrop");
    const dialog = document.getElementById("modalDialog");
    const promptEl = document.getElementById("modalPrompt");
    const selectEl = document.getElementById("modalSelect");
    const btnConfirm = document.getElementById("modalConfirm");
    const btnCancel = document.getElementById("modalCancel");

    promptEl.textContent = `Multiple matches for "${address}". Pick one:`;
    selectEl.innerHTML = features
      .map((f, i) => `<option value="${i}">${f.place_name.replace(/,/g, " ·")}</option>`)
      .join("");

    backdrop.classList.remove("hidden");
    dialog.classList.remove("hidden");

    btnCancel.onclick = () => {
      backdrop.classList.add("hidden");
      dialog.classList.add("hidden");
      reject(new Error("User canceled geocode selection."));
    };

    btnConfirm.onclick = () => {
      const choice = parseInt(selectEl.value, 10);
      const feature = features[choice];
      const [lon, lat] = feature.center;

      backdrop.classList.add("hidden");
      dialog.classList.add("hidden");

      resolve({ lat, lon });
    };
  });
}