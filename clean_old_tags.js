import { initDb, dbGet, dbAll, dbRun } from './server/db/init.js';
import { cleanTag } from './server/services/metadata.js';

(async () => {
    try {
        await initDb();
        
        function parseTags(rawTags) {
            if (!rawTags) return [];
            return rawTags.split(',')
              .map(t => cleanTag(t))
              .filter(t => t && t.length > 0 && t.length < 100);
        }
        
        function syncImageTagsLocal(imageId, tagNames) {
            dbRun('DELETE FROM image_tags WHERE image_id = ?', imageId);
            if (tagNames.length === 0) return;
            
            for (const name of tagNames) {
                dbRun('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
                const tagIdObj = dbGet('SELECT id FROM tags WHERE name = ?', name);
                if (tagIdObj) {
                    dbRun('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)', imageId, tagIdObj.id);
                }
            }
        }
        
        console.log('[Migration] Fetching all images...');
        const images = dbAll('SELECT id, raw_tags FROM images');
        let updatedCount = 0;
        
        for (const img of images) {
            if (!img.raw_tags) continue;
            
            const cleanedTagsArray = parseTags(img.raw_tags);
            const cleanedRawTagsStr = cleanedTagsArray.join(', ');
            
            if (cleanedRawTagsStr !== img.raw_tags) {
                dbRun('UPDATE images SET raw_tags = ? WHERE id = ?', cleanedRawTagsStr, img.id);
                syncImageTagsLocal(img.id, cleanedTagsArray);
                updatedCount++;
                console.log(`[Migration] Cleaned Image #${img.id}: [${cleanedRawTagsStr}]`);
            }
        }
        
        // 更新所有孤立 tag 或使用数
        dbRun('UPDATE tags SET use_count = (SELECT COUNT(*) FROM image_tags WHERE tag_id = tags.id)');
        // (可选) 删除 0 使用量的旧垃圾 tag
        const dInfo = dbRun('DELETE FROM tags WHERE use_count = 0');
        
        console.log(`[Migration] Completed. Updated ${updatedCount} images. Cleaned up ${dInfo.changes} orphaned tags.`);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
