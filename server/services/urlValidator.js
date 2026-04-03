import { URL } from 'url';
import dns from 'dns/promises';
import { getConfig } from '../db/init.js';

// 内网 IP 段
const PRIVATE_RANGES = [
  // IPv4
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
];

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(ip) {
  // IPv6 loopback
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  // IPv4
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const long = ipToLong(ip);
  return PRIVATE_RANGES.some(r => long >= ipToLong(r.start) && long <= ipToLong(r.end));
}

/**
 * 验证外部图片 URL 的安全性
 * @returns {{ valid: true, contentType: string, contentLength: number }} 或抛错
 */
export async function validateImageUrl(url) {
  // 1. URL 格式校验
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无效的 URL 格式');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http/https 协议');
  }

  // 2. 禁止携带认证信息
  if (parsed.username || parsed.password) {
    throw new Error('URL 不能包含认证信息');
  }

  // 3. DNS 解析 + 内网 IP 检查 (SSRF 防护)
  try {
    const addresses = await dns.resolve4(parsed.hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error('不允许访问内网地址');
      }
    }
  } catch (e) {
    if (e.message === '不允许访问内网地址') throw e;
    // DNS 解析失败也可能是 IPv6 only，尝试 resolve6
    try {
      const addresses = await dns.resolve6(parsed.hostname);
      for (const addr of addresses) {
        if (isPrivateIp(addr)) {
          throw new Error('不允许访问内网地址');
        }
      }
    } catch {
      throw new Error('无法解析域名');
    }
  }

  // 4. HEAD 请求检查
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AITagGallery/1.0' },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`URL 不可访问 (HTTP ${resp.status})`);
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`URL 内容不是图片 (${contentType})`);
    }

    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
    const maxSize = (getConfig('max_upload_size_mb') || 20) * 1024 * 1024;
    if (contentLength > 0 && contentLength > maxSize) {
      throw new Error(`图片过大 (${(contentLength / 1024 / 1024).toFixed(1)}MB)`);
    }

    return { valid: true, contentType, contentLength };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('URL 请求超时');
    throw e;
  }
}
