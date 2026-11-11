import { isDeepStrictEqual as equal } from 'node:util';

export function extractSolutions(text, method) {
    return [...text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)]
        .filter((m) => ['', 'python', 'py'].includes(m[1].trim()))
        .map((m) => m[2])
        .filter((b) => b.includes('class Solution') && b.includes(`def ${method}(`));
}

export function compareObservation(number, observed, expected) {
    if (observed?.valid !== true) return false;
    if (number !== 15) return equal(observed.value, expected);
    const value = observed.value;
    if (
        !Array.isArray(value) ||
        value.some(
            (v) => !Array.isArray(v) || v.length !== 3 || v.some((n) => !Number.isInteger(n)),
        )
    )
        return false;
    const normalize = (v) => v.map((t) => JSON.stringify([...t].sort((a, b) => a - b))).sort();
    const actual = normalize(value);
    return new Set(actual).size === actual.length && equal(actual, normalize(expected));
}
