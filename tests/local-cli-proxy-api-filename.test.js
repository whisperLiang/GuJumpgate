const assert = require('node:assert/strict');
const test = require('node:test');

require('../background/local-cli-proxy-api.js');

test('local CLI proxy auth file names include email and password segments', async () => {
  const api = globalThis.MultiPageBackgroundLocalCliProxyApi.createLocalCliProxyApi({
    crypto: globalThis.crypto,
    sessionToJsonConverter: {
      convertSessionJson: (session) => ({
        output: {
          email: session.email,
          plan_type: session.plan_type,
          account_id: session.account_id,
          password: session.password,
        },
        warnings: [],
      }),
    },
  });

  const fileName = await api.buildCredentialFileName({
    email: 'demo.user@example.com',
    plan_type: 'plus',
  }, {
    crypto: globalThis.crypto,
    password: 'P@ss word/2026',
  });

  assert.equal(fileName, 'codex-demo.user@example.com-P@ss-word-2026-plus.json');
});

test('local CLI proxy auth artifacts pass password into filename generation', async () => {
  const api = globalThis.MultiPageBackgroundLocalCliProxyApi.createLocalCliProxyApi({
    crypto: globalThis.crypto,
    sessionToJsonConverter: {
      convertSessionJson: (session) => ({
        output: {
          email: session.email,
          plan_type: session.plan_type,
          account_id: session.account_id,
          password: session.password,
        },
        warnings: [],
      }),
    },
  });

  const artifact = await api.buildAuthJsonArtifact({
    pluginDir: 'C:/tmp/plugin',
    relativeAuthDir: '.cli-proxy-api',
    session: {
      email: 'demo.user@example.com',
      account: { planType: 'plus' },
    },
    accessToken: 'token',
    email: 'demo.user@example.com',
    planType: 'plus',
    password: 'P@ss word/2026',
  });

  assert.equal(artifact.fileName, 'codex-demo.user@example.com-P@ss-word-2026-plus.json');
  assert.equal(artifact.filePath.endsWith('/.cli-proxy-api/codex-demo.user@example.com-P@ss-word-2026-plus.json') || artifact.filePath.endsWith('\\.cli-proxy-api\\codex-demo.user@example.com-P@ss-word-2026-plus.json'), true);
});
