// Cloudinary — raw uploaded document storage (spec PDFs, impl docs) + delivery.
// Optional: if CLOUDINARY_URL isn't a real `cloudinary://key:secret@cloud` URL
// (e.g. the placeholder in .env.local), uploads are skipped instead of crashing
// the importing route at module-load time. Storage here is best-effort archival.
//
// The cloudinary SDK parses CLOUDINARY_URL at *require* time, so a placeholder value
// throws just by importing it. We therefore load it lazily, only when a valid URL is
// present — an unconfigured deployment simply skips archival.
const CLOUDINARY_URL = process.env.CLOUDINARY_URL ?? "";
const configured = /^cloudinary:\/\/[^<>\s:]+:[^<>\s@]+@[^<>\s]+$/.test(CLOUDINARY_URL);

export async function uploadDoc(buffer: Buffer, filename: string, orgId: string): Promise<string | null> {
  if (!configured) return null; // storage not configured — skip archival, run proceeds
  const { v2: cloudinary } = await import("cloudinary");
  cloudinary.config({ secure: true }); // reads CLOUDINARY_URL from env
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { resource_type: "raw", folder: `conformance/${orgId}`, public_id: filename },
        (err, res) => (err || !res ? reject(err) : resolve(res.secure_url))
      )
      .end(buffer);
  });
}
