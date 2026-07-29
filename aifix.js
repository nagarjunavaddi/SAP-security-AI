/**
 * aifix.js — AI-powered targeted code fixer using the Gemini API
 *
 * USAGE:
 *   node aifix.js <filename> "<instruction describing the fix>"
 *
 * EXAMPLE:
 *   node aifix.js SOD.html "fix the filterViolationsByType function so it also applies to the Bulk Role panel"
 *
 * WHAT IT DOES:
 *   1. Reads the target file
 *   2. Sends the file content + your instruction to Gemini
 *   3. Gemini returns one or more small, targeted edits (old text -> new text)
 *      — NOT a full file rewrite, so there is no risk of it silently dropping code
 *   4. Shows you exactly what will change and asks for y/n confirmation
 *   5. Only on "y": makes a timestamped backup, then applies the edit(s)
 *
 * This script NEVER runs any git command. It only reads and writes the one
 * file you point it at.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Used instead of process.exit() to avoid a Windows/libuv crash
// ("Assertion failed ... UV_HANDLE_CLOSING") that can happen when the
// process is force-exited while a fetch() connection is still closing.
class FailError extends Error {}

function fail(message) {
  console.error('\n❌ ' + message);
  throw new FailError(message);
}

// Builds a regex that matches old_str even if whitespace (spaces, tabs,
// line endings) differs slightly from what Gemini echoed back, while still
// requiring every non-whitespace character to match exactly.
function buildFlexibleRegex(str) {
  const escaped = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = escaped.replace(/\s+/g, '\\s+');
  return new RegExp(flexible, 'g');
}

// Tries an exact match first; if that fails, falls back to whitespace-
// tolerant matching. Returns { count, matchedText } where matchedText is
// the ACTUAL text found in the file (safe to use for backup/replace).
function findMatch(content, oldStr) {
  const exactCount = content.split(oldStr).length - 1;
  if (exactCount >= 1) {
    return { count: exactCount, matchedText: oldStr };
  }
  const regex = buildFlexibleRegex(oldStr);
  const matches = [...content.matchAll(regex)];
  if (matches.length === 0) {
    return { count: 0, matchedText: null };
  }
  return { count: matches.length, matchedText: matches[0][0] };
}

async function main() {
  const [, , targetFile, instruction] = process.argv;

  if (!GEMINI_API_KEY) {
    fail('GEMINI_API_KEY not found in .env. Check the .env file in this folder.');
  }
  if (!targetFile || !instruction) {
    fail('Usage: node aifix.js <filename> "<instruction describing the fix>"');
  }

  const filePath = path.resolve(process.cwd(), targetFile);
  if (!fs.existsSync(filePath)) {
    fail(`File not found: ${filePath}`);
  }

  const originalContent = fs.readFileSync(filePath, 'utf8');
  console.log(`\n📄 Read ${targetFile} (${originalContent.length} characters)`);
  console.log(`🎯 Instruction: ${instruction}`);
  console.log('\n⏳ Asking Gemini for a fix...\n');

  const systemInstruction = {
    parts: [{
      text:
        'You are a precise code-fixing assistant. You will be given the full content of a file ' +
        'and an instruction describing what to fix. Respond ONLY with a JSON object, no markdown ' +
        'fences, matching exactly this schema:\n' +
        '{"explanation": "short plain-English summary of the fix", ' +
        '"edits": [{"old_str": "...", "new_str": "..."}]}\n\n' +
        'Rules:\n' +
        '- Each old_str MUST be copied EXACTLY (character for character, including whitespace/' +
        'indentation/line breaks) from the file content you were given, and must be long enough ' +
        'that it appears exactly once in the file.\n' +
        '- Do NOT include line numbers in old_str or new_str.\n' +
        '- Keep each edit as small and targeted as possible — do not rewrite unrelated code.\n' +
        '- If the fix requires changes in more than one place, include multiple entries in "edits".\n' +
        '- Do not invent code that was not implied by the instruction or the file content.'
    }]
  };

  const userMessage = {
    parts: [{
      text: `Instruction: ${instruction}\n\nFile name: ${targetFile}\n\nFull file content:\n${originalContent}`
    }]
  };

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction,
        contents: [userMessage],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
  } catch (err) {
    fail('Network error calling Gemini API: ' + err.message);
  }

  const data = await response.json();

  if (data.error) {
    fail('Gemini API error: ' + JSON.stringify(data.error, null, 2));
  }

  const candidate = data.candidates && data.candidates[0];
  const rawText = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

  if (!rawText) {
    fail('Gemini did not return usable content. Raw response:\n' + JSON.stringify(data, null, 2));
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    fail('Could not parse Gemini response as JSON. Raw response:\n' + rawText);
  }

  const edits = parsed.edits || [];
  if (edits.length === 0) {
    fail('Gemini returned no edits. Try rephrasing the instruction with more detail.');
  }

  // Verify every old_str matches EXACTLY ONCE (exact, or whitespace-tolerant
  // fallback) before showing/applying anything. matchedText is the real
  // text found in the file — used for backup/preview/apply so we never
  // write text that doesn't actually exist in the file.
  for (const [i, edit] of edits.entries()) {
    const { count, matchedText } = findMatch(originalContent, edit.old_str);
    if (count === 0) {
      fail(`Edit ${i + 1}: could not find the text Gemini wants to replace in the file (checked exact ` +
        `and whitespace-tolerant match). No changes were made.\n\n--- old_str Gemini returned ---\n${edit.old_str}`);
    }
    if (count > 1) {
      fail(`Edit ${i + 1}: the text Gemini wants to replace appears ${count} times in the file ` +
        `(must be unique). No changes were made.\n\n--- old_str Gemini returned ---\n${edit.old_str}`);
    }
    edit._matchedText = matchedText; // exact text as it appears in the file
  }

  // Show preview
  console.log('✅ Gemini proposes the following fix:\n');
  console.log('📝 Explanation: ' + (parsed.explanation || '(none given)') + '\n');
  edits.forEach((edit, i) => {
    console.log(`--- Change ${i + 1} of ${edits.length} ---`);
    console.log('BEFORE:');
    console.log('  ' + edit._matchedText.split('\n').join('\n  '));
    console.log('AFTER:');
    console.log('  ' + edit.new_str.split('\n').join('\n  '));
    console.log('');
  });

  if (data.usageMetadata) {
    const inTok = data.usageMetadata.promptTokenCount || 0;
    const outTok = data.usageMetadata.candidatesTokenCount || 0;
    console.log(`📊 Tokens used: ${inTok} in / ${outTok} out (gemini-2.5-flash pricing — negligible cost)\n`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`Apply ${edits.length} change(s) to ${targetFile}? (y/n): `, resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\n🚫 Cancelled. No changes made.');
    return;
  }

  // Backup first
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak.${timestamp}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`\n💾 Backup saved: ${path.basename(backupPath)}`);

  // Apply edits using the verified matchedText (not the raw old_str Gemini
  // returned), so this always replaces exactly what was previewed.
  let updatedContent = originalContent;
  for (const edit of edits) {
    updatedContent = updatedContent.replace(edit._matchedText, edit.new_str);
  }

  fs.writeFileSync(filePath, updatedContent, 'utf8');
  console.log(`✅ Applied ${edits.length} change(s) to ${targetFile}`);
  console.log('\n👉 This script did NOT touch git. Review the file, test it, then commit/push manually when ready.');
}

main()
  .catch((err) => {
    if (!(err instanceof FailError)) {
      console.error('\n❌ Unexpected error:', err.message || err);
    }
    process.exitCode = 1;
  });
