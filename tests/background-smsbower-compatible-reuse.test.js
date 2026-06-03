const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/smsbower.js');
require('../phone-sms/providers/smspool.js');
require('../background/phone-verification-flow.js');

function createHelpers(overrides = {}) {
  return globalThis.MultiPageBackgroundPhoneVerification.createPhoneVerificationHelpers({
    addLog: overrides.addLog || (async () => {}),
    fetchImpl: overrides.fetchImpl,
    getState: overrides.getState || (async () => ({})),
    setState: overrides.setState || (async () => {}),
    sleepWithStop: overrides.sleepWithStop || (async () => {}),
    throwIfStopped: overrides.throwIfStopped || (() => {}),
  });
}

test('background flow reuses SMSBower-compatible providers on demand', async () => {
  const calls = [];
  const helpers = createHelpers({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      calls.push({
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
  });

  const activation = await helpers.requestPhoneActivation({
    phoneSmsProvider: 'smspool',
    phoneSmsReuseEnabled: true,
    smsPoolApiKey: 'pool-key',
    smsPoolCountryId: 1,
    smsPoolCountryLabel: 'United States',
    reusablePhoneActivation: {
      activationId: 'pool-1',
      phoneNumber: '15551234567',
      provider: 'smspool',
      countryId: 1,
      countryLabel: 'United States',
      successfulUses: 1,
      maxUses: 3,
    },
  });

  assert.equal(activation.provider, 'smspool');
  assert.equal(activation.phoneNumber, '15551234567');
  assert.deepEqual(calls, [
    { action: 'getStatus', apiKey: 'pool-key', status: null },
    { action: 'setStatus', apiKey: 'pool-key', status: '3' },
  ]);
});
