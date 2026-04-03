export function errorHandler(err, req, res, _next) {
  console.error('[ERROR]', err.stack || err.message || err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件过大' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件超过大小限制' });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: '不支持的文件字段' });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';

  res.status(status).json({ error: message });
}
