import fs from 'node:fs';
import { LOCATION_ALIAS } from './src/locationAlias.js';

const MAPBOX_TOKEN = "pk.eyJ1IjoibWF0dGhpYXN3IiwiYSI6ImNtaWc2anViaDAwZDkzY3ExZ20waml0ZnQifQ.ncDM-q4piCtrnbVIw4uexw";

function metersToMiles(m) {
  return m / 1609.344;
}

async function geocode(address) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`Geocode failed for: ${address}`);
  const data = await rsp.json();
  if (!data.features?.length) throw new Error(`No match for: ${address}`);
  const [lon, lat] = data.features[0].center;
  return { lat, lon };
}

async function routeMeters(from, to) {
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${MAPBOX_TOKEN}&overview=false`;
  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`Route failed between ${coords}`);
  const data = await rsp.json();
  if (!data.routes?.length) throw new Error(`No route found for ${coords}`);
  return data.routes[0].distance;
}

// Small delay helper to respect rate limits
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const aliases = Object.keys(LOCATION_ALIAS);
  console.log(`Geocoding ${aliases.length} locations...`);
  
  const coords = {};
  for (const alias of aliases) {
    console.log(`  Geocoding ${alias}...`);
    coords[alias] = await geocode(LOCATION_ALIAS[alias]);
    await sleep(200);
  }

  const table = {};
  console.log("Calculating pairwise route distances...");

  for (let i = 0; i < aliases.length; i++) {
    for (let j = i + 1; j < aliases.length; j++) {
      const a = aliases[i];
      const b = aliases[j];

      console.log(`  Routing ${a} <-> ${b}...`);
      const meters = await routeMeters(coords[a], coords[b]);
      const miles = parseFloat((metersToMiles(meters)).toFixed(2));

      table[`${a}|${b}`] = miles;
      table[`${b}|${a}`] = miles;
      await sleep(250);
    }
  }

  const fileContent = `// Auto-generated mileage table\n\nexport const MILEAGE_TABLE = ${JSON.stringify(table, null, 2)};\n\n// Generated on ${new Date().toISOString()}\n`;

  fs.writeFileSync('./src/mileageTable.js', fileContent);
  fs.writeFileSync('./docs/mileageTable.js', fileContent);
  console.log("Updated src/mileageTable.js and docs/mileageTable.js successfully!");
}

main().catch(console.error);