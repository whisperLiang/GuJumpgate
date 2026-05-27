const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smsbower.js');

function createProvider(overrides = {}) {
  return globalThis.PhoneSmsBowerProvider.createProvider({
    fetchImpl: overrides.fetchImpl,
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
  });
}

test('SMSBower activation marks getNumberV2 orders reusable when another SMS is available', async () => {
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('action'), 'getNumberV2');
      return {
        ok: true,
        text: async () => JSON.stringify({
          activationId: 'sb-1',
          phoneNumber: '66812345678',
          activationCost: 0.12,
          countryCode: 52,
          canGetAnotherSms: true,
        }),
      };
    },
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
    smsBowerCountryId: 52,
    smsBowerCountryLabel: 'Thailand',
  });

  assert.equal(activation.provider, 'smsbower');
  assert.equal(activation.activationId, 'sb-1');
  assert.equal(activation.phoneNumber, '66812345678');
  assert.equal(activation.canGetAnotherSms, true);
  assert.equal(activation.maxUses, 3);
});

test('SMSBower activation stays single-use when API says another SMS is unavailable', async () => {
  const provider = createProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => JSON.stringify({
        activationId: 'sb-2',
        phoneNumber: '66887654321',
        canGetAnotherSms: false,
      }),
    }),
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
  });

  assert.equal(activation.canGetAnotherSms, false);
  assert.equal(activation.maxUses, 1);
});

test('SMSBower reuse requests another SMS when previous code is still the current status', async () => {
  const actions = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      actions.push({
        action,
        status: parsed.searchParams.get('status'),
        id: parsed.searchParams.get('id'),
      });
      if (action === 'getStatus') {
        return {
          ok: true,
          text: async () => 'STATUS_OK:123456',
        };
      }
      if (action === 'setStatus') {
        assert.equal(parsed.searchParams.get('status'), '3');
        return {
          ok: true,
          text: async () => 'ACCESS_RETRY_GET',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await provider.reuseActivation({
    smsBowerApiKey: 'demo-key',
  }, {
    activationId: 'sb-3',
    phoneNumber: '66811112222',
    provider: 'smsbower',
    canGetAnotherSms: true,
    maxUses: 3,
  });

  assert.equal(activation.source, 'smsbower-reuse');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((entry) => entry.action), ['getStatus', 'setStatus']);
});

test('SMSBower reuse does not request another SMS when order is already waiting', async () => {
  const actions = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      actions.push(parsed.searchParams.get('action'));
      return {
        ok: true,
        text: async () => 'STATUS_WAIT_RETRY:123456',
      };
    },
  });

  const activation = await provider.reuseActivation({
    smsBowerApiKey: 'demo-key',
  }, {
    activationId: 'sb-4',
    phoneNumber: '66833334444',
    provider: 'smsbower',
    maxUses: 3,
  });

  assert.equal(activation.source, 'smsbower-reuse');
  assert.deepEqual(actions, ['getStatus']);
});
