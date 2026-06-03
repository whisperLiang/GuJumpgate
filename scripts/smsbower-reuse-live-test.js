#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

require('../phone-sms/providers/smsbower.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = path.join(ROOT, 'multipage-settings-20260527-143253.json');
const DEFAULT_STATE_FILE = path.join(ROOT, 'data', 'smsbower-reuse-live-test.json');

function getArg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function mask(value, left = 5, right = 3) {
  const text = String(value || '');
  return text.length > left + right ? `${text.slice(0, left)}****${text.slice(-right)}` : text;
}

function extractCode(text) {
  const match = String(text || '').match(/\b(\d{4,8})\b/);
  return match ? match[1] : '';
}

function loadSettings(configPath) {
  let target = configPath;
  if (!fs.existsSync(target)) {
    const latest = fs.readdirSync(ROOT)
      .filter((name) => /^multipage-settings-.*\.json$/i.test(name))
      .map((name) => path.join(ROOT, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    if (latest) target = latest;
  }
  const raw = readJson(target);
  return raw.settings || raw.state || raw;
}

async function rawApi(state, action, extra = {}) {
  const url = new URL(state.smsBowerBaseUrl || 'https://smsbower.page/stubs/handler_api.php');
  url.searchParams.set('api_key', state.smsBowerApiKey);
  url.searchParams.set('action', action);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url);
  return {
    ok: response.ok,
    text: (await response.text()).trim(),
  };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createProvider() {
  return globalThis.PhoneSmsBowerProvider.createProvider({
    fetchImpl: fetch,
    sleepWithStop: sleep,
    throwIfStopped: () => {},
    requestTimeoutMs: 20000,
  });
}

async function pollStatus(state, activationId, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
  const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
  const lastCode = String(options.lastCode || '').trim();
  const startedAt = Date.now();
  let pollCount = 0;
  let lastStatus = '';

  while (Date.now() - startedAt < timeoutMs) {
    pollCount += 1;
    let status;
    try {
      status = await rawApi(state, 'getStatus', { id: activationId });
    } catch (error) {
      console.log(`[poll ${pollCount}] NETWORK_ERROR: ${error?.message || error}`);
      await sleep(intervalMs);
      continue;
    }
    lastStatus = status.text;
    console.log(`[poll ${pollCount}] ${lastStatus}`);

    const okCode = String(lastStatus).match(/^STATUS_OK:(.+)$/i);
    const retryCode = String(lastStatus).match(/^STATUS_(?:WAIT_RETRY|WAIT_RESEND):(.+)$/i);
    const code = extractCode(okCode?.[1] || retryCode?.[1] || '');
    if (code && (!lastCode || code !== lastCode)) {
      return { code, status: lastStatus, pollCount };
    }

    if (/^STATUS_CANCEL$/i.test(lastStatus)) {
      throw new Error('Activation was canceled.');
    }
    if (!/^STATUS_(WAIT_CODE|WAIT_RETRY|WAIT_RESEND)(?::.+)?$/i.test(lastStatus)) {
      throw new Error(`Unexpected status: ${lastStatus}`);
    }
    await sleep(intervalMs);
  }

  const error = new Error(`Timed out waiting for SMS. Last status: ${lastStatus || 'empty'}`);
  error.lastStatus = lastStatus;
  throw error;
}

async function acquire(configPath, stateFile) {
  const settings = loadSettings(configPath);
  const provider = createProvider();
  const activation = await provider.requestActivation(settings, {});
  const record = {
    phase: 'waiting_first_code',
    createdAt: Date.now(),
    configPath,
    activation,
  };
  writeJson(stateFile, record);

  console.log(JSON.stringify({
    event: 'activation_acquired',
    stateFile,
    activation: {
      id: activation.activationId,
      phoneNumber: activation.phoneNumber,
      maskedPhone: mask(activation.phoneNumber),
      countryId: activation.countryId,
      countryLabel: activation.countryLabel,
      price: activation.price,
      selectedPrice: activation.selectedPrice,
      canGetAnotherSms: activation.canGetAnotherSms,
      maxUses: activation.maxUses,
    },
  }, null, 2));

  if (hasFlag('wait-first')) {
    const codeResult = await pollStatus(settings, activation.activationId, {
      timeoutMs: Number(getArg('timeout-ms', 300000)),
      intervalMs: Number(getArg('interval-ms', 5000)),
    });
    record.phase = 'first_code_received';
    record.firstCode = codeResult.code;
    record.firstCodeStatus = codeResult.status;
    record.firstCodeReceivedAt = Date.now();
    record.activation = {
      ...activation,
      lastPhoneCode: codeResult.code,
      phoneCodeReceived: true,
      phoneCodeReceivedAt: Date.now(),
      successfulUses: Math.max(1, Number(activation.successfulUses || 0) + 1),
    };
    writeJson(stateFile, record);
    console.log(JSON.stringify({
      event: 'first_code_received',
      stateFile,
      code: codeResult.code,
      status: codeResult.status,
      note: 'Order was intentionally kept open for reuse. It was not canceled or finished.',
    }, null, 2));
  }
}

async function reuse(configPath, stateFile) {
  const settings = loadSettings(configPath);
  const provider = createProvider();
  const record = readJson(stateFile);
  const activation = record.activation;
  if (!activation?.activationId || !activation?.phoneNumber) {
    throw new Error(`State file has no activation: ${stateFile}`);
  }
  const lastPhoneCode = String(record.firstCode || activation.lastPhoneCode || '').trim();
  if (!lastPhoneCode) {
    throw new Error('The activation has no first code recorded. Run acquire with --wait-first after a real SMS is sent first.');
  }

  const prepared = await provider.reuseActivation(settings, {
    ...activation,
    lastPhoneCode,
    successfulUses: Math.max(1, Number(activation.successfulUses || 1)),
  });
  record.phase = 'waiting_second_code';
  record.reusePreparedAt = Date.now();
  record.activation = {
    ...prepared,
    lastPhoneCode,
  };
  writeJson(stateFile, record);
  console.log(JSON.stringify({
    event: 'reuse_prepared',
    stateFile,
    activationId: prepared.activationId,
    phoneNumber: prepared.phoneNumber,
    maskedPhone: mask(prepared.phoneNumber),
    samePhone: prepared.phoneNumber === activation.phoneNumber,
    sameActivationId: prepared.activationId === activation.activationId,
    note: 'Submit this same phone number to the target service now so it sends the second SMS.',
  }, null, 2));

  if (hasFlag('wait-second')) {
    const codeResult = await pollStatus(settings, prepared.activationId, {
      timeoutMs: Number(getArg('timeout-ms', 300000)),
      intervalMs: Number(getArg('interval-ms', 5000)),
      lastCode: lastPhoneCode,
    });
    record.phase = 'second_code_received';
    record.secondCode = codeResult.code;
    record.secondCodeStatus = codeResult.status;
    record.secondCodeReceivedAt = Date.now();
    writeJson(stateFile, record);
    console.log(JSON.stringify({
      event: 'second_code_received',
      stateFile,
      code: codeResult.code,
      status: codeResult.status,
      success: codeResult.code !== lastPhoneCode,
    }, null, 2));
  }
}

async function waitFirst(configPath, stateFile) {
  const settings = loadSettings(configPath);
  const record = readJson(stateFile);
  const activation = record.activation;
  if (!activation?.activationId || !activation?.phoneNumber) {
    throw new Error(`State file has no activation: ${stateFile}`);
  }
  const codeResult = await pollStatus(settings, activation.activationId, {
    timeoutMs: Number(getArg('timeout-ms', 300000)),
    intervalMs: Number(getArg('interval-ms', 5000)),
  });
  record.phase = 'first_code_received';
  record.firstCode = codeResult.code;
  record.firstCodeStatus = codeResult.status;
  record.firstCodeReceivedAt = Date.now();
  record.activation = {
    ...activation,
    lastPhoneCode: codeResult.code,
    phoneCodeReceived: true,
    phoneCodeReceivedAt: Date.now(),
    successfulUses: Math.max(1, Number(activation.successfulUses || 0) + 1),
  };
  writeJson(stateFile, record);
  console.log(JSON.stringify({
    event: 'first_code_received',
    stateFile,
    code: codeResult.code,
    status: codeResult.status,
    note: 'Order was intentionally kept open for reuse. It was not canceled or finished.',
  }, null, 2));
}

async function status(configPath, stateFile) {
  const settings = loadSettings(configPath);
  const record = readJson(stateFile);
  const activationId = record.activation?.activationId;
  if (!activationId) throw new Error(`State file has no activation: ${stateFile}`);
  const result = await rawApi(settings, 'getStatus', { id: activationId });
  console.log(JSON.stringify({
    event: 'status',
    stateFile,
    phase: record.phase,
    activationId,
    phoneNumber: record.activation?.phoneNumber,
    maskedPhone: mask(record.activation?.phoneNumber),
    status: result.text,
  }, null, 2));
}

async function main() {
  const command = process.argv[2] || 'help';
  const configPath = path.resolve(getArg('config', DEFAULT_CONFIG));
  const stateFile = path.resolve(getArg('state', DEFAULT_STATE_FILE));
  if (command === 'acquire') return acquire(configPath, stateFile);
  if (command === 'wait-first') return waitFirst(configPath, stateFile);
  if (command === 'reuse') return reuse(configPath, stateFile);
  if (command === 'status') return status(configPath, stateFile);
  console.log(`Usage:
  node scripts/smsbower-reuse-live-test.js acquire --wait-first --timeout-ms=300000
  node scripts/smsbower-reuse-live-test.js wait-first --timeout-ms=300000
  node scripts/smsbower-reuse-live-test.js reuse --wait-second --timeout-ms=300000
  node scripts/smsbower-reuse-live-test.js status

This is a live SMSBower test. It does not mock SMSBower and it does not cancel
an activation after a code is received. A real target service must send the first
and second SMS for the test to complete.`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
