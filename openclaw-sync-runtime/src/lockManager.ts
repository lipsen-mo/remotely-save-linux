import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { DaemonConfig, LockAcquireResult, LockPayload } from "./types";

async function streamToString(stream: any): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSeconds(iso: string, sec: number): string {
  return new Date(new Date(iso).getTime() + sec * 1000).toISOString();
}

export class OSSLifecycleLockManager {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly lockKey: string;
  private readonly leasesPrefix: string;
  private readonly auditPrefix: string;

  constructor(private readonly config: DaemonConfig) {
    this.client = new S3Client({
      endpoint: config.oss.endpoint,
      region: config.oss.region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: config.oss.accessKeyId,
        secretAccessKey: config.oss.secretAccessKey,
      },
    });
    this.bucket = config.oss.bucket;
    this.lockKey = `${config.oss.lockPrefix}writer.lock`;
    this.leasesPrefix = `${config.oss.lockPrefix}leases/`;
    this.auditPrefix = `${config.oss.lockPrefix}audit/`;
  }

  buildPayload(sessionPurpose: string, holderId = randomUUID()): LockPayload {
    const startedAt = nowIso();
    return {
      holder_id: holderId,
      hostname: os.hostname(),
      agent_id: `rs-openclaw-${process.pid}`,
      pid: process.pid,
      started_at: startedAt,
      expires_at: addSeconds(startedAt, this.config.vault.lockTtlSec),
      session_purpose: sessionPurpose,
      program_version: "0.1.0-prototype",
    };
  }

  private async writeLease(payload: LockPayload): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.leasesPrefix}${payload.holder_id}.json`,
        Body: JSON.stringify(payload),
      })
    );
  }

  private async readCurrentLock(): Promise<LockPayload | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.lockKey,
        })
      );
      const text = await streamToString(res.Body);
      if (!text) return undefined;
      return JSON.parse(text) as LockPayload;
    } catch (err) {
      if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
        return undefined;
      }
      throw err;
    }
  }

  private isExpired(payload: LockPayload): boolean {
    return new Date(payload.expires_at).getTime() <= Date.now();
  }

  private async stealExpiredLock(previous: LockPayload, next: LockPayload): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.auditPrefix}${new Date().toISOString()}-${previous.holder_id}.json`,
        Body: JSON.stringify({ previous, stolen_by: next.holder_id, stolen_at: nowIso() }),
      })
    );

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.lockKey,
        Body: JSON.stringify(next),
      })
    );
    await this.writeLease(next);
  }

  async acquire(sessionPurpose: string, forceSteal = false): Promise<LockAcquireResult> {
    const payload = this.buildPayload(sessionPurpose);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.lockKey,
          Body: JSON.stringify(payload),
          IfNoneMatch: "*",
        })
      );
      await this.writeLease(payload);
      return { ok: true, status: "acquired", payload };
    } catch (err) {
      const current = await this.readCurrentLock();
      if (!current) {
        return { ok: false, status: "failed", reason: "lock_create_failed_without_current_lock" };
      }
      if (forceSteal || this.isExpired(current)) {
        await this.stealExpiredLock(current, payload);
        return { ok: true, status: "acquired", payload };
      }
      return { ok: false, status: "contended", payload: current, reason: "lock_not_expired" };
    }
  }

  async renew(payload: LockPayload): Promise<LockPayload> {
    const renewed: LockPayload = {
      ...payload,
      expires_at: addSeconds(nowIso(), this.config.vault.lockTtlSec),
    };
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.leasesPrefix}${payload.holder_id}.json`,
        Body: JSON.stringify(renewed),
      })
    );
    return renewed;
  }

  async release(payload?: LockPayload): Promise<void> {
    if (!payload) return;
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `${this.leasesPrefix}${payload.holder_id}.json`,
      })
    );
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.lockKey,
      })
    );
  }
}
