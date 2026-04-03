import sharp from 'sharp';
import { join, dirname } from 'path';
import { mkdirSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { getConfig } from '../db/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_BASE = process.env.UPLOAD_DIR || join(__dirname, '..', '..', 'uploads');

// 确保目录存在
function ensureDirs() {
  mkdirSync(join(UPLOAD_BASE, 'images'), { recursive: true });
  mkdirSync(join(UPLOAD_BASE, 'thumbs'), { recursive: true });
  mkdirSync(join(UPLOAD_BASE, 'tmp'), { recursive: true });
}
ensureDirs();

/**
 * 获取图片元信息（尺寸等）
 */
export async function getImageMeta(buffer) {
  const meta = await sharp(buffer).metadata();
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    size: buffer.length,
  };
}

/**
 * 超限自动压缩图片
 * 如果宽或高超过 max_image_dimension，则缩放并压缩
 * 返回 { buffer, width, height, size, compressed, format }
 */
export async function compressIfNeeded(buffer, meta) {
  const maxDim = getConfig('max_image_dimension') || 4096;
  const quality = getConfig('compress_quality') || 85;
  const format = getConfig('compress_format') || 'webp';

  if (meta.width <= maxDim && meta.height <= maxDim) {
    return { buffer, ...meta, compressed: false };
  }

  let pipeline = sharp(buffer).resize({
    width: maxDim,
    height: maxDim,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (format === 'webp') pipeline = pipeline.webp({ quality });
  else if (format === 'jpeg' || format === 'jpg') pipeline = pipeline.jpeg({ quality });
  else if (format === 'png') pipeline = pipeline.png({ quality: Math.min(quality, 100) });
  else pipeline = pipeline.webp({ quality });

  const outBuffer = await pipeline.toBuffer();
  const outMeta = await sharp(outBuffer).metadata();

  return {
    buffer: outBuffer,
    width: outMeta.width,
    height: outMeta.height,
    size: outBuffer.length,
    format: format === 'jpg' ? 'jpeg' : format,
    compressed: true,
  };
}

/**
 * 生成缩略图
 */
export async function generateThumbnail(buffer) {
  const thumbWidth = getConfig('thumb_width') || 320;

  const thumbBuffer = await sharp(buffer)
    .resize({ width: thumbWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const filename = `${nanoid()}.webp`;
  const filePath = join(UPLOAD_BASE, 'thumbs', filename);
  await sharp(thumbBuffer).toFile(filePath);

  return {
    filename,
    path: `/uploads/thumbs/${filename}`,
  };
}

/**
 * 保存原图到 uploads/images/
 */
export async function saveImage(buffer, ext) {
  const filename = `${nanoid()}.${ext}`;
  const filePath = join(UPLOAD_BASE, 'images', filename);
  await sharp(buffer).toFile(filePath);

  return {
    filename,
    path: `/uploads/images/${filename}`,
  };
}

/**
 * 删除本地文件
 */
export function deleteFile(relativePath) {
  if (!relativePath) return;
  // relativePath is like /uploads/images/xxx.png
  const fullPath = join(UPLOAD_BASE, relativePath.replace(/^\/uploads/, ''));
  try {
    if (existsSync(fullPath)) unlinkSync(fullPath);
  } catch {
    // ignore
  }
}

/**
 * 获取上传根目录
 */
export function getUploadBase() {
  return UPLOAD_BASE;
}
