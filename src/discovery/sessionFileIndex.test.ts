import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	discoverEmptyWindowChatSessionFiles,
	discoverWorkspaceChatSessionFiles,
	workspaceHashFromSessionFilePath
} from './sessionFileIndex';

describe('discoverWorkspaceChatSessionFiles', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-logger-workspace-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('finds .json and .jsonl session files under <hash>/chatSessions/', () => {
		const chatSessionsDir = path.join(tmpDir, 'abc123', 'chatSessions');
		fs.mkdirSync(chatSessionsDir, { recursive: true });
		fs.writeFileSync(path.join(chatSessionsDir, 'one.json'), '{}');
		fs.writeFileSync(path.join(chatSessionsDir, 'two.jsonl'), '');
		fs.writeFileSync(path.join(chatSessionsDir, 'ignore.txt'), '');

		const files = discoverWorkspaceChatSessionFiles(tmpDir);

		expect(files).toHaveLength(2);
		expect(files.some(f => f.endsWith('one.json'))).toBe(true);
		expect(files.some(f => f.endsWith('two.jsonl'))).toBe(true);
	});

	it('returns empty array when the directory does not exist', () => {
		expect(discoverWorkspaceChatSessionFiles(path.join(tmpDir, 'nope'))).toEqual([]);
	});
});

describe('discoverEmptyWindowChatSessionFiles', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-logger-emptywindow-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('finds .jsonl files directly under the directory (no hash subfolder)', () => {
		fs.writeFileSync(path.join(tmpDir, 'session-a.jsonl'), '');
		fs.writeFileSync(path.join(tmpDir, 'session-b.jsonl'), '');
		fs.writeFileSync(path.join(tmpDir, 'ignore.json'), '{}');

		const files = discoverEmptyWindowChatSessionFiles(tmpDir);

		expect(files).toHaveLength(2);
		expect(files.every(f => f.endsWith('.jsonl'))).toBe(true);
	});

	it('returns empty array when the directory does not exist', () => {
		expect(discoverEmptyWindowChatSessionFiles(path.join(tmpDir, 'nope'))).toEqual([]);
	});
});

describe('workspaceHashFromSessionFilePath', () => {
	it('extracts the hash segment following workspaceStorage', () => {
		const p = path.join('User', 'workspaceStorage', 'deadbeef', 'chatSessions', 'x.json');
		expect(workspaceHashFromSessionFilePath(p)).toBe('deadbeef');
	});

	it('returns undefined for paths with no workspaceStorage segment', () => {
		const p = path.join('User', 'globalStorage', 'emptyWindowChatSessions', 'x.jsonl');
		expect(workspaceHashFromSessionFilePath(p)).toBeUndefined();
	});
});
