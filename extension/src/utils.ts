/**
 * Parse newline-delimited text into individual lines.
 * Returns the complete lines and any remaining partial data.
 */
export function parseLines(input: string): { lines: string[]; remainder: string } {
    const parts = input.split('\n');
    // The last element is either empty (if input ends with \n) or a partial line
    const remainder = parts.pop() || '';
    // Filter out empty strings from consecutive newlines
    const lines = parts.filter(line => line.length > 0);
    return { lines, remainder };
}

/**
 * Safely parse a JSON string, returning null on failure.
 */
export function safeJsonParse(input: string): any | null {
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}
