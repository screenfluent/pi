/**
 * Minimal ESLint fallback config for pi-lens.
 *
 * Intentionally JavaScript-only to avoid TypeScript parser/plugin assumptions.
 * Used only when user enables --lens-eslint-core and no project ESLint config exists.
 */

export default [
	{
		files: ["**/*.{js,jsx,mjs,cjs}"],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
		},
		rules: {
			"no-async-promise-executor": "error",
			"no-await-in-loop": "warn",
			"no-cond-assign": "error",
			"no-constant-condition": "error",
			"no-constructor-return": "error",
			"no-dupe-args": "error",
			"no-dupe-keys": "error",
			"no-compare-neg-zero": "error",
			"no-case-declarations": "error",
			"getter-return": "error",
		},
	},
];
