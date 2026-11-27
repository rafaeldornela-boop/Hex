#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProceduralKingdomWorld, WORLD_COLS, WORLD_ROWS } from '../lib/world-generator.ts';
import { HEX_ASSETS } from '../lib/repo-data.ts';
import { getRiverPieceExits, isRiverPieceName } from '../lib/river-pieces.ts';
import { AXIAL_DIRECTIONS } from '../lib/territory-engine.ts';
import { hexKey } from '../lib/hex-engine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SEEDS = [42026, 42027, 11111, 22222, 33333, 99999];

const rawArgs = process.argv.slice(2);
const seeds = rawArgs.length > 0 ? rawArgs.map(Number).filter((n) => !Number.isNaN(n)) : DEFAULT_SEEDS;

function getGlyph(tile) {
  const asset = HEX_ASSETS[tile.structureIndex];
  const name = asset?.name ?? '';

  if (name === 'building-castle') return 'C';
  if (name === 'river-start') return 'S';
  if (name === 'river-end') return 'E';
  if (isRiverPieceName(name)) return 'R';
  if (name === 'sand' || name === 'sand-rocks') return '_';
  if (tile.terrainType === 'water') return '~';
  if (tile.terrainType === 'mountain') return 'M';
  if (tile.terrainType === 'forest') return 'F';
  if (tile.terrainType === 'fertile') return 'f';
  return '.';
}

const lines = [];
function out(str = '') {
  console.log(str);
  lines.push(str);
}

out('================================================================');
out('           HEX 32x32 PROCEDURAL MAP ASCII DUMP & QA             ');
out('================================================================');
out(`Seeds: ${seeds.join(', ')}\n`);

const summaryTable = [];

for (const seed of seeds) {
  const t0 = performance.now();
  const world = generateProceduralKingdomWorld(HEX_ASSETS, seed);
  const t1 = performance.now();
  const genTimeMs = t1 - t0;

  const hexes = world.worldState.hexes;
  const cols = WORLD_COLS;
  const rows = WORLD_ROWS;
  const halfCols = Math.floor(cols / 2);
  const halfRows = Math.floor(rows / 2);

  let riverCount = 0;
  let sourceCount = 0;
  let mouthCount = 0;
  let channelCount = 0;
  let brokenExits = 0;
  let landlockedRivers = 0;
  let beachCount = 0;

  for (const [k, tile] of Object.entries(hexes)) {
    const asset = HEX_ASSETS[tile.structureIndex];
    if (asset && isRiverPieceName(asset.name)) {
      riverCount++;
      if (asset.name === 'river-start') sourceCount++;
      else if (asset.name === 'river-end') mouthCount++;
      else channelCount++;

      const exits = getRiverPieceExits(asset.name, tile.orientation);
      for (const dir of exits) {
        const offset = AXIAL_DIRECTIONS[dir];
        const nk = hexKey(tile.q + offset.q, tile.r + offset.r);
        const neighbor = hexes[nk];
        if (!neighbor) {
          brokenExits++;
          continue;
        }
        const nAsset = HEX_ASSETS[neighbor.structureIndex];
        if (!nAsset || !isRiverPieceName(nAsset.name)) {
          brokenExits++;
        } else {
          const nExits = getRiverPieceExits(nAsset.name, neighbor.orientation);
          if (!nExits.includes((dir + 3) % 6)) {
            brokenExits++;
          }
        }
      }
    } else if (asset && (asset.name === 'sand' || asset.name === 'sand-rocks')) {
      beachCount++;
    }
  }

  summaryTable.push({
    seed,
    biome: world.biomeProfile,
    timeMs: genTimeMs.toFixed(2),
    rivers: riverCount,
    sources: sourceCount,
    mouths: mouthCount,
    channels: channelCount,
    beaches: beachCount,
    broken: brokenExits,
  });

  out(`----------------------------------------------------------------`);
  out(`SEED: ${seed} | Biome: ${world.biomeProfile} | Time: ${genTimeMs.toFixed(2)} ms`);
  out(`Rivers: ${riverCount} (Sources: ${sourceCount}, Mouths: ${mouthCount}, Channels: ${channelCount})`);
  out(`Beaches: ${beachCount} | Broken Exits: ${brokenExits} | Capital: (${world.playerCapital.q}, ${world.playerCapital.r})`);
  out(`----------------------------------------------------------------`);

  // Render 2D grid: row by col
  // In world-generator:
  // q = col - halfCols
  // r = row - halfRows - Math.floor(q / 2)
  for (let row = rows - 1; row >= 0; row--) {
    let rowStr = (row % 2 === 1 ? ' ' : '');
    for (let col = 0; col < cols; col++) {
      const q = col - halfCols;
      const rowOffset = Math.floor(q / 2);
      const r = row - halfRows - rowOffset;
      const tile = hexes[hexKey(q, r)];
      rowStr += (tile ? getGlyph(tile) : ' ') + ' ';
    }
    out(rowStr);
  }
  out();
}

out('================================================================');
out('SUMMARY TABLE');
out('================================================================');
out('Seed   | Biome            | Gen Time | Rivers | S/M   | Beaches | Broken');
out('-------+------------------+----------+--------+-------+---------+-------');
for (const row of summaryTable) {
  const sStr = String(row.seed).padEnd(6);
  const bStr = row.biome.padEnd(16);
  const tStr = `${row.timeMs} ms`.padEnd(8);
  const rStr = String(row.rivers).padStart(6);
  const smStr = `${row.sources}/${row.mouths}`.padStart(5);
  const beachStr = String(row.beaches).padStart(7);
  const brkStr = String(row.broken).padStart(6);
  out(`${sStr} | ${bStr} | ${tStr} | ${rStr} | ${smStr} | ${beachStr} | ${brkStr}`);
}
out('================================================================');
out('LEGEND: S = River Source, E = River Mouth (foz), R = River Channel');
out('        ~ = Water/Sea,    _ = Beach (Sand),      . = Plains');
out('        F = Forest,       M = Mountain,          f = Fertile');
out('        C = Player Capital');
out('================================================================');

// Save artifact text file
const artifactDir = path.join(process.cwd(), 'artifacts');
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}
const outPath = path.join(artifactDir, 'map-ascii-dump.txt');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
out(`Saved artifact to ${outPath}\n`);

// Exit code based on broken river exits
const totalBroken = summaryTable.reduce((acc, row) => acc + row.broken, 0);
if (totalBroken > 0) {
  console.error(`ERROR: Found ${totalBroken} broken river exits!`);
  process.exit(1);
} else {
  out('ALL RIVER EXITS 100% VALIDATED: ZERO BROKEN EXITS!');
  process.exit(0);
}
