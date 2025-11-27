//------------------------------------------------------------
// CONFIG
//------------------------------------------------------------

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "YOUR_MAPBOX_TOKEN_HERE";

// IMPORTANT: Your short-code → address mapping
// You can hide HOME using environment variables if desired
// Example: HOME: process.env.HOME_ADDR
const LOCATION_ALIAS = {
  HOME: process.env.HOME_ADDR || "123 Fake St, Springfield IL",
  LS: "200 Lakeshore Rd, Springfield IL",
  JACOBS: "14 Jacobs Ct, Springfield IL",
  OFFICE: "500 Corporate Dr, Springfield IL"
};

// Output file
const OUTPUT_JS_FILE = "mileageTable.js";

// Cache files (to avoid repeated API billing)
const GEO_CACHE_FILE   = "geoCache.json";
const ROUTE_CACHE_FILE = "routeCache.json";


//------------------------------------------------------------
// LIBS
//------------------------------------------------------------
const fs = require("fs");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));


//------------------------------------------------------------
// LOAD / SAVE CACHE HELPERS
//------------------------------------------------------------
function loadCache(path) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path)) : {};
}

function saveCache(path, obj) {
  fs.writeFileSync(path, JSON.stringify(obj, null, 2));
}

let geoCache   = loadCache(GEO_CACHE_FILE);
let routeCache = loadCache(ROUTE_CACHE_FILE);


//------------------------------------------------------------
// API HELPERS
//------------------------------------------------------------
async function geocode(address) {
  if (geoCache[address]) return geoCache[address];

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/` +
    `${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=1`;

  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`Geocode failed for ${address}`);

  const data = await rsp.json();
  if (!data.features || data.features.length === 0)
    throw new Error(`No geocode match for ${address}`);

  const [lon, lat] = data.features[0].center;
  geoCache[address] = { lat, lon };
  return geoCache[address];
}

async function getMeters(coordA, coordB, pairKey) {
  if (routeCache[pairKey]) return routeCache[pairKey];

  const coordStr = `${coordA.lon},${coordA.lat};${coordB.lon},${coordB.lat}`;

  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${coordStr}?access_token=${MAPBOX_TOKEN}&overview=false`;

  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`Route lookup failed for ${pairKey}`);

  const data = await rsp.json();
  if (!data.routes || !data.routes.length)
    throw new Error(`No route for ${pairKey}`);

  const meters = data.routes[0].distance;
  routeCache[pairKey] = meters;
  return meters;
}

function metersToMiles(m) {
  return m / 1609.344;
}


//------------------------------------------------------------
// MAIN SCRIPT
//------------------------------------------------------------
(async () => {
  console.log("=== Starting mileage table generation ===");

  //----------------------------------------------------------
  // GEOCODE ALL LOCATIONS FIRST
  //----------------------------------------------------------
  const keys = Object.keys(LOCATION_ALIAS);
  const coords = {};

  console.log("\n=== Geocoding ===");
  for (const key of keys) {
    const addr = LOCATION_ALIAS[key];
    console.log(`Geocoding ${key}: ${addr}`);
    coords[key] = await geocode(addr);
  }

  //----------------------------------------------------------
  // BUILD UNIQUE PAIRS (A<B alphabetically)
  //----------------------------------------------------------
  const table = {};

  console.log("\n=== Computing Distances (unique pairs only) ===");
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const A = keys[i];
      const B = keys[j];
      const pairKey = `${A}|${B}`;

      console.log(`Route ${A} ↔ ${B}`);

      const meters = await getMeters(coords[A], coords[B], pairKey);
      const miles = parseFloat(metersToMiles(meters).toFixed(2));

      table[`${A}|${B}`] = miles;
      table[`${B}|${A}`] = miles;
    }
  }

  //----------------------------------------------------------
  // SAVE CACHES
  //----------------------------------------------------------
  console.log("\n=== Saving caches ===");
  saveCache(GEO_CACHE_FILE, geoCache);
  saveCache(ROUTE_CACHE_FILE, routeCache);

  //----------------------------------------------------------
  // OUTPUT TABLE FILE
  //----------------------------------------------------------
  console.log("\n=== Writing mileageTable.js ===");
  const jsOut =
    `// Auto-generated mileage table\n\n` +
    `const MILEAGE_TABLE = ${JSON.stringify(table, null, 2)};\n\n` +
    `export default MILEAGE_TABLE;\n`;

  fs.writeFileSync(OUTPUT_JS_FILE, jsOut);

  console.log(`\nDone! Mileage table saved to ${OUTPUT_JS_FILE}`);
})();
