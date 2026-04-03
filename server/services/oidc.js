import * as client from 'openid-client';
import { dbGet } from '../db/init.js';
import { decrypt } from './crypto.js';

const configCache = new Map();

export async function getOidcProvider(providerName) {
  const provider = dbGet('SELECT * FROM oidc_providers WHERE name = ? AND enabled = 1', providerName);
  if (!provider) throw new Error('Provider not found or disabled');

  const secret = process.env.SESSION_SECRET;
  let clientSecret;
  try {
    clientSecret = decrypt(provider.client_secret, secret);
  } catch {
    clientSecret = provider.client_secret;
  }

  let fieldMapping;
  try { fieldMapping = JSON.parse(provider.field_mapping || '{}'); } catch { fieldMapping = {}; }

  if (!configCache.has(provider.issuer_url)) {
    const config = await client.discovery(
      new URL(provider.issuer_url),
      provider.client_id,
      clientSecret,
    );
    configCache.set(provider.issuer_url, config);
  }

  return {
    provider,
    config: configCache.get(provider.issuer_url),
    clientSecret,
    fieldMapping: {
      sub: fieldMapping.sub || 'sub',
      username: fieldMapping.username || 'preferred_username',
      email: fieldMapping.email || 'email',
      avatar_url: fieldMapping.avatar_url || 'picture',
      trust_level: fieldMapping.trust_level || null,
    },
  };
}

export function buildAuthUrl(oidcConfig, provider, state, nonce) {
  const scopes = provider.scopes || 'openid profile email';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: provider.client_id,
    redirect_uri: provider.redirect_uri,
    scope: scopes,
    state, nonce,
  });
  const serverMeta = oidcConfig.serverMetadata();
  return `${serverMeta.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCodeForUser(oidcConfig, provider, clientSecret, code, state, nonce, fieldMapping) {
  const tokens = await client.authorizationCodeGrant(
    oidcConfig,
    new URL(`${provider.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`),
    { expectedState: state, expectedNonce: nonce },
  );

  let userinfo;
  if (provider.userinfo_endpoint) {
    const resp = await fetch(provider.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    userinfo = await resp.json();
  } else {
    userinfo = await client.fetchUserInfo(oidcConfig, tokens.access_token, tokens.claims().sub);
  }

  return {
    sub: String(getVal(userinfo, fieldMapping.sub) || userinfo.sub),
    username: getVal(userinfo, fieldMapping.username) || getVal(userinfo, 'name') || 'User',
    email: getVal(userinfo, fieldMapping.email) || null,
    avatar_url: getVal(userinfo, fieldMapping.avatar_url) || null,
    trust_level: fieldMapping.trust_level ? (parseInt(getVal(userinfo, fieldMapping.trust_level)) || 0) : 0,
    raw: userinfo,
  };
}

export function clearCache(issuerUrl) {
  if (issuerUrl) configCache.delete(issuerUrl); else configCache.clear();
}

function getVal(obj, path) {
  if (!path || !obj) return undefined;
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
