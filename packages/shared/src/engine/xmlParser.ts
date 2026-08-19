/**
 * A minimal, hand-rolled, deterministic XML parser for FVL-04.014's
 * generic file connector.
 *
 * Deliberately NOT a general-purpose XML library: it has no code path that
 * resolves a DOCTYPE, an external/internal entity, a processing
 * instruction's content, or a network reference — those features simply do
 * not exist here, so XXE is impossible by construction rather than by
 * configuration. Any `<!DOCTYPE` or `<!ENTITY` sequence anywhere in the
 * input is rejected outright before parsing begins.
 */

export class UnsafeXmlError extends Error {}

export interface XmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (including CDATA), never children's
   *  own text — same convention `cellText`-style flattening elsewhere in
   *  this codebase uses: never guess, just concatenate what is there. */
  text: string;
}

const DOCTYPE_OR_ENTITY = /<!\s*(DOCTYPE|ENTITY)/i;

function decodeEntities(s: string): string {
  // Only the five predefined XML entities — never a numeric/hex character
  // reference resolved against anything external, never a DTD-defined one.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Parses well-formed XML into a single root `XmlElement`. Throws
 *  `UnsafeXmlError` for a DOCTYPE/ENTITY declaration, and a plain `Error`
 *  for malformed markup — both are caught and reported as structured
 *  connector errors by the caller, never as an unhandled exception. */
export function parseXml(text: string): XmlElement {
  if (DOCTYPE_OR_ENTITY.test(text)) {
    throw new UnsafeXmlError("XML DOCTYPE/ENTITY declarations are not accepted — external entity expansion is disallowed.");
  }

  let i = 0;
  const n = text.length;

  function skipMisc() {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i);
        if (end === -1) throw new Error("Unterminated processing instruction.");
        i = end + 2;
        continue;
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end === -1) throw new Error("Unterminated comment.");
        i = end + 3;
        continue;
      }
      break;
    }
  }

  function parseAttributes(src: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([:\w.-]+)\s*=\s*"([^"]*)"|([:\w.-]+)\s*=\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[1] ?? m[3];
      const value = decodeEntities(m[2] ?? m[4] ?? "");
      attrs[name] = value;
    }
    return attrs;
  }

  function parseElement(): XmlElement {
    skipMisc();
    if (text[i] !== "<") throw new Error(`Expected '<' at position ${i}.`);
    const tagMatch = /^<([:\w.-]+)((?:\s+[:\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(text.slice(i));
    if (!tagMatch) throw new Error(`Malformed start tag at position ${i}.`);
    const [whole, tag, attrSrc, selfClose] = tagMatch;
    i += whole.length;
    const attributes = parseAttributes(attrSrc);
    const el: XmlElement = { tag, attributes, children: [], text: "" };
    if (selfClose) return el;

    let textBuf = "";
    for (;;) {
      if (i >= n) throw new Error(`Unterminated element <${tag}>.`);
      if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i);
        if (end === -1) throw new Error("Unterminated CDATA section.");
        textBuf += text.slice(i + 9, end);
        i = end + 3;
        continue;
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i);
        if (end === -1) throw new Error("Unterminated comment.");
        i = end + 3;
        continue;
      }
      if (text.startsWith("</", i)) {
        const closeMatch = /^<\/([:\w.-]+)\s*>/.exec(text.slice(i));
        if (!closeMatch) throw new Error(`Malformed end tag at position ${i}.`);
        if (closeMatch[1] !== tag) throw new Error(`Mismatched end tag: expected </${tag}>, got </${closeMatch[1]}>.`);
        i += closeMatch[0].length;
        break;
      }
      if (text[i] === "<") {
        el.children.push(parseElement());
        continue;
      }
      const next = text.indexOf("<", i);
      const chunk = next === -1 ? text.slice(i) : text.slice(i, next);
      textBuf += chunk;
      i = next === -1 ? n : next;
    }
    el.text = decodeEntities(textBuf).trim();
    return el;
  }

  skipMisc();
  const root = parseElement();
  return root;
}

/** Deterministic structural record detection: the shallowest set of
 *  sibling elements sharing one tag name, repeated 2+ times, becomes the
 *  record boundary — a structural signal, never a semantic guess from tag
 *  names. Returns [] if no such repetition exists anywhere. */
export function detectRepeatedElements(root: XmlElement): XmlElement[] {
  const queue: XmlElement[] = [root];
  while (queue.length > 0) {
    const el = queue.shift()!;
    const byTag = new Map<string, XmlElement[]>();
    for (const child of el.children) {
      if (!byTag.has(child.tag)) byTag.set(child.tag, []);
      byTag.get(child.tag)!.push(child);
    }
    for (const [, group] of byTag) {
      if (group.length >= 2) return group;
    }
    queue.push(...el.children);
  }
  return [];
}

/** Flattens one record element into path->value fields: attributes as
 *  `@name`, leaf text as the child's own tag path, joined with `/`. Never
 *  invents a field that is not actually present. */
export function flattenXmlRecord(el: XmlElement, prefix = ""): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(el.attributes)) {
    fields[`${prefix}@${name}`] = value;
  }
  if (el.children.length === 0) {
    if (prefix) fields[prefix.replace(/\/$/, "")] = el.text || null;
    return fields;
  }
  for (const child of el.children) {
    Object.assign(fields, flattenXmlRecord(child, `${prefix}${child.tag}/`));
  }
  return fields;
}
