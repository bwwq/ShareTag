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
  try { fieldMapping = JSON.parse(provider.field_mapping || '{}') || {}; } catch { fieldMapping = {}; }

  // 已知的非标准 OAuth2 提供商，直接手动配置，不走 OIDC discovery
  const knownProviders = {
    'https://discord.com': {
      authorization_endpoint: 'https://discord.com/api/oauth2/authorize',
      token_endpoint: 'https://discord.com/api/oauth2/token',
      userinfo_endpoint: 'https://discord.com/api/users/@me',
    },
    'https://github.com': {
      authorization_endpoint: 'https://github.com/login/oauth/authorize',
      token_endpoint: 'https://github.com/login/oauth/access_token',
      userinfo_endpoint: 'https://api.github.com/user',
    },
  };

  if (!configCache.has(provider.issuer_url)) {
    const known = knownProviders[provider.issuer_url];
    if (known) {
      // 非标准 OAuth2：手动构建配置
      configCache.set(provider.issuer_url, {
        serverMetadata: () => ({ issuer: provider.issuer_url, ...known }),
        __manual: true,
        __clientId: provider.client_id,
        __clientSecret: clientSecret,
        __tokenEndpoint: known.token_endpoint,
        __userinfoEndpoint: known.userinfo_endpoint,
      });
    } else {
      // 标准 OIDC：自动发现
      const config = await client.discovery(
        new URL(provider.issuer_url),
        provider.client_id,
        clientSecret,
      );
      configCache.set(provider.issuer_url, config);
    }
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
  let userinfo;

  if (oidcConfig.__manual) {
    // 手动配置模式（Discord / GitHub 等非标准 OIDC）
    const tokenResp = await fetch(oidcConfig.__tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: oidcConfig.__clientId,
        client_secret: oidcConfig.__clientSecret,
        code,
        redirect_uri: provider.redirect_uri,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(tokenData));

    const userinfoResp = await fetch(oidcConfig.__userinfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    userinfo = await userinfoResp.json();
  } else {
    // 标准 OIDC 流程
    const tokens = await client.authorizationCodeGrant(
      oidcConfig,
      new URL(`${provider.redirect_uri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`),
      { expectedState: state, expectedNonce: nonce },
    );

    if (provider.userinfo_endpoint) {
      const resp = await fetch(provider.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      userinfo = await resp.json();
    } else {
      userinfo = await client.fetchUserInfo(oidcConfig, tokens.access_token, tokens.claims().sub);
    }
  }

  // Discord 头像特殊处理：avatar 字段只是 hash，需拼成完整 URL
  let avatarUrl = getVal(userinfo, fieldMapping.avatar_url) || null;
  if (!avatarUrl && userinfo.avatar && userinfo.id) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${userinfo.id}/${userinfo.avatar}.png`;
  }

  return {
    sub: String(getVal(userinfo, fieldMapping.sub) || userinfo.sub || userinfo.id),
    username: getVal(userinfo, fieldMapping.username) || getVal(userinfo, 'username') || getVal(userinfo, 'name') || getVal(userinfo, 'login') || 'User',
    email: getVal(userinfo, fieldMapping.email) || null,
    avatar_url: avatarUrl,
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
