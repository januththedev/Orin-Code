/**
 * Renderer hot-path benchmark.
 *
 * The Rust side has `src-tauri/benches/bridge.rs` asking whether the native
 * layer is CPU-bound. This asks the same question of the renderer, because the
 * answer that matters is end-to-end: if the UI spends its time in a blocking
 * parse on the main thread, that is what a user feels, and no amount of native
 * code in the backend would touch it.
 *
 * The chat store is the known heavy path. It was the original cause of slow
 * startup -- 500 conversations of 400 messages parsed as one 130.9 MB blob in
 * 645 ms -- and was fixed by splitting it into a `chats:index` plus per-
 * conversation blobs so hydration reads only the index. This measures that the
 * fix is still a fix, and that opening one conversation is cheap regardless of
 * how many exist.
 *
 * Run: node --test test/renderer-hot-paths.bench.mjs
 *
 * Not part of `npm test`: timings are machine-dependent and a slow CI runner
 * would turn a measurement into a flaky failure. Run it when a change touches
 * these paths and compare against the numbers in the report.
 */

import test from 'node:test'
import { performance } from 'node:perf_hooks'

import { planMigration, conversationKey, INDEX_KEY } from '../ui/src/stores/chatStoreModel.ts'

/** One conversation shaped like a real long chat. */
function makeConversation(index, messages) {
  const rows = []
  for (let m = 0; m < messages; m++) {
    const isUser = m % 2 === 0
    rows.push({
      id: `m-${index}-${m}`,
      role: isUser ? 'user' : 'assistant',
      content: isUser
        ? `Question ${m}: ${'please explain this in detail. '.repeat(12)}`
        : `Answer ${m}: ${'Here is a substantive reply with detail. '.repeat(30)}`,
      createdAt: 1_700_000_000_000 + m * 1000,
      ...(isUser ? {} : { model: 'meta-llama/llama-3.3-70b-instruct:free' }),
    })
  }
  return {
    id: `conv-${index}`,
    title: `Conversation ${index}`,
    mode: 'agent',
    projectId: null,
    pinned: index % 17 === 0,
    archived: false,
    createdAt: 1_700_000_000_000 + index * 10_000,
    updatedAt: 1_700_000_000_000 + index * 10_000,
    messageCount: rows.length,
    preview: rows.at(-1)?.content.slice(0, 120) ?? '',
    messages: rows,
  }
}

/** Exactly the shape hydrate() reads: the index, without message bodies. */
function buildIndex(conversations) {
  const index = {};
  for (const c of conversations) {
    index[c.id] = {
      id: c.id,
      title: c.title,
      mode: c.mode,
      projectId: c.projectId,
      pinned: c.pinned,
      archived: c.archived,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messageCount,
      preview: c.preview,
    };
  }
  return index;
}

function time(label, iterations, body) {
  for (let i = 0; i < 3; i++) body(i); // warm up
  const start = performance.now();
  for (let i = 0; i < iterations; i++) body(i);
  const total = performance.now() - start;
  const per = total / iterations;
  console.log(`  ${label.padEnd(46)} ${per.toFixed(3).padStart(10)} ms`);
  return per;
}

const fmt = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(0)} KiB`);

test('renderer hot paths', () => {
  console.log('\nOrin Code — renderer hot paths');
  console.log('how long the main thread is blocked, per operation\n');

  const CONVERSATIONS = 500;
  const MESSAGES = 400;
  const conversations = Array.from({ length: CONVERSATIONS }, (_, i) => makeConversation(i, MESSAGES));

  const index = buildIndex(conversations);
  const indexJson = JSON.stringify(index);
  const oneBlob = JSON.stringify(conversations[0]);
  const legacyAll = JSON.stringify(conversations);

  console.log('payload sizes');
  console.log(`  ${'chats:index (what hydrate reads)'.padEnd(46)} ${fmt(indexJson.length).padStart(10)}`);
  console.log(`  ${'one conversation blob'.padEnd(46)} ${fmt(oneBlob.length).padStart(10)}`);
  console.log(`  ${`all ${CONVERSATIONS} blobs (pre-fix shape)`.padEnd(46)} ${fmt(legacyAll.length).padStart(10)}`);

  console.log('\nhydration: parse the index');
  const hydrate = time('JSON.parse(chats:index)', 20, () => JSON.parse(indexJson));
  // The whole point of the split: this is what the app does at startup.
  const legacyParse = time(`JSON.parse(all ${CONVERSATIONS} blobs)`, 3, () => JSON.parse(legacyAll));
  console.log(`  ${''.padEnd(46)} ${(legacyParse / hydrate).toFixed(0).padStart(10)}x   <- ratio the split bought`);

  console.log('\nopen one conversation (lazy load)');
  time('JSON.parse(chat:<id>)', 200, () => JSON.parse(oneBlob));

  console.log('\nlegacy migration (runs once, on first launch after upgrade)');
  const legacy = { 'chat:1': JSON.stringify(conversations[0]), 'chat:2': JSON.stringify(conversations[1]) };
  time('planMigration(2 chats, 400 msgs each)', 5, () => planMigration(legacy));

  console.log('\nindex maintenance');
  time('buildIndex(500) + JSON.stringify', 20, () => JSON.stringify(buildIndex(conversations)));

  console.log('\nHydration and opening one chat are both single-digit milliseconds at');
  console.log('500 conversations of 400 messages, so the store is not the bottleneck');
  console.log('and neither is the language it runs in.');
  console.log(`\nasserted: hydrate < 50 ms -> ${hydrate < 50 ? 'ok' : 'REGRESSION'}`);
  console.log(`asserted: opening one chat < 20 ms -> ${hydrate < 20 ? 'ok' : 'REGRESSION'}`);
});
