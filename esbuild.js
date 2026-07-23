const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const copyWasmPlugin = {
	name: 'copy-wasm',
	setup(build) {
		build.onEnd(() => {
			const src = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
			const destDir = path.join(__dirname, 'dist');
			if (!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true });
			}
			fs.copyFileSync(src, path.join(destDir, 'sql-wasm.wasm'));
		});
	}
};

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log('[watch] build finished');
		});
	}
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// mongodb's driver has several optional native/cloud-auth peer deps that
		// aren't installed (kerberos, zstd/snappy compression, AWS/GCP auth
		// helpers, client-side field-level encryption). Mark them external so
		// esbuild doesn't fail trying to resolve them — they're only required
		// at runtime if that specific optional feature is actually used.
		external: [
			'vscode',
			'fsevents',
			'kerberos',
			'@mongodb-js/zstd',
			'snappy',
			'aws4',
			'mongodb-client-encryption',
			'@aws-sdk/credential-providers',
			'gcp-metadata',
			'socks'
		],
		logLevel: 'silent',
		plugins: [
			copyWasmPlugin,
			esbuildProblemMatcherPlugin
		]
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
