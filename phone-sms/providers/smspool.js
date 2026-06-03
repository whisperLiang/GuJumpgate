// phone-sms/providers/smspool.js - SMSPool 接码平台适配层
(function attachSmsPoolProvider(root, factory) {
  root.PhoneSmsPoolProvider = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function createSmsPoolProviderModule(root) {
  const PROVIDER_ID = 'smspool';
  const DEFAULT_BASE_URL = 'https://api.smspool.net/stubs/handler_api.php?setting=smspool';
  const DEFAULT_SERVICE_CODE = '671';
  const DEFAULT_SERVICE_LABEL = 'OpenAI / ChatGPT';
  const DEFAULT_COUNTRY_ID = 1;
  const DEFAULT_COUNTRY_LABEL = 'United States';

  function translateState(state = {}) {
    return {
      ...state,
      smsBowerApiKey: state.smsPoolApiKey ?? state.smsBowerApiKey ?? '',
      smsBowerBaseUrl: state.smsPoolBaseUrl ?? state.smsBowerBaseUrl ?? DEFAULT_BASE_URL,
      smsBowerServiceCode: state.smsPoolServiceCode ?? state.smsBowerServiceCode ?? DEFAULT_SERVICE_CODE,
      smsBowerCountryId: state.smsPoolCountryId ?? state.smsBowerCountryId ?? DEFAULT_COUNTRY_ID,
      smsBowerCountryLabel: state.smsPoolCountryLabel ?? state.smsBowerCountryLabel ?? DEFAULT_COUNTRY_LABEL,
      smsBowerCountryFallback: state.smsPoolCountryFallback ?? state.smsBowerCountryFallback ?? [],
      smsBowerMinPrice: state.smsPoolMinPrice ?? state.smsBowerMinPrice ?? '',
      smsBowerMaxPrice: state.smsPoolMaxPrice ?? state.smsBowerMaxPrice ?? '',
      smsBowerPreferredPrice: state.smsPoolPreferredPrice ?? state.smsBowerPreferredPrice ?? '',
    };
  }

  function translateActivation(activation) {
    if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
      return activation;
    }
    return {
      ...activation,
      provider: PROVIDER_ID,
    };
  }

  function relabelText(value) {
    return String(value || '').replace(/SMSBower/g, 'SMSPool');
  }

  function wrapError(error) {
    if (!error) {
      return error;
    }
    if (typeof error === 'string') {
      return relabelText(error);
    }
    const nextError = new Error(relabelText(error.message || String(error)));
    Object.keys(error).forEach((key) => {
      if (key === 'message') {
        return;
      }
      nextError[key] = error[key];
    });
    if (error.payload !== undefined) {
      nextError.payload = error.payload;
    }
    return nextError;
  }

  async function callWithState(baseProvider, methodName, state, ...args) {
    try {
      const result = await baseProvider[methodName](translateState(state), ...args);
      if (methodName === 'requestActivation' || methodName === 'reuseActivation') {
        return translateActivation(result);
      }
      if (typeof result === 'string') {
        return relabelText(result);
      }
      return result;
    } catch (error) {
      throw wrapError(error);
    }
  }

  function createProvider(deps = {}) {
    const baseFactory = root?.PhoneSmsBowerProvider?.createProvider;
    if (typeof baseFactory !== 'function') {
      throw new Error('SMSPool 依赖 SMSBower provider，但对应模块未加载。');
    }
    const baseProvider = baseFactory(deps);
    return {
      id: PROVIDER_ID,
      label: 'SMSPool',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      defaultServiceCode: DEFAULT_SERVICE_CODE,
      normalizeCountryId: baseProvider.normalizeCountryId,
      normalizeCountryLabel: baseProvider.normalizeCountryLabel,
      normalizeCountryFallback: baseProvider.normalizeCountryFallback,
      normalizeMaxPrice: baseProvider.normalizeMaxPrice,
      normalizeServiceCode: baseProvider.normalizeServiceCode,
      resolveCountryCandidates: (state) => baseProvider.resolveCountryCandidates(translateState(state)),
      requestActivation: (state, options) => callWithState(baseProvider, 'requestActivation', state, options),
      reuseActivation: (state, activation) => callWithState(baseProvider, 'reuseActivation', state, activation),
      finishActivation: (state, activation) => callWithState(baseProvider, 'finishActivation', state, activation),
      cancelActivation: (state, activation) => callWithState(baseProvider, 'cancelActivation', state, activation),
      banActivation: (state, activation) => callWithState(baseProvider, 'banActivation', state, activation),
      requestAdditionalSms: (state, activation) => callWithState(baseProvider, 'requestAdditionalSms', state, activation),
      pollActivationCode: (state, activation, options) => callWithState(baseProvider, 'pollActivationCode', state, activation, options),
      fetchBalance: (state) => callWithState(baseProvider, 'fetchBalance', state),
      fetchPrices: (state, countryConfig) => callWithState(baseProvider, 'fetchPrices', state, countryConfig),
      collectPriceEntries: baseProvider.collectPriceEntries,
      describePayload: (payload) => relabelText(baseProvider.describePayload(payload)),
    };
  }

  return {
    PROVIDER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    createProvider,
  };
});
