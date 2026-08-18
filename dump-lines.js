// dump-lines.js  (read-only helper: print a line range of a file, with line numbers)
// Usage:  node dump-lines.js <file> <startLine> <endLine>
// Example: node dump-lines.js server.js 253 535

const fs = require('fs');

const file = process.argv[2];
const a = parseInt(process.argv[3], 10);
const b = parseInt(process.argv[4], 10);

if (!file || !a || !b) {
  console.error('Usage: node dump-lines.js <file> <startLine> <endLine>');
  process.exit(1);
}

const L = fs.readFileSync(file, 'utf8').split(/\r?\n/);
L.slice(a - 1, b).forEach(function (ln, i) {
  console.log((a + i) + ': ' + ln);
});
