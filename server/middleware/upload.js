import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(process.env.UPLOAD_DIR || join(__dirname, '..', '..', 'uploads'), 'tmp');
mkdirSync(tmpDir, { recursive: true });

const storage = multer.memoryStorage();

// 文件过滤：只允许图片
const fileFilter = (req, file, cb) => {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件格式，仅允许 PNG/JPEG/WebP/GIF'), false);
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 硬限制 50MB（软限制由 site_config 控制）
  },
});
