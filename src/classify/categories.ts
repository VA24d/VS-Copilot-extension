/** Category list + keyword tables, data-driven so it can be retuned without a migration (plan §7). */

export interface CategoryDefinition {
	id: string;
	label: string;
	/** Lowercase keywords/phrases scored against prompt text. */
	keywords: string[];
	/** Slash commands that strongly imply this category (e.g. "/fix" -> debug). */
	slashCommands?: string[];
}

export const CATEGORIES: CategoryDefinition[] = [
	{
		id: 'code-gen',
		label: 'Code generation',
		slashCommands: ['new', 'create'],
		keywords: [
			'write a', 'write me', 'generate', 'implement', 'add a function', 'add a method',
			'create a', 'create an', 'build a', 'scaffold', 'set up', 'add support for',
			'add a class', 'add an endpoint', 'add a component'
		]
	},
	{
		id: 'debug-fix',
		label: 'Debug / fix',
		slashCommands: ['fix'],
		keywords: [
			'fix', 'bug', 'error', 'exception', 'crash', 'stack trace', 'traceback', 'not working',
			'doesn\'t work', 'broken', 'fails', 'failing', 'failure', 'undefined is not', 'null reference',
			'why is', 'why does', 'debug'
		]
	},
	{
		id: 'explain',
		label: 'Explain',
		slashCommands: ['explain'],
		keywords: [
			'explain', 'what does', 'what is', 'how does', 'walk me through', 'understand', 'clarify',
			'what\'s happening', 'why does this'
		]
	},
	{
		id: 'refactor',
		label: 'Refactor',
		keywords: [
			'refactor', 'clean up', 'simplify', 'restructure', 'rename', 'extract', 'reorganize',
			'improve readability', 'make this cleaner', 'dedupe', 'de-duplicate'
		]
	},
	{
		id: 'test',
		label: 'Test',
		slashCommands: ['tests'],
		keywords: [
			'test', 'unit test', 'write tests', 'add tests', 'test case', 'jest', 'pytest', 'mocha',
			'assert', 'coverage', 'mock'
		]
	},
	{
		id: 'docs',
		label: 'Docs',
		keywords: [
			'document', 'documentation', 'docstring', 'comment', 'readme', 'jsdoc', 'add comments',
			'write docs'
		]
	},
	{
		id: 'git-terminal',
		label: 'Git / terminal',
		keywords: [
			'git ', 'commit', 'branch', 'merge', 'rebase', 'pull request', 'terminal', 'run this command',
			'shell', 'bash', 'npm install', 'pip install', 'docker', 'ci pipeline', 'github actions'
		]
	},
	{
		id: 'search-navigate',
		label: 'Search / navigate',
		keywords: [
			'where is', 'find', 'search for', 'locate', 'which file', 'show me', 'look up', 'grep'
		]
	}
];

export const FALLBACK_CATEGORY = 'other';
