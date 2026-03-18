import fs from "node:fs";
import path from "node:path";
import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DaemonConfig } from "./types";

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
}
