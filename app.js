// =======================
// CONFIG
// =======================

// Replace this with your actual Mapbox token
const MAPBOX_TOKEN = "YOUR_MAPBOX_ACCESS_TOKEN_HERE";

// Geocoding + Directions base URLs
const MAPBOX_GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

// =======================
// DOM ELEMENTS
// =======================

const locationsInput = document.getElementById("locations");
const calculateBtn = document.getElementById("calculateBtn");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");
const totalMilesEl = document.getElementById("totalMiles");
const legsTableBody = document.querySelector("#legsTable tbody");
const roundTripCheckbox = document.getElementById("roundTrip");

// =======================
// UTILS
// =======================

function setStatus(message, isError = false) {
  statusDiv.textContent = message || "";
  statusDiv.classList.toggle("error", !!isError);
}

function metersToMiles(meters) {
  return meters / 1609.344;
}

function formatMiles(miles) {
  return miles.toFixed(2);
}

// =======================
// API CALLS
// =======================

async function geocodeAddress(address) {
  const url = `${MAPBOX_GEOCODE_URL}/${encodeURIComponent(
    address
  )}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Geocoding failed for "${address}" (HTTP ${resp.status})`
    );
  }

  const data = await resp.json();
  if (!data.features || data.features.length === 0) {
    throw new Error(`No match found for "${address}"`);
  }

  const feature = data.features[0];
  // Mapbox uses [lon, lat]
  const [lon, lat] = feature.center;
  return { address, lon, lat };
}

async function getRoute(coordinates) {
  // coordinates: array of {lon, lat}
  const coordsStr = coordinates
    .map((c) => `${c.lon},${c.lat}`)
    .join(";");

  const url =
    `${MAPBOX_DIRECTIONS_URL}/${coordsStr}` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&overview=false&steps=false&geometries=geojson`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Directions failed (HTTP ${resp.status})`);
  }

  const data = await resp.json();
  if (!data.routes || data.routes.length === 0) {
    throw new Error("No route found for given locations");
  }

  return data.routes[0]; // route has .distance (m) and .legs[]
}

// =======================
// MAIN LOGIC
// =======================

async function calculateMileage() {
  // Reset UI state
  setStatus("");
  resultsDiv.classList.add("hidden");
  legsTableBody.innerHTML = "";
  totalMilesEl.textContent = "";

  const rawLines = locationsInput.value.split("\n");
  let locations = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);

  if (locations.length < 2) {
    setStatus("Enter at least two locations.", true);
    return;
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN === "YOUR_MAPBOX_ACCESS_TOKEN_HERE") {
    setStatus(
      "You need to set your Mapbox token in app.js before this will work.",
      true
    );
    return;
  }

  // Round trip option: append first location to the end
  if (roundTripCheckbox.checked) {
    locations = [...locations, locations[0]];
  }

  setStatus("Geocoding locations...");
  calculateBtn.disabled = true;

  try {
    // 1. Geocode all addresses in parallel
    const geocoded = await Promise.all(
      locations.map((loc) => geocodeAddress(loc))
    );

    // 2. Request directions for the full sequence
    setStatus("Requesting route and calculating distance...");
    const route = await getRoute(geocoded);

    const totalMeters = route.distance;
    const totalMiles = metersToMiles(totalMeters);

    // 3. Per-leg breakdown (Mapbox gives legs in order)
    // Each leg corresponds to [i] -> [i+1]
    const legs = route.legs || [];
    legsTableBody.innerHTML = "";

    if (legs.length === 0) {
      // Fallback: just pretend one leg, whole distance
      for (let i = 0; i < geocoded.length - 1; i++) {
        const row = document.createElement("tr");
        const miles = metersToMiles(totalMeters);
        row.innerHTML = `
          <td>${i + 1}</td>
          <td>${geocoded[i].address}</td>
          <td>${geocoded[i + 1].address}</td>
          <td>${formatMiles(miles)}</td>
        `;
        legsTableBody.appendChild(row);
      }
    } else {
      legs.forEach((leg, idx) => {
        const from = geocoded[idx].address;
        const to = geocoded[idx + 1].address;
        const legMiles = metersToMiles(leg.distance);

        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${idx + 1}</td>
          <td>${from}</td>
          <td>${to}</td>
          <td>${formatMiles(legMiles)}</td>
        `;
        legsTableBody.appendChild(row);
      });
    }

    totalMilesEl.textContent = `Total distance: ${formatMiles(
      totalMiles
    )} miles`;

    resultsDiv.classList.remove("hidden");
    setStatus("Done.");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    calculateBtn.disabled = false;
  }
}

// =======================
// EVENT WIRING
// =======================

calculateBtn.addEventListener("click", () => {
  calculateMileage();
});
