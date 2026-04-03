import 'dotenv/config';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
import { createApp } from './app.js';

// 注入代理环境映射（解决国内 Node 原生 fetch() 连不上国外 OIDC 问题）
if (process.env.http_proxy || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = await createApp();

app.listen(PORT, () => {
  console.log(`[AITag] Server running on http://localhost:${PORT}`);
  console.log(`[AITag] Environment: ${process.env.NODE_ENV || 'development'}`);
});
