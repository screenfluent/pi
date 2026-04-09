import * as path from "node:path";
import { normalizeMapKey } from "../path-utils.js";

export function resolveRunnerPath(cwd: string, filePath: string): string {
	return normalizeMapKey(path.resolve(cwd, filePath));
}

export function toRunnerDisplayPath(cwd: string, filePath: string): string {
	const cwdKey = normalizeMapKey(path.resolve(cwd));
	const fileKey = resolveRunnerPath(cwd, filePath);
	const relative = path.relative(cwdKey, fileKey).replace(/\\/g, "/");
	if (relative && relative !== "." && !relative.startsWith("../")) {
		return relative;
	}
	return fileKey;
}
