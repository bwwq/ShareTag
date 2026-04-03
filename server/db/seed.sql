-- AI Tag Gallery Initial Seed Data

INSERT OR IGNORE INTO site_config (key, value) VALUES
  ('site_name', '"AI Tag Gallery"'),
  ('site_description', '""'),
  ('upload_require_review', 'true'),
  ('max_upload_size_mb', '20'),
  ('max_image_dimension', '4096'),
  ('compress_quality', '85'),
  ('compress_format', '"webp"'),
  ('allowed_extensions', '"jpg,jpeg,png,webp,gif"'),
  ('default_storage', '"local"'),
  ('thumb_width', '320'),
  ('images_per_page', '24');

INSERT OR IGNORE INTO categories (id, name, slug, sort_order) VALUES
  (1, '三次元', 'real', 99),
  (2, 'NovelAI', 'nai', 1),
  (3, 'Stable Diffusion', 'sd', 2);
