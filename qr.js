/**
 * A QR encoder, written out here rather than pulled in: the site loads nothing
 * from anywhere but GitHub, so a library on a CDN is not an option.
 *
 * Only what the setup code needs exists — byte mode, error correction level M,
 * versions 1 to 10. That is room for 213 bytes, which is a link with a token in
 * it twice over.
 *
 * ISO/IEC 18004 is the reference throughout; section numbers are quoted where
 * the reason for something is not visible from the code.
 */

const MODE_BYTE = 0b0100;
const ECC_LEVEL_M = 0b00;

// What the standard fills the last of the data with, alternating, once the
// message and its terminator have run out.
const PAD_BYTES = [0xec, 0x11];

/**
 * Per version, at error correction level M: how many codewords the symbol holds
 * altogether, how many of each block are error correction, and how many blocks
 * there are. The data is split between the blocks as evenly as it divides, and
 * the codewords left over go one each to the blocks at the end.
 */
const VERSIONS = [
  { codewords: 26, ecPerBlock: 10, blocks: 1 },
  { codewords: 44, ecPerBlock: 16, blocks: 1 },
  { codewords: 70, ecPerBlock: 26, blocks: 1 },
  { codewords: 100, ecPerBlock: 18, blocks: 2 },
  { codewords: 134, ecPerBlock: 24, blocks: 2 },
  { codewords: 172, ecPerBlock: 16, blocks: 4 },
  { codewords: 196, ecPerBlock: 18, blocks: 4 },
  { codewords: 242, ecPerBlock: 22, blocks: 4 },
  { codewords: 292, ecPerBlock: 22, blocks: 5 },
  { codewords: 346, ecPerBlock: 26, blocks: 5 },
];

// Rows and columns the alignment patterns are centred on, per version. Every
// pairing of two of them is a centre, bar the three that land on a finder.
const ALIGNMENT_CENTRES = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const spec = (version) => VERSIONS[version - 1];

// Byte mode states the length in eight bits up to version 9 and sixteen after.
const countBits = (version) => (version <= 9 ? 8 : 16);

const dataCodewordCount = (version) => {
  const { codewords, ecPerBlock, blocks } = spec(version);
  return codewords - ecPerBlock * blocks;
};

/** How many bytes of text fit, once the mode and the length have had their bits. */
const capacity = (version) =>
  Math.floor((dataCodewordCount(version) * 8 - 4 - countBits(version)) / 8);

function versionFor(byteLength) {
  for (let version = 1; version <= VERSIONS.length; version += 1) {
    if (byteLength <= capacity(version)) return version;
  }
  throw new Error(`${byteLength} bytes is too long for a QR code this size`);
}

/* ------------------------------------------------------------------ GF(256) */

// Reed-Solomon arithmetic happens in the field the standard names: bytes, with
// x^8 + x^4 + x^3 + x^2 + 1 as the polynomial that keeps them bytes.
const PRIMITIVE = 0x11d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

for (let power = 0, value = 1; power < 255; power += 1) {
  EXP[power] = value;
  LOG[value] = power;
  value <<= 1;
  if (value & 0x100) value ^= PRIMITIVE;
}
// Doubled, so a sum of two logarithms never has to be brought back into range.
for (let power = 255; power < 512; power += 1) EXP[power] = EXP[power - 255];

const multiply = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** (x - α⁰)(x - α¹)…, highest power first — the divisor the check bytes come from. */
function generator(degree) {
  let polynomial = [1];
  for (let root = 0; root < degree; root += 1) {
    const next = new Array(polynomial.length + 1).fill(0);
    for (let term = 0; term < polynomial.length; term += 1) {
      next[term] ^= polynomial[term];
      next[term + 1] ^= multiply(polynomial[term], EXP[root]);
    }
    polynomial = next;
  }
  return polynomial;
}

/** The error correction codewords for one block: long division, remainder kept. */
function checkBytes(data, count) {
  const divisor = generator(count);
  const working = new Uint8Array(data.length + count);
  working.set(data);
  for (let at = 0; at < data.length; at += 1) {
    const factor = working[at];
    if (factor === 0) continue;
    for (let term = 0; term < divisor.length; term += 1) {
      working[at + term] ^= multiply(divisor[term], factor);
    }
  }
  return working.subarray(data.length);
}

/* --------------------------------------------------------------- codewords */

/** The message as codewords: mode, length, the bytes themselves, then padding. */
function dataCodewords(bytes, version) {
  const total = dataCodewordCount(version);
  const bits = [];
  const push = (value, length) => {
    for (let shift = length - 1; shift >= 0; shift -= 1) bits.push((value >> shift) & 1);
  };

  push(MODE_BYTE, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  // The terminator is four zero bits, or fewer if there is not room for four.
  push(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);

  const codewords = new Uint8Array(total);
  for (let at = 0; at < bits.length; at += 8) {
    codewords[at / 8] = bits.slice(at, at + 8).reduce((byte, bit) => (byte << 1) | bit, 0);
  }
  for (let at = bits.length / 8, pad = 0; at < total; at += 1, pad += 1) {
    codewords[at] = PAD_BYTES[pad % 2];
  }
  return codewords;
}

/**
 * The codewords in the order they are written into the symbol: taken a column
 * at a time across the blocks rather than a block at a time, so that a scuff on
 * the paper is spread thinly over every block instead of destroying one.
 */
function interleave(data, version) {
  const { ecPerBlock, blocks } = spec(version);
  const shortest = Math.floor(data.length / blocks);
  const longBlocks = data.length % blocks;

  const dataBlocks = [];
  const ecBlocks = [];
  for (let index = 0, at = 0; index < blocks; index += 1) {
    const length = shortest + (index >= blocks - longBlocks ? 1 : 0);
    const block = data.subarray(at, at + length);
    at += length;
    dataBlocks.push(block);
    ecBlocks.push(checkBytes(block, ecPerBlock));
  }

  const ordered = [];
  for (let at = 0; at <= shortest; at += 1) {
    for (const block of dataBlocks) if (at < block.length) ordered.push(block[at]);
  }
  for (let at = 0; at < ecPerBlock; at += 1) {
    for (const block of ecBlocks) ordered.push(block[at]);
  }
  return ordered;
}

/* ------------------------------------------------------------- the symbol */

/**
 * The symbol with every fixed pattern on it and everything else still blank.
 * `fixed` marks the modules that belong to a pattern — the data steps around
 * them, and the mask leaves them alone.
 */
function blankSymbol(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));

  const set = (row, col, dark) => {
    modules[row][col] = dark ? 1 : 0;
    fixed[row][col] = 1;
  };

  // The three finders, each with its light separator along the inner edges.
  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let col = -1; col <= 7; col += 1) {
        if (top + row < 0 || top + row >= size || left + col < 0 || left + col >= size) continue;
        const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
        set(top + row, left + col, ring !== 2 && ring <= 3);
      }
    }
  }

  // The timing patterns, alternating between the finders on row and column 6.
  for (let at = 8; at < size - 8; at += 1) {
    set(6, at, at % 2 === 0);
    set(at, 6, at % 2 === 0);
  }

  // The alignment patterns, wherever two centres meet clear of a finder.
  const centres = ALIGNMENT_CENTRES[version - 1];
  const [first] = centres;
  const last = centres[centres.length - 1];
  const onFinder = (row, col) =>
    (row === first && col === first) ||
    (row === first && col === last) ||
    (row === last && col === first);

  for (const centreRow of centres) {
    for (const centreCol of centres) {
      if (onFinder(centreRow, centreCol)) continue;
      for (let row = -2; row <= 2; row += 1) {
        for (let col = -2; col <= 2; col += 1) {
          const ring = Math.max(Math.abs(row), Math.abs(col));
          set(centreRow + row, centreCol + col, ring !== 1);
        }
      }
    }
  }

  // The one module that is always dark and belongs to no pattern (§ 7.9.1).
  set(size - 8, 8, true);

  // The format and version areas are claimed now and written after masking, so
  // the data places itself around them.
  for (const positions of [...formatCells(size), ...versionCells(size, version)]) {
    for (const [row, col] of positions) set(row, col, false);
  }

  return { modules, fixed };
}

/**
 * Where each of the fifteen format bits goes, least significant first. Every
 * bit is written twice — once around the top-left finder, once split between
 * the other two — so that either copy alone is enough to read the symbol.
 */
function formatCells(size) {
  const cells = [];
  for (let bit = 0; bit < 15; bit += 1) {
    // The first copy runs down column 8 and then left along row 8, stepping
    // over the timing pattern that crosses both at 6.
    let around;
    if (bit < 6) around = [bit, 8];
    else if (bit < 8) around = [bit + 1, 8];
    else if (bit === 8) around = [8, 7];
    else around = [8, 14 - bit];

    const split = bit < 8 ? [8, size - 1 - bit] : [size - 15 + bit, 8];
    cells.push([around, split]);
  }
  return cells;
}

/**
 * Where each of the eighteen version bits goes, least significant first, in the
 * two blocks beside the top-right and bottom-left finders. Versions below 7 are
 * small enough to be recognised by their size alone and carry none of this.
 */
function versionCells(size, version) {
  if (version < 7) return [];
  const cells = [];
  for (let bit = 0; bit < 18; bit += 1) {
    const along = Math.floor(bit / 3);
    const across = size - 11 + (bit % 3);
    cells.push([
      [along, across],
      [across, along],
    ]);
  }
  return cells;
}

/**
 * Write the codewords in, running up and down two-module columns from the
 * bottom right. Column 6 is stepped over: the timing pattern lives there.
 */
function placeData(codewords, modules, fixed) {
  const size = modules.length;
  let bit = 0;
  const nextBit = () => {
    // Symbols have a few modules more than the codewords fill; those stay light.
    const value = bit < codewords.length * 8 ? (codewords[bit >> 3] >> (7 - (bit % 8))) & 1 : 0;
    bit += 1;
    return value;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!fixed[row][col]) modules[row][col] = nextBit();
      }
    }
    upward = !upward;
  }
}

/* ----------------------------------------------------------------- masking */

// § 7.8.2. One of these is laid over the data so that no message, however
// unlucky, produces a symbol a scanner struggles with.
const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

// § 7.8.3, table 11: what each thing that makes a symbol hard to read costs.
const RUN_PENALTY = 3; // for the first five same-coloured modules in a line
const BLOCK_PENALTY = 3; // for each same-coloured two by two
const FINDER_LIKE_PENALTY = 40; // for anything a scanner might read as a finder
const IMBALANCE_PENALTY = 10; // for each 5% the symbol strays from half dark

// The 1:1:3:1:1 proportions of a finder pattern, with the four light modules
// that have to stand on one side of them — near enough to a real finder that a
// scanner may go looking for a corner that is not there.
const FINDER_LIKE = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
];

function finderLikeCount(line) {
  let found = 0;
  for (let at = 0; at + FINDER_LIKE[0].length <= line.length; at += 1) {
    const matches = (pattern) => pattern.every((module, offset) => line[at + offset] === module);
    if (FINDER_LIKE.some(matches)) found += 1;
  }
  return found;
}

/** How poorly a masked symbol is expected to scan. Lower is better. */
function penalty(modules) {
  const size = modules.length;
  let score = 0;
  let dark = 0;

  const lines = [];
  for (let at = 0; at < size; at += 1) {
    lines.push(modules[at], Uint8Array.from(modules, (row) => row[at]));
  }

  for (const line of lines) {
    let run = 1;
    for (let at = 1; at < size; at += 1) {
      if (line[at] === line[at - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += RUN_PENALTY + run - 5;
        run = 1;
      }
    }
    if (run >= 5) score += RUN_PENALTY + run - 5;
    score += FINDER_LIKE_PENALTY * finderLikeCount(line);
  }

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      dark += modules[row][col];
      if (row === 0 || col === 0) continue;
      const module = modules[row][col];
      if (
        module === modules[row - 1][col] &&
        module === modules[row][col - 1] &&
        module === modules[row - 1][col - 1]
      ) {
        score += BLOCK_PENALTY;
      }
    }
  }

  const percentDark = (dark * 100) / (size * size);
  return score + IMBALANCE_PENALTY * Math.floor(Math.abs(percentDark - 50) / 5);
}

/* -------------------------------------------------------- format & version */

const FORMAT_DIVISOR = 0b101_0011_0111;
const VERSION_DIVISOR = 0b1_1111_0010_0101;
// Applied to the format bits so that an all-zero format is still recognisable.
const FORMAT_MASK = 0b101_0100_0001_0010;

const bitLength = (value) => 32 - Math.clz32(value);

/** The BCH check bits: the same long division, one bit wide instead of one byte. */
function bch(value, divisor) {
  let remainder = value;
  while (bitLength(remainder) >= bitLength(divisor)) {
    remainder ^= divisor << (bitLength(remainder) - bitLength(divisor));
  }
  return remainder;
}

function formatInfo(mask) {
  const data = ((ECC_LEVEL_M << 3) | mask) << 10;
  return (data | bch(data, FORMAT_DIVISOR)) ^ FORMAT_MASK;
}

const versionInfo = (version) => (version << 12) | bch(version << 12, VERSION_DIVISOR);

/* ------------------------------------------------------------------ public */

/**
 * `text` as a QR symbol: an array of rows of modules, 1 dark and 0 light, with
 * no quiet zone. Throws when the text is longer than version 10 can carry.
 */
export function qrModules(text) {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);

  const { modules, fixed } = blankSymbol(version);
  placeData(codewords, modules, fixed);

  // Every mask is tried and the one that scores best is kept. The format and
  // version information is not part of that judgement (§ 7.8), so it goes on
  // afterwards — by which point the mask it announces is known.
  let best;
  for (const [mask, covers] of MASKS.entries()) {
    const masked = modules.map((row, rowIndex) =>
      Uint8Array.from(row, (module, col) =>
        fixed[rowIndex][col] ? module : module ^ (covers(rowIndex, col) ? 1 : 0)
      )
    );
    const score = penalty(masked);
    if (!best || score < best.score) best = { score, mask, masked };
  }

  const write = (value, cells) => {
    cells.forEach((positions, bit) => {
      for (const [row, col] of positions) best.masked[row][col] = (value >> bit) & 1;
    });
  };
  write(formatInfo(best.mask), formatCells(modules.length));
  write(versionInfo(version), versionCells(modules.length, version));

  return best.masked;
}

// Scanners need light around a symbol as much as they need the symbol (§ 6.3.8).
const QUIET_ZONE = 4;

/**
 * `text` as an SVG element, sized by its viewBox so the page decides how big it
 * is drawn, and named by `label` for anyone reading the page rather than
 * looking at it. Its own light background is painted in: a dark page behind a
 * symbol inverts it, and an inverted symbol does not scan.
 */
export function qrSvg(text, label = "QR code") {
  const modules = qrModules(text);
  const span = modules.length + QUIET_ZONE * 2;

  let path = "";
  modules.forEach((row, rowIndex) => {
    row.forEach((module, col) => {
      if (module) path += `M${col + QUIET_ZONE} ${rowIndex + QUIET_ZONE}h1v1h-1z`;
    });
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${label}">` +
    `<rect width="${span}" height="${span}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}
