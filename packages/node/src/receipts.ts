import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ActionReceipt, JsonValue } from '@tokray/core';

interface StoredActionReceipt {
  receipt: ActionReceipt;
  privateState?: Readonly<Record<string, JsonValue>>;
}

export interface ActionReceiptStoreOptions {
  path?: string;
  home?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

export interface CreateActionReceiptInput extends Omit<ActionReceipt, 'version' | 'id'> {
  privateState?: Readonly<Record<string, JsonValue>>;
}

export function defaultActionReceiptPath(options: ActionReceiptStoreOptions = {}): string {
  const home = options.home ?? homedir();
  const stateHome = options.env?.['XDG_STATE_HOME'] ?? process.env['XDG_STATE_HOME'];
  return join(stateHome || join(home, '.local', 'state'), 'tokray', 'action-receipts.jsonl');
}

function receiptPath(options: ActionReceiptStoreOptions): string {
  return options.path ?? defaultActionReceiptPath(options);
}

async function storedReceipts(options: ActionReceiptStoreOptions = {}): Promise<StoredActionReceipt[]> {
  let source: string;
  try {
    source = await readFile(receiptPath(options), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: StoredActionReceipt[] = [];
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as StoredActionReceipt;
      if (value?.receipt?.version === 1 && typeof value.receipt.id === 'string') records.push(value);
    } catch {
      // Receipts are append-only. A damaged line must not hide later valid records.
    }
  }
  return records;
}

export async function createActionReceipt(
  input: CreateActionReceiptInput,
  options: ActionReceiptStoreOptions = {},
): Promise<ActionReceipt> {
  const { privateState, ...receiptInput } = input;
  const receipt: ActionReceipt = { version: 1, id: randomUUID(), ...receiptInput };
  const record: StoredActionReceipt = {
    receipt,
    ...(privateState ? { privateState } : {}),
  };
  const path = receiptPath(options);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return receipt;
}

export async function listActionReceipts(
  options: ActionReceiptStoreOptions = {},
  limit = 50,
): Promise<ActionReceipt[]> {
  const records = await storedReceipts(options);
  const rollbackByOriginal = new Map<string, string>();
  for (const record of records) {
    if (record.receipt.reversesReceiptId) {
      rollbackByOriginal.set(record.receipt.reversesReceiptId, record.receipt.id);
    }
  }
  return records.slice(-Math.max(1, Math.min(limit, 500))).reverse().map(({ receipt }) => {
    const rollbackReceiptId = rollbackByOriginal.get(receipt.id);
    if (!rollbackReceiptId) return receipt;
    return {
      ...receipt,
      rollback: { available: false, reason: 'already-rolled-back', rollbackReceiptId },
    };
  });
}

export async function readStoredActionReceipt(
  id: string,
  options: ActionReceiptStoreOptions = {},
): Promise<StoredActionReceipt | undefined> {
  return (await storedReceipts(options)).find((record) => record.receipt.id === id);
}
