import { randomBytes } from 'node:crypto';
import { add0x } from '@1inch/byte-utils';
import { HashLock } from '@1inch/cross-chain-sdk';

export interface SecretData {
  secrets: string[];
  secretHashes: string[];
  hashLock: HashLock;
}

export class SecretManager {
  
  static generateSecret(): string {
    return add0x(randomBytes(32).toString('hex'));
  }

  static generateSecrets(count: number): string[] {
    return Array.from({ length: count }).map(() => this.generateSecret());
  }

  static createHashLock(secrets: string[]): HashLock {
    const leaves = HashLock.getMerkleLeaves(secrets);

    return secrets.length > 1
      ? HashLock.forMultipleFills(leaves)
      : HashLock.forSingleFill(secrets[0]);
  }

  static createSecretData(secretsCount: number): SecretData {
    const secrets = this.generateSecrets(secretsCount);
    const secretHashes = secrets.map(HashLock.hashSecret);
    const hashLock = this.createHashLock(secrets);

    return {
      secrets,
      secretHashes,
      hashLock
    };
  }
}