-- The public photos folder (product photos and request photos) takes images only, up to 10 MB
-- each, so a signed-in account can't fill it with huge or non-image files. The app uploads
-- compressed JPEGs and the AI product finder PNG, JPEG or WebP; existing photos are untouched.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'photos';
