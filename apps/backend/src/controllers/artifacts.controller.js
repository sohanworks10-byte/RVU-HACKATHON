import * as artifactsService from '../services/artifacts.service.js';
import { presignGet } from '../infra/s3.js';

export async function getArtifact(req, res) {
  const { id } = req.params;
  const row = await artifactsService.getArtifact(id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  let signed_url = row.uri;
  try {
    if (row.uri && String(row.uri).startsWith('s3://')) {
      const parsed = String(row.uri).slice('s3://'.length);
      const slash = parsed.indexOf('/');
      const bucket = slash === -1 ? parsed : parsed.slice(0, slash);
      const key = slash === -1 ? '' : parsed.slice(slash + 1);
      const presigned = await presignGet({ bucket, key, expiresInSeconds: 300 });
      if (presigned) signed_url = presigned;
    }
  } catch {}

  return res.json({ artifact: row, signed_url });
}
