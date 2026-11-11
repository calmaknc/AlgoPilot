import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Prefer the exact specifications captured before this run, not the current working copy. */
export async function readRunSuite(directory) {
    try {
        return JSON.parse(await readFile(join(directory, 'cases.snapshot.json'), 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return JSON.parse(await readFile(new URL('cases.json', import.meta.url), 'utf8'));
    }
}
