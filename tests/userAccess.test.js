import assert from 'node:assert/strict';
import test from 'node:test';

import { isSenderAuthorized } from '../src/bot/userAccess.js';

const ownerOnly = { bot: { accessMode: 'owner-only', ownerNumber: '15550000001', allowedNumbers: [] } };
const allowlist = {
  bot: {
    accessMode: 'allowlist',
    ownerNumber: '15550000001',
    allowedNumbers: ['15550000002'],
  },
};

function privateMessage(primary, alternate) {
  return {
    key: {
      remoteJid: primary,
      ...(alternate === undefined ? {} : { remoteJidAlt: alternate }),
    },
  };
}

function groupMessage(primary, alternate, extra = {}) {
  return {
    key: {
      remoteJid: '15550000001@g.us',
      participant: primary,
      ...(alternate === undefined ? {} : { participantAlt: alternate }),
    },
    ...extra,
  };
}

function mappedSocket(mappings = {}) {
  return {
    signalRepository: {
      lidMapping: {
        async getPNForLID(lid) {
          const result = mappings[lid];
          if (result instanceof Error) throw result;
          return result ?? null;
        },
      },
    },
  };
}

test('legacy and explicit everyone policies preserve existing sender behavior', async () => {
  for (const settings of [{ bot: {} }, { bot: { accessMode: 'everyone' } }]) {
    assert.equal(await isSenderAuthorized({
      sock: {},
      message: privateMessage('not-a-user-jid'),
      settings,
    }), true);
  }
});

test('restricted policies allow the owner and allowlisted numbers for private and group messages', async () => {
  const cases = [
    [ownerOnly, privateMessage('15550000001:4@s.whatsapp.net'), true],
    [ownerOnly, privateMessage('15550000002@s.whatsapp.net'), false],
    [allowlist, privateMessage('15550000001@s.whatsapp.net'), true],
    [allowlist, privateMessage('15550000002@s.whatsapp.net'), true],
    [allowlist, privateMessage('15550000003@s.whatsapp.net'), false],
    [allowlist, groupMessage('15550000001:8@s.whatsapp.net'), true],
    [allowlist, groupMessage('15550000002@s.whatsapp.net'), true],
    [allowlist, groupMessage('15550000003@s.whatsapp.net'), false],
  ];

  for (const [settings, message, expected] of cases) {
    assert.equal(await isSenderAuthorized({ sock: {}, message, settings }), expected);
  }
});

test('explicit undefined optional alternate fields match Baileys messages with no alternate identity', async () => {
  const privateIncoming = privateMessage('15550000001@s.whatsapp.net');
  privateIncoming.key.remoteJidAlt = undefined;
  const groupIncoming = groupMessage('15550000001@s.whatsapp.net');
  groupIncoming.key.participantAlt = undefined;

  assert.equal(await isSenderAuthorized({ sock: {}, message: privateIncoming, settings: ownerOnly }), true);
  assert.equal(await isSenderAuthorized({ sock: {}, message: groupIncoming, settings: ownerOnly }), true);
});

test('restricted policies fail closed for missing, unknown, or malformed settings', async () => {
  const incoming = privateMessage('15550000001@s.whatsapp.net');
  const invalid = [
    null,
    {},
    { bot: null },
    { bot: { accessMode: null, ownerNumber: '15550000001' } },
    { bot: { accessMode: 'unexpected', ownerNumber: '15550000001' } },
    { bot: { accessMode: 'owner-only', ownerNumber: '' } },
    { bot: { accessMode: 'owner-only', ownerNumber: '+1 555 000 0001' } },
    { bot: { accessMode: 'allowlist', ownerNumber: '15550000001' } },
    { bot: { accessMode: 'allowlist', ownerNumber: '15550000001', allowedNumbers: ['bad'] } },
  ];

  for (const settings of invalid) {
    assert.equal(await isSenderAuthorized({ sock: {}, message: incoming, settings }), false);
  }

  assert.equal(await isSenderAuthorized({
    sock: {},
    message: incoming,
    settings: { bot: { ...ownerOnly.bot, allowedNumbers: 'ignored in owner-only mode' } },
  }), true);
});

test('group authorization trusts only participant identity metadata', async () => {
  const impostorPayload = {
    pushName: '15550000001',
    participant: '15550000001@s.whatsapp.net',
    message: {
      extendedTextMessage: {
        text: 'from 15550000001',
        contextInfo: {
          participant: '15550000001@s.whatsapp.net',
          mentionedJid: ['15550000001@s.whatsapp.net'],
          quotedMessage: { conversation: '15550000001' },
        },
      },
    },
  };

  assert.equal(await isSenderAuthorized({
    sock: {},
    message: groupMessage('15550000003@s.whatsapp.net', undefined, impostorPayload),
    settings: ownerOnly,
  }), false);
  assert.equal(await isSenderAuthorized({
    sock: {},
    message: groupMessage(undefined, undefined, impostorPayload),
    settings: ownerOnly,
  }), false);
});

test('trusted alternate PN authorizes a LID on first sight while known mappings must agree', async () => {
  const firstSight = groupMessage('70000000001:2@lid', '15550000001:8@s.whatsapp.net');
  assert.equal(await isSenderAuthorized({ sock: mappedSocket(), message: firstSight, settings: ownerOnly }), true);
  assert.equal(await isSenderAuthorized({
    sock: {},
    message: privateMessage('15550000001@s.whatsapp.net', '70000000001@lid'),
    settings: ownerOnly,
  }), true);
  assert.equal(await isSenderAuthorized({
    sock: mappedSocket({ '70000000001@lid': '15550000001@s.whatsapp.net' }),
    message: firstSight,
    settings: ownerOnly,
  }), true);
  assert.equal(await isSenderAuthorized({
    sock: mappedSocket({ '70000000001@lid': '15550000009@s.whatsapp.net' }),
    message: firstSight,
    settings: ownerOnly,
  }), false);
});

test('LID-only authors require a valid mapped PN and lookup failures fail closed', async () => {
  const incoming = privateMessage('70000000001@lid');
  const cases = [
    [mappedSocket({ '70000000001@lid': '15550000001:3@s.whatsapp.net' }), true],
    [mappedSocket({ '70000000001@lid': '15550000003@s.whatsapp.net' }), false],
    [mappedSocket({ '70000000001@lid': 'invalid' }), false],
    [mappedSocket({ '70000000001@lid': new Error('lookup failed') }), false],
    [{}, false],
  ];

  for (const [sock, expected] of cases) {
    assert.equal(await isSenderAuthorized({ sock, message: incoming, settings: ownerOnly }), expected);
  }
});

test('sender identity conflicts and malformed alternates fail closed', async () => {
  const cases = [
    privateMessage('15550000001@s.whatsapp.net', '15550000003@s.whatsapp.net'),
    privateMessage('15550000001@s.whatsapp.net', 'not-a-jid'),
    privateMessage('15550000001@s.whatsapp.net', '15550000001@g.us'),
    groupMessage('15550000001@s.whatsapp.net', '15550000003@hosted'),
  ];

  for (const message of cases) {
    assert.equal(await isSenderAuthorized({ sock: {}, message, settings: ownerOnly }), false);
  }
});

test('a never-settling LID lookup is bounded by the requested deadline', async () => {
  const started = Date.now();
  const sock = mappedSocket();
  sock.signalRepository.lidMapping.getPNForLID = async () => new Promise(() => {});

  assert.equal(await isSenderAuthorized({
    sock,
    message: privateMessage('70000000001@lid'),
    settings: ownerOnly,
    timeoutMs: 15,
  }), false);
  assert.ok(Date.now() - started < 250);
});
