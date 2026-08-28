const ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_CHUNK_BYTES = 450;
const encoder = new TextEncoder();

function byteLength(text) {
  return encoder.encode(text).length;
}

function splitOversizedSegment(segment, maxBytes) {
  const chunks = [];
  let current = "";
  for (const character of segment) {
    if (current && byteLength(current + character) > maxBytes) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitText(text, maxBytes = MAX_CHUNK_BYTES) {
  if (byteLength(text) <= maxBytes) return [text];

  const sentences = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(text)]
    .map(({ segment }) => segment);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (byteLength(sentence) > maxBytes) {
      if (current) chunks.push(current);
      chunks.push(...splitOversizedSegment(sentence, maxBytes));
      current = "";
      continue;
    }

    if (byteLength(current + sentence) > maxBytes) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function createMyMemoryTranslator(fetchImpl = fetch) {
  return async function translate(text, sourceLanguage, targetLanguage) {
    const chunks = splitText(text);
    const translated = [];

    for (const chunk of chunks) {
      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        q: chunk,
        langpair: `${sourceLanguage}|${targetLanguage}`,
        mt: "1"
      });

      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`翻译服务返回 ${response.status}`);

      const payload = await response.json();
      if (payload?.responseStatus !== 200) {
        throw new Error(payload?.responseDetails || "在线翻译服务暂不可用");
      }
      const result = payload?.responseData?.translatedText;
      if (!result) throw new Error("翻译服务未返回有效内容");
      translated.push(result);
    }

    return translated.join("");
  };
}
