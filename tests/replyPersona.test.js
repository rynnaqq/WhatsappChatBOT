import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STICKER_IDS,
  buildReplySystemPrompt,
  isStickerRequest,
  parseReply,
  stickerFallback,
  stickerAllowed,
} from '../src/services/replyPersona.js';

test('MCQ, study and direct option lists do not add automatic reaction stickers', () => {
  const settings = { bot: { personaStyle: 'feminine', stickerReplies: 'contextual' } };
  for (const text of [
    'Hi, MCQ: 2 + 2? A. 3 B. 4',
    'Hi, help me study fractions.',
    'Hai, bantu aku belajar pecahan ya.',
    'Hi! 1. 2 + 2?\nA) 3\nB) 4',
    'Hi! 1. 2 + 2?\na.3\nb.4',
  ]) {
    assert.equal(stickerAllowed(settings, { text }), false, text);
    assert.equal(buildReplySystemPrompt(settings, { text }).includes('[[sticker:'), false, text);
  }
  assert.equal(stickerAllowed(settings, { text: 'Hi, send me a sticker after this MCQ please.' }), true);
  assert.equal(stickerAllowed(settings, { text: 'Hai, apa kabar?' }), true);
});

test('parseReply removes one allowed trailing control line from visible text', () => {
  assert.deepEqual(parseReply('Hai! 😊\n[[sticker:hello]]'), { text: 'Hai! 😊', stickerId: 'hello' });
  assert.deepEqual(parseReply('[[sticker:cheer]]'), { text: '', stickerId: 'cheer' });
  assert.equal(Object.isFrozen(STICKER_IDS), true);
});

test('parseReply accepts broader reaction moods while removing their controls from visible text', () => {
  assert.deepEqual(parseReply('Aku pikirin dulu ya 🤔\n[[sticker:thinking]]'), {
    text: 'Aku pikirin dulu ya 🤔',
    stickerId: 'thinking',
  });
  assert.deepEqual(parseReply('Yay, berhasil! 🎉\n[[sticker:celebrate]]'), {
    text: 'Yay, berhasil! 🎉',
    stickerId: 'celebrate',
  });
});

test('stickerFallback distinguishes a supported expanded mood from unsafe property names', () => {
  assert.notEqual(stickerFallback('thinking'), stickerFallback('__unknown__'));
  assert.equal(stickerFallback('toString'), stickerFallback('__unknown__'));
});

test('parseReply removes unknown trailing sticker controls without allowing a sticker', () => {
  assert.deepEqual(parseReply('Jawaban aman.\n[[sticker:../../private]]'), { text: 'Jawaban aman.', stickerId: null });
  assert.deepEqual(parseReply('Jawaban aman.\n[[sticker:party]]'), { text: 'Jawaban aman.', stickerId: null });
});

test('parseReply never leaks extra trailing control lines when a model emits more than one', () => {
  assert.deepEqual(
    parseReply('Reaksi aman.\n[[sticker:party]]\n[[sticker:happy]]'),
    { text: 'Reaksi aman.', stickerId: 'happy' },
  );
});

test('parseReply removes a trailing block of controls even when blank lines separate them', () => {
  assert.deepEqual(
    parseReply('Hai!\n[[sticker:hello]]\n\n[[sticker:happy]]'),
    { text: 'Hai!', stickerId: 'happy' },
  );
});

test('parseReply removes malformed standalone control suffixes without treating them as stickers', () => {
  assert.deepEqual(parseReply('Jawaban aman.\n[[sticker:happy]'), { text: 'Jawaban aman.', stickerId: null });
  assert.deepEqual(parseReply('Jawaban aman.\n[[sticker: ../private ]]'), { text: 'Jawaban aman.', stickerId: null });
});

test('parseReply preserves marker examples in prose and fenced code', () => {
  assert.deepEqual(parseReply('Tulis `[[sticker:happy]]` sebagai contoh.'), {
    text: 'Tulis `[[sticker:happy]]` sebagai contoh.',
    stickerId: null,
  });
  const fenced = '```text\n[[sticker:happy]]\n```';
  assert.deepEqual(parseReply(fenced), { text: fenced, stickerId: null });
  const unfinishedFence = '```text\ncontoh\n[[sticker:happy]]';
  assert.deepEqual(parseReply(unfinishedFence), { text: unfinishedFence, stickerId: null });
});

test('parseReply preserves indented Markdown code literals containing a control example', () => {
  const spaced = 'Literal example:\n\n    [[sticker:happy]]';
  assert.deepEqual(parseReply(spaced), { text: spaced, stickerId: null });
  const tabbed = 'Literal example:\n\t[[sticker:happy]]';
  assert.deepEqual(parseReply(tabbed), { text: tabbed, stickerId: null });
  const markerOnly = '    [[sticker:happy]]';
  assert.deepEqual(parseReply(markerOnly), { text: markerOnly, stickerId: null });
});

test('parseReply keeps a trailing marker inside an unfinished four-backtick fence with an inner triple fence', () => {
  const nestedFence = '````markdown\n```text\nexample\n[[sticker:happy]]';
  assert.deepEqual(parseReply(nestedFence), { text: nestedFence, stickerId: null });

  const languageTaggedLineIsNotACloser = '```markdown\n````text\n[[sticker:happy]]';
  assert.deepEqual(parseReply(languageTaggedLineIsNotACloser), {
    text: languageTaggedLineIsNotACloser,
    stickerId: null,
  });
});

test('isStickerRequest accepts direct Indonesian and English requests but rejects discussion about stickers', () => {
  for (const text of ['Kirim stiker lucu dong', 'minta sticker lucu', 'reply pakai stiker', 'Send me a cute sticker please']) {
    assert.equal(isStickerRequest(text), true, text);
  }
  for (const text of ['apa itu stiker?', 'format sticker WhatsApp', 'jangan kirim stiker', 'I am designing a sticker pack']) {
    assert.equal(isStickerRequest(text), false, text);
  }
});

test('isStickerRequest rejects technical how-to questions while preserving direct polite requests', () => {
  for (const text of [
    'What API should I call to send a sticker?',
    'Jelaskan cara kirim stiker WhatsApp lewat kode.',
    'How to send a sticker?',
    'Explain how to send a sticker.',
    'Bagaimana kirim stiker?',
    'Can you explain how to send a sticker please?',
  ]) {
    assert.equal(isStickerRequest(text), false, text);
  }
  for (const text of [
    'Can you send me a sticker?',
    'Can you send a sticker please?',
    'Bisa tolong kirim stiker lucu untukku?',
  ]) {
    assert.equal(isStickerRequest(text), true, text);
  }
});

test('an informational sticker question with a greeting cannot enable contextual media', () => {
  for (const text of ['Hi, how to send a sticker?', 'Halo, bagaimana kirim stiker?', 'Hi, explain how to send a sticker.']) {
    assert.equal(stickerAllowed({ bot: { stickerReplies: 'contextual' } }, { text }), false, text);
  }
});

test('stickerAllowed applies off, explicit-request, attachment, and casual-context rules', () => {
  const allowed = (stickerReplies, text, attachment = null) => stickerAllowed(
    { bot: { stickerReplies } },
    { text, attachment },
  );
  assert.equal(allowed('off', 'kirim stiker dong'), false);
  assert.equal(allowed('on-request', 'hai, apa kabar?'), false);
  assert.equal(allowed('on-request', 'kirim stiker dong'), true);
  assert.equal(allowed('contextual', 'Hai, aku senang banget hari ini!'), true);
  assert.equal(allowed('contextual', 'Jelaskan error API pada kode ini.'), false);
  assert.equal(allowed('contextual', 'Hai!', { kind: 'document' }), false);
  assert.equal(allowed('contextual', 'Kirim stiker dong', { kind: 'document' }), true);
});

test('explicit sticker refusals override casual contextual signals', () => {
  for (const text of [
    'Hai, jangan kirim stiker ya',
    'Hello, do not send stickers please',
    'Hi, no sticker please',
  ]) {
    assert.equal(isStickerRequest(text), false, text);
    assert.equal(stickerAllowed({ bot: { stickerReplies: 'contextual' } }, { text }), false, text);
  }
});

test('contextual stickers stay disabled for serious greetings unless the user explicitly requests one', () => {
  const settings = { bot: { stickerReplies: 'contextual' } };
  for (const text of [
    'Hai, ayahku baru meninggal.',
    'Hi, I am considering suicide.',
    'Hi, I get a JavaScript exception.',
    'Halo, dokter memberi diagnosis penyakit serius.',
    'Hi, I need legal advice about debt.',
  ]) {
    assert.equal(stickerAllowed(settings, { text }), false, text);
  }
  assert.equal(stickerAllowed(settings, { text: 'Aku sedih hari ini.' }), true);
  assert.equal(stickerAllowed(settings, { text: 'Hi, I am grieving; please send me a sticker.' }), true);
});

test('contextual stickers stay disabled for academic work while explicit requests still win', () => {
  const settings = { bot: { stickerReplies: 'contextual' } };
  for (const text of [
    'Hai, bantu jawab soal pilihan ganda ini ya.',
    'Hello, can you help with my homework? Thanks!',
    'Aku senang, besok ada kuis matematika dan perlu belajar.',
    'Hi, review these multiple-choice answers for my exam.',
  ]) {
    assert.equal(stickerAllowed(settings, { text }), false, text);
  }
  assert.equal(stickerAllowed(settings, { text: 'Bantu soal ini dan kirim stiker semangat dong.' }), true);
});

test('buildReplySystemPrompt preserves explicit custom-off mode and enables protocol only when allowed', () => {
  const customOff = { bot: { systemPrompt: 'My exact prompt.', personaStyle: 'custom', stickerReplies: 'off' } };
  assert.equal(buildReplySystemPrompt(customOff, { text: 'Hello' }), 'My exact prompt.');

  const legacy = { bot: { systemPrompt: 'Answer carefully.' } };
  const casual = buildReplySystemPrompt(legacy, { text: 'Hai, apa kabar?' });
  assert.match(casual, /Answer carefully\./);
  assert.match(casual, />\.</);
  assert.match(casual, /\[\[sticker:happy\]\]/);

  const documentPrompt = buildReplySystemPrompt(legacy, { text: 'Read this.', attachment: { kind: 'document' } });
  assert.match(documentPrompt, />\.</);
  assert.equal(documentPrompt.includes('[[sticker:'), false);
});

test('feminine casual prompt offers varied expressions and the expanded sticker moods', () => {
  const prompt = buildReplySystemPrompt({
    bot: {
      systemPrompt: 'Answer naturally.',
      personaStyle: 'feminine',
      stickerReplies: 'contextual',
    },
  }, { text: 'Hai, aku berhasil menyelesaikannya!' });

  assert.match(prompt, /\[\[sticker:thinking\]\]/);
  assert.match(prompt, /\[\[sticker:celebrate\]\]/);
  assert.match(prompt, /emoji/iu);
  assert.match(prompt, /kaomoji/iu);
});

for (const personaStyle of ['feminine', 'renako']) {
test(`${personaStyle} prompt gives WhatsApp-native multiple-choice answer presentation rules`, () => {
  const prompt = buildReplySystemPrompt({
    bot: {
      systemPrompt: 'Solve accurately.',
      personaStyle,
      stickerReplies: 'contextual',
    },
  }, { text: 'Tolong jawab soal pilihan ganda ini:\n1. Ibu kota Indonesia adalah ...\nA. Bangkok\nB. Jakarta' });

  assert.match(prompt, /Solve accurately\./);
  assert.match(prompt, /\*Jawaban: B\. \.\.\.\*.*\*Penjelasan:\* \.\.\./su);
  assert.match(prompt, /single asterisks/iu);
  assert.match(prompt, /blank line/iu);
  assert.match(prompt, /original numbering and order/iu);
  assert.match(prompt, /compact answer key/iu);
  assert.match(prompt, /answer-only|answer only/iu);
  assert.match(prompt, /formulas, code, and quotations/iu);
  assert.match(prompt, /missing or unreadable/iu);
  assert.match(prompt, /Markdown tables/iu);
  assert.match(prompt, /greetings, emoji, kaomoji/iu);
  assert.doesNotMatch(prompt, /Haii, aku di sini/iu);
  assert.equal(prompt.includes('[[sticker:'), false);
});
}

test('academic presentation guidance never changes a custom persona base prompt', () => {
  const custom = {
    bot: {
      systemPrompt: 'Return only the option letter.',
      personaStyle: 'custom',
      stickerReplies: 'contextual',
    },
  };
  assert.equal(
    buildReplySystemPrompt(custom, { text: 'Hai, jawab soal pilihan ganda ini.' }),
    'Return only the option letter.',
  );
});
