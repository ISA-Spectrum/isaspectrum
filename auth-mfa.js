// Copyright (c) 2026 ISA Spectrum · MIT License
(function () {
  'use strict';

  const SAFE_RETURNS = new Set([
    'main.html', 'messages.html', 'meal-rating.html', 'security.html',
    'checker-pending.html', 'checker-approved.html', 'checker-deleted.html'
  ]);
  const providers = new Map();
  let activeProviderId = 'supabase-totp';

  function registerProvider(provider) {
    const methods = ['enroll', 'list', 'verify', 'unenroll'];
    if (!provider?.id || methods.some(method => typeof provider[method] !== 'function')) {
      throw new TypeError('MFA provider must expose id, enroll(), list(), verify() and unenroll().');
    }
    providers.set(provider.id, provider);
    return provider;
  }

  function getProvider(id = activeProviderId) {
    const provider = providers.get(id);
    if (!provider) throw new Error(`Unknown MFA provider: ${id}`);
    return provider;
  }

  function useProvider(id) {
    getProvider(id);
    activeProviderId = id;
  }

  function safeReturnTo(value, fallback = 'main.html') {
    const page = String(value || '').replace(/^\.\//, '');
    return SAFE_RETURNS.has(page) ? page : fallback;
  }

  function pageUrl(page, params = {}) {
    const url = new URL(page, location.href);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    return url.pathname.split('/').pop() + url.search;
  }

  async function assurance(client) {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  }

  async function verifiedTotpFactors(client) {
    return getProvider().list(client);
  }

  async function continueAfterPassword(client, options = {}) {
    const returnTo = safeReturnTo(options.returnTo, options.checker ? 'checker-pending.html' : 'messages.html');
    const level = await assurance(client);

    if (level.currentLevel === 'aal2') {
      location.replace(returnTo);
      return;
    }

    const factors = await verifiedTotpFactors(client);
    if (factors.length > 0 || level.nextLevel === 'aal2') {
      location.replace(pageUrl('mfa-challenge.html', {
        returnTo,
        checker: options.checker ? '1' : ''
      }));
      return;
    }

    if (options.requireMfa) {
      location.replace(pageUrl('mfa-setup.html', {
        returnTo,
        required: '1',
        checker: options.checker ? '1' : ''
      }));
      return;
    }

    location.replace(returnTo);
  }

  async function requireSession(client, options = {}) {
    const returnTo = safeReturnTo(options.returnTo || location.pathname.split('/').pop(), 'main.html');
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session?.user) {
      location.replace(pageUrl(options.checker ? 'login-messageschecker.html' : 'login.html', { returnTo }));
      return null;
    }

    const level = await assurance(client);
    if (level.currentLevel !== 'aal2' && level.nextLevel === 'aal2') {
      location.replace(pageUrl('mfa-challenge.html', {
        returnTo,
        checker: options.checker ? '1' : ''
      }));
      return null;
    }

    if (options.requireAal2 && level.currentLevel !== 'aal2') {
      const factors = await verifiedTotpFactors(client);
      location.replace(pageUrl(factors.length ? 'mfa-challenge.html' : 'mfa-setup.html', {
        returnTo,
        required: factors.length ? '' : '1',
        checker: options.checker ? '1' : ''
      }));
      return null;
    }

    return { session, level };
  }

  async function challengeAndVerify(client, factorId, code) {
    return getProvider().verify(client, factorId, code);
  }

  registerProvider({
    id: 'supabase-totp',
    async enroll(client, friendlyName) {
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName });
      if (error) throw error;
      return data;
    },
    async list(client) {
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      return (data?.totp || []).filter(factor => factor.status === 'verified');
    },
    async verify(client, factorId, code) {
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { data, error } = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: String(code || '').replace(/\s/g, '')
      });
      if (error) throw error;
      return data;
    },
    async unenroll(client, factorId) {
      const { data, error } = await client.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      return data;
    }
  });

  window.ISAMFA = {
    id: 'supabase-totp',
    registerProvider,
    getProvider,
    useProvider,
    safeReturnTo,
    pageUrl,
    assurance,
    verifiedTotpFactors,
    continueAfterPassword,
    requireSession,
    challengeAndVerify
  };
})();
