const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createVisibleButton(text) {
  let clicks = 0;
  const attributes = new Map();
  return {
    tagName: 'BUTTON',
    textContent: text,
    value: '',
    hidden: false,
    disabled: false,
    type: 'button',
    form: null,
    click() {
      clicks += 1;
    },
    closest() {
      return null;
    },
    dispatchEvent(event) {
      if (event?.type === 'click') clicks += 1;
      return true;
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getBoundingClientRect() {
      return {
        width: 160,
        height: 40,
        left: 0,
        top: 0,
      };
    },
    get clicks() {
      return clicks;
    },
  };
}

function createPayPalHostedContext() {
  let listener = null;
  const approveButton = createVisibleButton('Agree and Continue');
  const documentElementAttributes = new Map();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    location: {
      href: 'https://www.paypal.com/checkoutnow?token=abc',
      host: 'www.paypal.com',
      pathname: '/checkoutnow',
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
      },
    },
    document: {
      readyState: 'complete',
      body: {
        innerText: 'Review your payment Agree and Continue',
      },
      documentElement: {
        getAttribute(name) {
          return documentElementAttributes.get(name) ?? null;
        },
        setAttribute(name, value) {
          documentElementAttributes.set(name, String(value));
        },
      },
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return /button|role="button"|input\[type="button"\]|input\[type="submit"\]/i.test(selector)
          ? [approveButton]
          : [];
      },
    },
    window: null,
    globalThis: null,
    MouseEvent: class MouseEvent {
      constructor(type) {
        this.type = type;
      }
    },
    PointerEvent: class PointerEvent {
      constructor(type) {
        this.type = type;
      }
    },
    sleep: async () => {},
    resetStopState: () => {},
    throwIfStopped: () => {},
    log: () => {},
    simulateClick: (el) => el.click(),
    fillInput: () => {},
  };

  context.window = context;
  context.globalThis = context;
  context.getComputedStyle = () => ({
    display: 'block',
    visibility: 'visible',
    opacity: '1',
  });

  vm.createContext(context);
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'content', 'paypal-flow.js'),
    'utf8'
  );
  vm.runInContext(script, context, {
    filename: 'content/paypal-flow.js',
  });

  async function sendMessage(message) {
    assert.equal(typeof listener, 'function');
    return new Promise((resolve) => {
      listener(message, {}, resolve);
    });
  }

  return {
    approveButton,
    sendMessage,
  };
}

test('hosted checkout approval page is clicked inside hosted flow', async () => {
  const { approveButton, sendMessage } = createPayPalHostedContext();

  const state = await sendMessage({
    type: 'PAYPAL_HOSTED_GET_STATE',
    source: 'test',
    payload: {},
  });
  assert.equal(state.hostedStage, 'approval');
  assert.equal(state.approveReady, true);

  const result = await sendMessage({
    type: 'PAYPAL_RUN_HOSTED_CHECKOUT_STEP',
    source: 'test',
    payload: {},
  });
  assert.equal(result.stage, 'approval');
  assert.equal(result.clicked, true);
  assert.equal(approveButton.clicks, 1);
});
