const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smsbower.js');
require('../phone-sms/providers/grizzlysms.js');
require('../phone-sms/providers/sms-verification-number.js');
require('../phone-sms/providers/smspool.js');

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

test('SMSBower low price priority orders countries by fetched price', async () => {
  const calls = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      const country = parsed.searchParams.get('country');
      calls.push({
        action,
        country,
        minPrice: parsed.searchParams.get('minPrice'),
        maxPrice: parsed.searchParams.get('maxPrice'),
      });
      if (action === 'getPricesV3') {
        const price = country === '1' ? 0.12 : 0.05;
        return {
          ok: true,
          text: async () => JSON.stringify({
            [country]: {
              dr: {
                1001: {
                  count: 2,
                  price,
                  provider_id: 1001,
                },
              },
            },
          }),
        };
      }
      if (action === 'getNumberV2') {
        assert.equal(country, '52');
        assert.equal(parsed.searchParams.get('minPrice'), '0.05');
        assert.equal(parsed.searchParams.get('maxPrice'), '0.05');
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'sb-low',
            phoneNumber: '66812345678',
            activationCost: 0.05,
            canGetAnotherSms: true,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
    smsBowerCountryId: 1,
    smsBowerCountryLabel: 'USA',
    smsBowerCountryFallback: [{ id: 52, label: 'Thailand' }],
    heroSmsAcquirePriority: 'price',
  });

  assert.equal(activation.countryId, 52);
  assert.equal(activation.price, 0.05);
  assert.deepEqual(
    calls.filter((entry) => entry.action === 'getPricesV3').map((entry) => entry.country),
    ['1', '52']
  );
  assert.equal(calls.find((entry) => entry.action === 'getNumberV2')?.country, '52');
});

test('SMSBower max price filters price tiers even when country priority is selected', async () => {
  const calls = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      const country = parsed.searchParams.get('country');
      calls.push({
        action,
        country,
        minPrice: parsed.searchParams.get('minPrice'),
        maxPrice: parsed.searchParams.get('maxPrice'),
      });
      if (action === 'getPricesV3') {
        const price = country === '1' ? 0.12 : 0.07;
        return {
          ok: true,
          text: async () => JSON.stringify({
            [country]: {
              dr: {
                1001: {
                  count: 2,
                  price,
                  provider_id: 1001,
                },
              },
            },
          }),
        };
      }
      if (action === 'getNumberV2') {
        assert.equal(country, '52');
        assert.equal(parsed.searchParams.get('minPrice'), '0.07');
        assert.equal(parsed.searchParams.get('maxPrice'), '0.07');
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'sb-cap',
            phoneNumber: '66812345679',
            activationCost: 0.07,
            canGetAnotherSms: true,
          }),
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
    smsBowerCountryId: 1,
    smsBowerCountryLabel: 'USA',
    smsBowerCountryFallback: [{ id: 52, label: 'Thailand' }],
    heroSmsAcquirePriority: 'country',
    smsBowerMaxPrice: '0.08',
  });

  assert.equal(activation.countryId, 52);
  assert.equal(activation.price, 0.07);
  assert.deepEqual(
    calls.filter((entry) => entry.action === 'getNumberV2').map((entry) => entry.country),
    ['52']
  );
});

test('SMSBower cancels an activation when returned cost is above max price', async () => {
  const calls = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      calls.push({
        action,
        status: parsed.searchParams.get('status'),
        minPrice: parsed.searchParams.get('minPrice'),
        maxPrice: parsed.searchParams.get('maxPrice'),
      });
      if (action === 'getPricesV3') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            52: {
              dr: {
                1001: {
                  count: 1,
                  price: 0.07,
                  provider_id: 1001,
                },
              },
            },
          }),
        };
      }
      if (action === 'getNumberV2') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'sb-over-cap',
            phoneNumber: '66812345670',
            activationCost: 0.12,
            canGetAnotherSms: true,
          }),
        };
      }
      if (action === 'setStatus') {
        assert.equal(parsed.searchParams.get('status'), '8');
        return {
          ok: true,
          text: async () => 'ACCESS_CANCEL',
        };
      }
      throw new Error(`unexpected action: ${action}`);
    },
  });

  await assert.rejects(
    () => provider.requestActivation({
      smsBowerApiKey: 'demo-key',
      smsBowerCountryId: 52,
      smsBowerCountryLabel: 'Thailand',
      smsBowerMaxPrice: '0.08',
    }),
    /outside configured range/
  );

  assert.deepEqual(
    calls.map((entry) => entry.action),
    ['getPricesV3', 'getNumberV2', 'setStatus']
  );
  assert.equal(calls.find((entry) => entry.action === 'getNumberV2')?.maxPrice, '0.07');
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

test('SMSBower reuse tries another SMS even when getNumberV2 reported unavailable', async () => {
  const actions = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      actions.push(action);
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
    activationId: 'sb-3b',
    phoneNumber: '66855556666',
    provider: 'smsbower',
    canGetAnotherSms: false,
    maxUses: 1,
  });

  assert.equal(activation.source, 'smsbower-reuse');
  assert.equal(activation.canGetAnotherSms, true);
  assert.equal(activation.maxUses, 3);
  assert.deepEqual(actions, ['getStatus', 'setStatus']);
});

test('SMSBower reuse requests another SMS when retry status still includes previous code', async () => {
  const actions = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      actions.push(action);
      if (action === 'getStatus') {
        return {
          ok: true,
          text: async () => 'STATUS_WAIT_RETRY:123456',
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
    activationId: 'sb-4',
    phoneNumber: '66833334444',
    provider: 'smsbower',
    maxUses: 3,
  });

  assert.equal(activation.source, 'smsbower-reuse');
  assert.deepEqual(actions, ['getStatus', 'setStatus']);
});

test('SMSBower reuse does not request another SMS when order is already waiting without old code', async () => {
  const actions = [];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      actions.push(parsed.searchParams.get('action'));
      return {
        ok: true,
        text: async () => 'STATUS_WAIT_CODE',
      };
    },
  });

  const activation = await provider.reuseActivation({
    smsBowerApiKey: 'demo-key',
  }, {
    activationId: 'sb-5',
    phoneNumber: '66877778888',
    provider: 'smsbower',
    maxUses: 3,
  });

  assert.equal(activation.source, 'smsbower-reuse');
  assert.deepEqual(actions, ['getStatus']);
});

test('SMSBower poll returns a new retry code during reused activation', async () => {
  const statuses = ['STATUS_WAIT_RETRY:111111', 'STATUS_WAIT_RETRY:222222'];
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get('action'), 'getStatus');
      return {
        ok: true,
        text: async () => statuses.shift() || 'STATUS_WAIT_RETRY:222222',
      };
    },
  });

  const code = await provider.pollActivationCode({
    smsBowerApiKey: 'demo-key',
  }, {
    activationId: 'sb-6',
    phoneNumber: '66877779999',
    provider: 'smsbower',
    source: 'smsbower-reuse',
    lastPhoneCode: '111111',
  }, {
    timeoutMs: 5000,
    intervalMs: 1,
  });

  assert.equal(code, '222222');
});

test('SMSBower poll does not return retry code when previous code is unknown', async () => {
  const provider = createProvider({
    fetchImpl: async () => ({
      ok: true,
      text: async () => 'STATUS_WAIT_RETRY:111111',
    }),
  });

  await assert.rejects(
    () => provider.pollActivationCode({
      smsBowerApiKey: 'demo-key',
    }, {
      activationId: 'sb-7',
      phoneNumber: '66877770000',
      provider: 'smsbower',
      source: 'smsbower-reuse',
    }, {
      timeoutMs: 1,
      intervalMs: 1,
      maxRounds: 1,
    }),
    /PHONE_CODE_TIMEOUT/
  );
});

test('SMSBower full reuse cycle keeps the same activation and returns the second code', async () => {
  const actions = [];
  let phase = 'request';
  const provider = createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      actions.push({
        action,
        status: parsed.searchParams.get('status'),
        phase,
      });

      if (action === 'getPricesV3') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            6: {
              dr: {
                3237: {
                  count: 1,
                  price: 0.008,
                  provider_id: 3237,
                },
              },
            },
          }),
        };
      }
      if (action === 'getNumberV2') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'sb-full-cycle',
            phoneNumber: '6281234567890',
            activationCost: 0.008,
            countryCode: 6,
            canGetAnotherSms: true,
          }),
        };
      }
      if (action === 'getStatus' && phase === 'first-code') {
        return {
          ok: true,
          text: async () => 'STATUS_OK:111111',
        };
      }
      if (action === 'getStatus' && phase === 'reuse') {
        return {
          ok: true,
          text: async () => 'STATUS_WAIT_RETRY:111111',
        };
      }
      if (action === 'setStatus' && phase === 'reuse') {
        assert.equal(parsed.searchParams.get('status'), '3');
        phase = 'second-code-old';
        return {
          ok: true,
          text: async () => 'ACCESS_RETRY_GET',
        };
      }
      if (action === 'getStatus' && phase === 'second-code-old') {
        phase = 'second-code-new';
        return {
          ok: true,
          text: async () => 'STATUS_WAIT_RETRY:111111',
        };
      }
      if (action === 'getStatus' && phase === 'second-code-new') {
        return {
          ok: true,
          text: async () => 'STATUS_WAIT_RETRY:222222',
        };
      }
      throw new Error(`unexpected action ${action} in ${phase}`);
    },
  });

  const activation = await provider.requestActivation({
    smsBowerApiKey: 'demo-key',
    smsBowerCountryId: 6,
    smsBowerCountryLabel: 'Indonesia',
    smsBowerMinPrice: '0.008',
    smsBowerMaxPrice: '0.008',
  });
  phase = 'first-code';
  const firstCode = await provider.pollActivationCode({ smsBowerApiKey: 'demo-key' }, activation, {
    timeoutMs: 5000,
    intervalMs: 1,
  });
  assert.equal(firstCode, '111111');

  phase = 'reuse';
  const reusableActivation = await provider.reuseActivation({ smsBowerApiKey: 'demo-key' }, {
    ...activation,
    successfulUses: 1,
    lastPhoneCode: firstCode,
  });
  const secondCode = await provider.pollActivationCode({ smsBowerApiKey: 'demo-key' }, reusableActivation, {
    timeoutMs: 5000,
    intervalMs: 1,
  });

  assert.equal(reusableActivation.activationId, activation.activationId);
  assert.equal(reusableActivation.phoneNumber, activation.phoneNumber);
  assert.equal(secondCode, '222222');
  assert.deepEqual(
    actions.map((entry) => `${entry.action}:${entry.status || ''}`),
    [
      'getPricesV3:',
      'getNumberV2:',
      'getStatus:',
      'getStatus:',
      'setStatus:3',
      'getStatus:',
      'getStatus:',
    ]
  );
});

test('SMSBower-compatible wrappers request another SMS only when reused', async () => {
  const actions = [];
  const provider = globalThis.PhoneSmsGrizzlySmsProvider.createProvider({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      actions.push({
        action,
        apiKey: parsed.searchParams.get('api_key'),
        status: parsed.searchParams.get('status'),
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
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const activation = await provider.reuseActivation({
    grizzlySmsApiKey: 'grizzly-key',
  }, {
    activationId: 'grizzly-1',
    phoneNumber: '66899990000',
    provider: 'grizzlysms',
    maxUses: 3,
    successfulUses: 1,
  });

  assert.equal(activation.provider, 'grizzlysms');
  assert.equal(activation.source, 'smsbower-reuse');
  assert.deepEqual(actions.map((entry) => entry.action), ['getStatus', 'setStatus']);
  assert.deepEqual(actions.map((entry) => entry.apiKey), ['grizzly-key', 'grizzly-key']);
});
