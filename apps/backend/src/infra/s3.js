import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let client = null;

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return String(v);
}

export function isS3Configured() {
  return !!(process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT);
}

export function getS3Client() {
  if (client) return client;

  const endpoint = process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY || process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY || process.env.S3_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: String(endpoint),
    credentials: {
      accessKeyId: String(accessKeyId),
      secretAccessKey: String(secretAccessKey),
    },
    forcePathStyle: true,
  });

  return client;
}

export async function ensureBucket(bucket) {
  const s3 = getS3Client();
  if (!s3) return false;

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      return true;
    } catch {
      return false;
    }
  }
}

export async function putObject({ bucket, key, body, contentType }) {
  const s3 = getS3Client();
  if (!s3) return null;

  await ensureBucket(bucket);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  const endpoint = (process.env.MINIO_ENDPOINT || process.env.S3_ENDPOINT || '').replace(/\/+$/, '');
  return `${endpoint}/${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
}

export async function presignGet({ bucket, key, expiresInSeconds = 300 }) {
  const s3 = getS3Client();
  if (!s3) return null;

  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}
