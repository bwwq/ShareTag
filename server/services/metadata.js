/**
 * 从图片 Buffer 提取 AI 生成的 tag（Stable Diffusion prompt）
 * 支持 PNG tEXt/iTXt chunks 和 JPEG EXIF
 */

/**
 * 解析 A1111 WebUI 格式的 parameters 字符串
 * 格式: "masterpiece, 1girl, blue eyes, ...\nNegative prompt: ...\nSteps: 20, ..."
 * 返回第一行（positive prompt）
 */
function parseImageTextChunk(text) {
  if (!text || typeof text !== 'string') return null;
  text = text.trim();
  
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      if (json.prompt && typeof json.prompt === 'string') {
        const neg = json.uc && typeof json.uc === 'string' ? json.uc : '';
        return { prompt: json.prompt, negative: neg };
      }
      
      let comfyPrompt = [];
      for (const key of Object.keys(json)) {
        if (json[key]?.inputs?.text && typeof json[key].inputs.text === 'string') {
          comfyPrompt.push(json[key].inputs.text);
        }
      }
      if (comfyPrompt.length > 0) return { prompt: comfyPrompt.join(', '), negative: '' };
    } catch (e) {
      const pMatch = text.match(/prompt:\s*"([\s\S]*?)(?<!\\)"/);
      const nMatch = text.match(/uc:\s*"([\s\S]*?)(?<!\\)"/);
      if (pMatch && pMatch[1]) {
        return { prompt: pMatch[1], negative: nMatch ? nMatch[1] : '' };
      }
    }
  }
  
  const lines = text.split('\n');
  const firstLine = lines[0].trim();
  if (firstLine === '{' || firstLine === '[') return null;

  let negative = '';
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].toLowerCase().startsWith('negative prompt:')) {
      negative = lines[i].substring(16).trim();
      break;
    }
  }
  return { prompt: firstLine, negative };
}

export function cleanTag(tag) {
  let t = tag.trim().toLowerCase();
  
  // 1. 去除两端的引号或特殊残留
  t = t.replace(/^["'{}\[\]()<>\\]+|["'{}\[\]()<>\\]+$/g, '');
  
  // 2. 去除中间所有的圆括号、方括号、大括号
  t = t.replace(/[\(\)\[\]\{\}]/g, '');
  
  // 3. 清理 Midjourney 和 NovelAI 高阶权重前缀模式 (如 ::-5::, 1.2::, ::)
  t = t.replace(/^[:\-0-9.]+::+/g, '');
  t = t.replace(/^:+/g, '');
  
  // 4. 清理尾部的权重表达 (如 :1.5, ::-0.5, : 1.5)，不再误伤结尾数字 (如 year 2024)
  t = t.replace(/::?\s*[\-0-9.]+$/g, '');
  
  // 5. 去掉常见的不必要的前缀命名空间 (按用户需求去除 artist: suujiniku 等)
  t = t.replace(/^(artist|character|series|copyright|meta):/g, '');
  
  t = t.trim();
  if (!t || t.length < 2 || t.length > 50) return null;
  if (['prompt', 'uc', 'negative_prompt', 'seed'].includes(t)) return null;
  
  // 因前面的规则会删掉 `<`，所以要匹配没有尖括号的 lora:
  if (t.startsWith('lora:') || t.startsWith('lyco:') || t.startsWith('hypernet:')) return null;
  
  return t;
}

function promptToTags(prompt) {
  if (!prompt) return null;
  const rawTags = prompt.split(',');
  const cleanTags = [];
  for (const r of rawTags) {
    const c = cleanTag(r);
    if (c) cleanTags.push(c);
  }
  const uniqueTags = [...new Set(cleanTags)];
  return uniqueTags.length > 0 ? uniqueTags.join(', ') : null;
}

function extractFromPng(buffer) {
  try {
    if (buffer.length < 8) return null;
    const sig = buffer.subarray(0, 8);
    if (sig[0] !== 0x89 || sig[1] !== 0x50 || sig[2] !== 0x4E || sig[3] !== 0x47) return null;

    let offset = 8;
    const textChunks = {};

    while (offset < buffer.length - 4) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const data = buffer.subarray(offset + 8, offset + 8 + length);

      if (type === 'tEXt') {
        const nullIdx = data.indexOf(0);
        if (nullIdx >= 0) {
          const keyword = data.subarray(0, nullIdx).toString('latin1');
          const text = data.subarray(nullIdx + 1).toString('latin1');
          textChunks[keyword] = text;
        }
      } else if (type === 'iTXt') {
        const nullIdx = data.indexOf(0);
        if (nullIdx >= 0) {
          const keyword = data.subarray(0, nullIdx).toString('utf8');
          let pos = nullIdx + 3;
          let langEnd = data.indexOf(0, pos);
          let transEnd = data.indexOf(0, langEnd + 1);
          const text = data.subarray(transEnd + 1).toString('utf8');
          textChunks[keyword] = text;
        }
      } else if (type === 'IEND') {
        break;
      }
      offset += 8 + length + 4;
    }

    const keys = ['parameters', 'Comment', 'Description', 'prompt'];
    for (const key of keys) {
      if (textChunks[key]) {
        const parsed = parseImageTextChunk(textChunks[key]);
        if (parsed && parsed.prompt) {
          const tags = promptToTags(parsed.prompt);
          const negativeTags = parsed.negative ? promptToTags(parsed.negative) : null;
          if (tags || negativeTags) {
            return {
              extracted_tags: tags || '',
              extracted_negative_tags: negativeTags || '',
              prompt_text: parsed.prompt,
              negative_prompt_text: parsed.negative
            };
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从 JPEG Buffer 提取 EXIF 中的 UserComment 或 ImageDescription
 */
function extractFromJpeg(buffer) {
  try {
    // JPEG SOI: FF D8
    if (buffer.length < 2 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

    let offset = 2;
    while (offset < buffer.length - 4) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];
      // APP1 (EXIF): FF E1
      if (marker === 0xE1) {
        const segLength = buffer.readUInt16BE(offset + 2);
        const segData = buffer.subarray(offset + 4, offset + 2 + segLength);

        // Check for "Exif\0\0"
        if (segData.subarray(0, 6).toString('ascii') === 'Exif\0\0') {
          const exifStr = segData.toString('latin1');
          // 简单搜索 UserComment 或已知关键字
          // A1111 通常会把 parameters 写入 UserComment
          const patterns = ['parameters', '1girl', 'masterpiece', 'best quality'];
          for (const pattern of patterns) {
            const idx = exifStr.indexOf(pattern);
            if (idx >= 0) {
              // 尝试提取从找到位置开始的文本
              let end = exifStr.indexOf('\0', idx);
              if (end < 0) end = Math.min(idx + 2000, exifStr.length);
              const text = exifStr.substring(idx, end);
              const parsed = parseImageTextChunk(text);
              if (parsed && parsed.prompt) {
                const tags = promptToTags(parsed.prompt);
                const negativeTags = parsed.negative ? promptToTags(parsed.negative) : null;
                if (tags || negativeTags) {
                  return {
                    extracted_tags: tags || '',
                    extracted_negative_tags: negativeTags || '',
                    prompt_text: parsed.prompt,
                    negative_prompt_text: parsed.negative
                  };
                }
              }
            }
          }
        }
        break; // APP1 段只有一个
      }

      // 其他 marker，跳过
      if (marker >= 0xC0 && marker <= 0xFE) {
        if (marker === 0xDA) break; // SOS = 图像数据开始，停止搜索
        const segLen = buffer.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      } else {
        offset++;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 从图片 Buffer 提取 AI 生成的 tag
 * @param {Buffer} buffer - 图片文件 buffer
 * @param {string} mimeType - 'image/png' | 'image/jpeg' | 'image/webp' | ...
 * @returns {string|null} 逗号分隔的 tag 字符串，无法提取则返回 null
 */
export function extractTags(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return extractFromPng(buffer);
  }
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return extractFromJpeg(buffer);
  }
  // WebP 和 GIF 通常不包含 SD 的 prompt 元数据
  return null;
}
