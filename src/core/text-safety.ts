const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const REPLACEMENT_CHAR = "\uFFFD";

const graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function toWellFormedText(value: string): string {
    let output = "";
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code >= 0xD800 && code <= 0xDBFF) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xDC00 && next <= 0xDFFF) {
                output += value[index] + value[index + 1];
                index++;
            } else {
                output += REPLACEMENT_CHAR;
            }
        } else if (code >= 0xDC00 && code <= 0xDFFF) {
            output += REPLACEMENT_CHAR;
        } else {
            output += value[index];
        }
    }
    return output;
}

export function sanitizePromptText(value: string): string {
    return toWellFormedText(value).replace(CONTROL_CHARS_RE, "");
}

export function truncateForPrompt(value: string, maxGraphemes: number): string {
    if (maxGraphemes <= 0) return "";
    const normalized = sanitizePromptText(value).replace(/\s+/g, " ").trim();
    const graphemes = graphemeSegmenter
        ? [...graphemeSegmenter.segment(normalized)].map((part) => part.segment)
        : Array.from(normalized);
    if (graphemes.length <= maxGraphemes) return normalized;
    const keep = Math.max(0, maxGraphemes - 1);
    return `${graphemes.slice(0, keep).join("")}…`;
}
