import fs from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { DaemonConfig, RemoteFileSnapshot } from "./types";

export class S3OssAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: DaemonConfig) {
    this.bucket = config.oss.bucket;
    this.prefix = config.oss.dataPrefix;
    this.client = new S3Client({
      endpoint: config.oss.endpoint,
      region: config.oss.region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.oss.accessKeyId,
        secretAccessKey: config.oss.secretAccessKey,
      },
    });
  }

  private toKey(relativePath: string): string {
    return `${this.prefix}${relativePath.replaceAll(path.sep, "/")}`;
  }

  async uploadFile(relativePath: string, absolutePath: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relativePath),
        Body: fs.createReadStream(absolutePath),
      })
    );
  }

  async deleteFile(relativePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relativePath),
      })
    );
  }

  async downloadFile(relativePath: string, absolutePath: string): Promise<void> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relativePath),
      })
    );
    if (!response.Body) {
      throw new Error(`download failed: empty body for ${relativePath}`);
    }

    const parentDir = path.dirname(absolutePath);
    fs.mkdirSync(parentDir, { recursive: true });

    const output = fs.createWriteStream(absolutePath);
    await new Promise<void>((resolve, reject) => {
      const stream = response.Body as NodeJS.ReadableStream;
      stream.pipe(output);
      stream.once("error", reject);
      output.once("finish", resolve);
      output.once("error", reject);
    });
  }

  async listFiles(): Promise<Record<string, RemoteFileSnapshot>> {
    const out: Record<string, RemoteFileSnapshot> = {};
    let continuationToken: string | undefined;

    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const item of page.Contents ?? []) {
        if (!item.Key || !item.Key.startsWith(this.prefix)) continue;
        const relativePath = item.Key.slice(this.prefix.length);
        if (!relativePath) continue;
        out[relativePath] = {
          path: relativePath,
          size: item.Size ?? 0,
          mtimeMs: item.LastModified?.getTime() ?? 0,
          etag: item.ETag,
        };
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return out;
  }
}
