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

test('background flow reuses SMSPool provider activations on demand', async () => {
  const calls = [];
  const helpers = createHelpers({
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(String(url));
      const body = new URLSearchParams(String(options.body || ''));
      calls.push({
        path: parsed.pathname,
        method: options.method || 'GET',
        key: body.get('key'),
        orderid: body.get('orderid'),
      });
      if (parsed.pathname === '/sms/activate') {
        assert.equal(options.method, 'POST');
        assert.equal(body.get('key'), 'pool-key');
        assert.equal(body.get('orderid'), 'pool-1');
        return {
          ok: true,
          text: async () => JSON.stringify({ success: 1 }),
        };
      }
      if (parsed.pathname === '/sms/check') {
        return {
          ok: true,
          text: async () => JSON.stringify({ success: 1 }),
        };
      }
      if (parsed.pathname === '/request/active') {
        return {
          ok: true,
          text: async () => '[]',
        };
      }
      throw new Error(`unexpected SMSPool request: ${parsed.pathname}`);
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
  assert.ok(activation.smsPoolResendPreparedAt > 0);
  assert.deepEqual(calls, [
    { path: '/sms/activate', method: 'POST', key: 'pool-key', orderid: 'pool-1' },
    { path: '/sms/check', method: 'POST', key: 'pool-key', orderid: 'pool-1' },
    { path: '/request/active', method: 'POST', key: 'pool-key', orderid: null },
  ]);
});
