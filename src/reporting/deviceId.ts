import * as crypto from 'crypto';
import * as vscode from 'vscode';

const DEVICE_ID_KEY = 'usageLogger.deviceId';

/**
 * Random per-machine identifier for company-wide reporting — not tied to
 * user identity (no username, email, or hostname). Lets a backend
 * distinguish machines/trends without any personally-identifying data.
 * Persisted in globalState so it's stable across restarts.
 */
export function getOrCreateDeviceId(context: vscode.ExtensionContext): string {
	const existing = context.globalState.get<string>(DEVICE_ID_KEY);
	if (existing) {
		return existing;
	}
	const id = crypto.randomUUID();
	void context.globalState.update(DEVICE_ID_KEY, id);
	return id;
}

export async function resetDeviceId(context: vscode.ExtensionContext): Promise<string> {
	const id = crypto.randomUUID();
	await context.globalState.update(DEVICE_ID_KEY, id);
	return id;
}
